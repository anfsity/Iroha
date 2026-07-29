/**
 * Copyright (C) 2026 Anfsity
 */

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import "colors";
import { resumeProgress, suspendProgress } from "./progress.js";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export type LogFormat = "human" | "jsonl";

export interface AsyncLogContext {
  traceId: string;
  operationId?: string;
  taskId?: string;
  parentId?: string;
  workerId?: string;
  phase?: "queued" | "running" | "waiting" | "retrying" | "success" | "failed";
  attempt?: number;
  durationMs?: number;
}

export type AsyncLogContextInput = Partial<AsyncLogContext>;

export interface SerializedError {
  name: string;
  message: string;
  stack: string | null;
  code?: string;
  status?: number;
  cause?: SerializedError | string;
  details?: Record<string, JsonValue>;
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface LogRecord {
  timestamp: string;
  level: LogLevel;
  scope: string;
  event: string;
  message: string;
  stack: string | null;
  context: Record<string, JsonValue>;
  async: AsyncLogContext;
  error: SerializedError | null;
}

export interface LogOptions {
  context?: Record<string, unknown>;
  async?: AsyncLogContextInput;
  error?: unknown;
  stack?: string | null;
}

export interface LoggerConfig {
  level?: LogLevel;
  format?: LogFormat;
  filePath?: string | null;
  terminal?: boolean;
}

export type LogListener = (record: LogRecord) => void;

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const SENSITIVE_KEY =
  /(?:access[_-]?token|authorization|client[_-]?secret|cookie|password|passwd|refresh[_-]?token|secret|token)/i;
const URL_KEY = /(?:href|proxy|uri|url)$/i;
const MAX_SERIALIZE_DEPTH = 6;
const MAX_SERIALIZE_KEYS = 100;
const MAX_STRING_LENGTH = 4096;
const ANSI_ESCAPE =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])))/g;
const URL_CREDENTIALS = /:\/\/[^/\s:@]+:[^/\s@]+@/g;
const SENSITIVE_PARAMETER =
  /([?&](?:access[_-]?token|authorization|client[_-]?secret|code|cookie|key|password|passwd|refresh[_-]?token|secret|token)=)[^&#\s]*/gi;
const BEARER_TOKEN = /(\bBearer\s+)[^\s,;&"']+/gi;
const SENSITIVE_ASSIGNMENT =
  /((?:access[_-]?token|authorization|client[_-]?secret|cookie|password|passwd|refresh[_-]?token|secret|token)\s*[:=]\s*)(["']?)[^\s,;&"']+\2/gi;

export function isLogLevel(value: unknown): value is LogLevel {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(LEVEL_WEIGHT, value)
  );
}

export function isLogFormat(value: unknown): value is LogFormat {
  return value === "human" || value === "jsonl";
}

export function createLogId(prefix: string = "id"): string {
  return `${prefix}-${randomUUID()}`;
}

function truncate(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]`;
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE, "");
}

function redactText(value: string): string {
  return stripAnsi(value)
    .replace(URL_CREDENTIALS, "://[REDACTED]@")
    .replace(SENSITIVE_PARAMETER, "$1[REDACTED]")
    .replace(BEARER_TOKEN, "$1[REDACTED]")
    .replace(SENSITIVE_ASSIGNMENT, "$1[REDACTED]");
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = "[REDACTED]";
      url.password = "[REDACTED]";
    }

    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_KEY.test(key) || /(?:code|key|auth)/i.test(key)) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }
    return truncate(redactText(url.toString()));
  } catch {
    return truncate(redactText(value));
  }
}

function sanitizeValue(
  value: unknown,
  key: string,
  seen: WeakSet<object>,
  depth: number,
): JsonValue {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";

  if (value === null) return null;
  if (typeof value === "string") {
    return URL_KEY.test(key) ? redactUrl(value) : truncate(redactText(value));
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "undefined") return "[undefined]";
  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }
  if (typeof value === "symbol") return value.toString();

  if (depth >= MAX_SERIALIZE_DEPTH) return "[MaxDepth]";
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  try {
    if (value instanceof Date) return value.toISOString();
    if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
    if (value instanceof Error) {
      return sanitizeValue(serializeError(value), key, seen, depth + 1);
    }
    if (Array.isArray(value)) {
      const items = value
        .slice(0, MAX_SERIALIZE_KEYS)
        .map((item) => sanitizeValue(item, "", seen, depth + 1));
      if (value.length > MAX_SERIALIZE_KEYS) {
        items.push(`[${value.length - MAX_SERIALIZE_KEYS} more items]`);
      }
      return items;
    }

    const result: Record<string, JsonValue> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [entryKey, entryValue] of entries.slice(0, MAX_SERIALIZE_KEYS)) {
      result[entryKey] = sanitizeValue(entryValue, entryKey, seen, depth + 1);
    }
    if (entries.length > MAX_SERIALIZE_KEYS) {
      result.__truncated__ = `${entries.length - MAX_SERIALIZE_KEYS} more keys`;
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

export function sanitizeContext(
  context: Record<string, unknown> = {},
): Record<string, JsonValue> {
  return sanitizeValue(context, "", new WeakSet<object>(), 0) as Record<
    string,
    JsonValue
  >;
}

function getErrorProperty(error: object, key: string): unknown {
  return key in error ? (error as Record<string, unknown>)[key] : undefined;
}

function serializeErrorValue(
  error: unknown,
  seen: WeakSet<object>,
  depth: number,
): SerializedError {
  if (error instanceof Error) {
    if (seen.has(error)) {
      return {
        name: error.name || "Error",
        message: "[Circular error cause]",
        stack: error.stack ? redactText(error.stack) : null,
      };
    }
    if (depth >= MAX_SERIALIZE_DEPTH) {
      return {
        name: error.name || "Error",
        message: "[MaxDepth]",
        stack: error.stack ? redactText(error.stack) : null,
      };
    }

    seen.add(error);
    const result: SerializedError = {
      name: error.name || "Error",
      message: redactText(error.message || String(error)),
      stack: error.stack ? redactText(error.stack) : null,
    };
    const code = getErrorProperty(error, "code");
    const status = getErrorProperty(error, "status");
    const response = getErrorProperty(error, "response");

    if (code !== undefined) result.code = String(code);
    if (typeof status === "number") result.status = status;
    if (response && typeof response === "object") {
      const responseStatus = getErrorProperty(response, "status");
      if (typeof responseStatus === "number") result.status = responseStatus;
    }

    const cause = getErrorProperty(error, "cause");
    if (cause !== undefined) {
      result.cause =
        cause instanceof Error
          ? serializeErrorValue(cause, seen, depth + 1)
          : truncate(redactText(String(cause)));
    }

    const details: Record<string, unknown> = {};
    for (const key of ["errno", "syscall", "path", "url"]) {
      const value = getErrorProperty(error, key);
      if (value !== undefined) details[key] = value;
    }
    if (Object.keys(details).length > 0) {
      result.details = sanitizeContext(details);
    }
    seen.delete(error);
    return result;
  }

  return {
    name: typeof error,
    message: truncate(redactText(String(error))),
    stack: null,
  };
}

export function serializeError(error: unknown): SerializedError {
  return serializeErrorValue(error, new WeakSet<object>(), 0);
}

function mergeAsyncContext(
  base: AsyncLogContext,
  input: AsyncLogContextInput = {},
): AsyncLogContext {
  const merged = { ...base, ...input };
  return Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  ) as unknown as AsyncLogContext;
}

function colorizeLevel(level: LogLevel, text: string = level): string {
  switch (level) {
    case "trace":
      return text.gray;
    case "debug":
      return text.cyan;
    case "info":
      return text.green;
    case "warn":
      return text.yellow;
    case "error":
      return text.red;
    case "fatal":
      return text.bgRed.white;
  }
}

const ACTION_LABELS: Record<string, string> = {
  "DOWNLOAD.SUCCEEDED": "DONE",
  "DOWNLOAD.RESUMED": "RESUME",
  "CONVERSION.SUCCEEDED": "GIF",
  "ILLUSTRATOR.COLLECTION_STARTED": "ILLUSTRATOR",
  "METADATA.COLLECTION_COMPLETED": "METADATA COLL.",
  "DIRECTORY.RENAMED": "MOVE",
  "ARCHIVE.REMOVED": "CLEAN",
  "NETWORK.RESUMED": "RETRY",
};

function formatHuman(record: LogRecord): string {
  const transientPhases = ["queued", "running"];
  if (record.async?.phase && transientPhases.includes(record.async.phase))
    return "";

  const isTTY = process.stdout.isTTY;
  const timestamp = new Date(record.timestamp);
  const time = Number.isNaN(timestamp.getTime())
    ? record.timestamp
    : [timestamp.getHours(), timestamp.getMinutes(), timestamp.getSeconds()]
        .map((n) => n.toString().padStart(2, "0"))
        .join(":").gray;

  const statusText = record.level.toUpperCase().padEnd(5);
  // Uppercase before applying ANSI styles. Uppercasing a styled string would
  // turn the escape terminator `m` into `M` and corrupt terminal rendering.
  const status = isTTY ? colorizeLevel(record.level, statusText) : statusText;

  const ctx = record.context;
  let subject = "";
  if (ctx.from && ctx.to) {
    subject = `${String(ctx.from).yellow} -> ${String(ctx.to).green}`;
  } else {
    const rawName = ctx.name || ctx.title || "";
    const nameStr = rawName ? String(rawName).yellow : "";
    const idVal = ctx.pid || ctx.uid;
    const idStr = idVal ? `(${idVal})`.cyan : "";
    subject = `${nameStr} ${idStr}`.trim();
  }

  const eventKey = record.event.toUpperCase();
  const actionTag = ACTION_LABELS[eventKey] || eventKey.split(".").pop();
  const action = actionTag ? ` ${actionTag} `.white : ` ${record.message} `;

  const meta: string[] = [];
  if (ctx.durationMs) {
    const ms = Number(ctx.durationMs);
    meta.push(ms > 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
  }
  if (ctx.bytes) {
    meta.push(`${(Number(ctx.bytes) / 1024 / 1024).toFixed(2)}MB`);
  }
  const info = meta.length > 0 ? `(${meta.join(" | ")})`.gray : "";

  const progress =
    ctx.index && ctx.total ? `[${ctx.index}/${ctx.total}]`.gray : "";

  const scope = `[${record.scope}]`.blue;

  // [时间] [级别] [作用域] [名字(ID)] [动作] [耗时/大小] [进度]
  let mainLine = `${time} ${status} ${scope} ${subject}${action}${info} ${progress}`;

  if (record.error) {
    mainLine += `\n  ┗━ ${"ERR:".red} ${record.error.message.red}`;
  }

  return mainLine.trim();
}

export class Logger {
  private level: LogLevel = "info";
  private format: LogFormat = "human";
  private terminal = true;
  private filePath: string | null = null;
  private fileQueue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<LogListener>();
  private readonly baseAsync: AsyncLogContext = {
    traceId: createLogId("run"),
  };

  public constructor(config: LoggerConfig = {}) {
    this.configure(config);
  }

  public configure(config: LoggerConfig = {}): void {
    if (config.level) this.level = config.level;
    if (config.format) this.format = config.format;
    if (config.terminal !== undefined) this.terminal = config.terminal;
    if (config.filePath !== undefined) {
      this.filePath = config.filePath ? path.resolve(config.filePath) : null;
    }
  }

  public getTraceId(): string {
    return this.baseAsync.traceId;
  }

  public createOperationId(prefix: string = "operation"): string {
    return createLogId(prefix);
  }

  public subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public log(
    level: LogLevel,
    scope: string,
    event: string,
    message: string,
    options: LogOptions = {},
  ): LogRecord | null {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.level]) return null;

    const serializedError =
      options.error === undefined ? null : serializeError(options.error);
    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      scope: redactText(scope),
      event: redactText(event),
      message: redactText(message),
      stack:
        serializedError?.stack ??
        (options.stack ? redactText(options.stack) : null),
      context: sanitizeContext(options.context),
      async: mergeAsyncContext(this.baseAsync, options.async),
      error: serializedError,
    };

    for (const listener of this.listeners) {
      try {
        listener(record);
      } catch {
        // A log subscriber must not be able to break the application.
      }
    }

    if (this.terminal) this.writeTerminal(record);
    this.writeFile(record);
    return record;
  }

  public trace(
    scope: string,
    event: string,
    message: string,
    options?: LogOptions,
  ): LogRecord | null {
    return this.log("trace", scope, event, message, options);
  }

  public debug(
    scope: string,
    event: string,
    message: string,
    options?: LogOptions,
  ): LogRecord | null {
    return this.log("debug", scope, event, message, options);
  }

  public info(
    scope: string,
    event: string,
    message: string,
    options?: LogOptions,
  ): LogRecord | null {
    return this.log("info", scope, event, message, options);
  }

  public warn(
    scope: string,
    event: string,
    message: string,
    options?: LogOptions,
  ): LogRecord | null {
    return this.log("warn", scope, event, message, options);
  }

  public error(
    scope: string,
    event: string,
    message: string,
    options?: LogOptions,
  ): LogRecord | null {
    return this.log("error", scope, event, message, options);
  }

  public fatal(
    scope: string,
    event: string,
    message: string,
    options?: LogOptions,
  ): LogRecord | null {
    return this.log("fatal", scope, event, message, options);
  }

  public async flush(): Promise<void> {
    await this.fileQueue;
  }

  private writeTerminal(record: LogRecord): void {
    const text =
      this.format === "jsonl" ? JSON.stringify(record) : formatHuman(record);

    if (!text) return;

    const wasSuspended = suspendProgress();
    const output =
      record.level === "warn" ||
      record.level === "error" ||
      record.level === "fatal"
        ? process.stderr
        : process.stdout;

    output.write(`${text}\n`);
    resumeProgress(wasSuspended);
  }

  private writeFile(record: LogRecord): void {
    if (!this.filePath) return;
    const filePath = this.filePath;
    const line = `${JSON.stringify(record)}\n`;
    this.fileQueue = this.fileQueue
      .then(async () => {
        await mkdir(path.dirname(filePath), { recursive: true });
        await appendFile(filePath, line, "utf8");
      })
      .catch((error: unknown) => {
        process.stderr.write(
          `[logger] failed to write ${filePath}: ${String(error)}\n`,
        );
      });
  }
}

const logger = new Logger();

export default logger;
