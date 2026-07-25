import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Logger, sanitizeContext, serializeError } from "../src/logger.js";

const temporaryDirectories: string[] = [];

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("structured logger", () => {
  it("renders the record time and log level for human terminal output", () => {
    let output = "";
    const write = vi.spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write);

    try {
      const logger = new Logger();
      logger.info("test", "download.succeeded", "Completed", {
        async: { phase: "success" },
      });
    } finally {
      write.mockRestore();
    }

    expect(stripAnsi(output)).toMatch(
      /^\d{2}:\d{2}:\d{2} INFO\s+\[test\].*DONE/,
    );
  });

  it("keeps the colored log level valid in a TTY", () => {
    let output = "";
    const previousIsTTY = process.stdout.isTTY;
    process.stdout.isTTY = true;
    const write = vi.spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write);

    try {
      const logger = new Logger();
      logger.info("test", "download.succeeded", "Completed", {
        async: { phase: "success" },
      });
    } finally {
      write.mockRestore();
      process.stdout.isTTY = previousIsTTY;
    }

    expect(output).toContain("\u001B[32mINFO");
    expect(output).not.toContain("\u001B[32MINFO");
  });

  it("keeps queued and running records in the structured file only", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "iroha-logger-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "iroha.jsonl");
    let output = "";
    const write = vi.spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write);

    try {
      const logger = new Logger({ filePath });
      logger.info("test", "download.started", "Started", {
        async: { phase: "running" },
      });
      await logger.flush();
    } finally {
      write.mockRestore();
    }

    expect(output).toBe("");
    const [line] = (await readFile(filePath, "utf8")).trim().split("\n");
    expect(JSON.parse(line!)).toMatchObject({
      event: "download.started",
      async: { phase: "running" },
    });
  });

  it("emits the complete record and keeps async correlation ids", () => {
    const logger = new Logger({ terminal: false });
    const record = logger.info("downloader", "download.started", "Started", {
      context: { pid: 42 },
      async: {
        operationId: "operation-1",
        taskId: "task-1",
        parentId: "parent-1",
        workerId: "worker-1",
        phase: "running",
        attempt: 1,
      },
    });

    expect(record).not.toBeNull();
    expect(record).toMatchObject({
      level: "info",
      scope: "downloader",
      event: "download.started",
      message: "Started",
      stack: null,
      context: { pid: 42 },
      async: {
        operationId: "operation-1",
        taskId: "task-1",
        parentId: "parent-1",
        workerId: "worker-1",
        phase: "running",
        attempt: 1,
      },
      error: null,
    });
    expect(record?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(record?.async.traceId).toMatch(/^run-/);
  });

  it("filters records below the configured level", () => {
    const logger = new Logger({ level: "warn", terminal: false });
    const records: unknown[] = [];
    logger.subscribe((record) => records.push(record));

    expect(logger.debug("test", "debug", "hidden")).toBeNull();
    expect(logger.info("test", "info", "hidden")).toBeNull();
    expect(logger.warn("test", "warn", "visible")).not.toBeNull();
    expect(logger.error("test", "error", "visible")).not.toBeNull();
    expect(records).toHaveLength(2);
  });

  it("redacts secrets, proxy credentials, URLs, and ANSI escapes", () => {
    const logger = new Logger({ terminal: false });
    const record = logger.info(
      "test",
      "secret.event",
      "message https://user:password@example.test/?token=secret",
      {
        context: {
          token: "refresh-token",
          password: "password",
          cookie: "session-cookie",
          proxy: "http://proxy-user:proxy-password@127.0.0.1:7890",
          url: "https://example.test/path?access_token=access-token&ok=1",
          colored: "\u001b[31mred\u001b[0m",
        },
      },
    );

    expect(record?.message).not.toContain("password");
    expect(record?.message).not.toContain("secret");
    expect(record?.context).toMatchObject({
      token: "[REDACTED]",
      password: "[REDACTED]",
      cookie: "[REDACTED]",
      proxy: "http://[REDACTED]@127.0.0.1:7890/",
      url: "https://example.test/path?access_token=[REDACTED]&ok=1",
      colored: "red",
    });
    expect(JSON.stringify(record)).not.toContain("\u001b");
  });

  it("handles circular context and circular error causes", () => {
    const context: Record<string, unknown> = { name: "context" };
    context.self = context;

    const error = new Error("outer error");
    (error as Error & { cause?: unknown }).cause = error;

    expect(sanitizeContext(context)).toMatchObject({
      name: "context",
      self: "[Circular]",
    });
    expect(() => serializeError(error)).not.toThrow();
    expect(serializeError(error).cause).toMatchObject({
      message: "[Circular error cause]",
    });
  });

  it("writes one JSON object per line and waits for flush", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "iroha-logger-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "nested", "iroha.jsonl");
    const logger = new Logger({
      terminal: false,
      format: "jsonl",
      filePath,
    });

    logger.info("test", "first", "first");
    logger.error("test", "second", "second", {
      error: Object.assign(new Error("failed"), {
        code: "E_TEST",
        status: 503,
      }),
    });
    await logger.flush();

    const lines = (await readFile(filePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ event: "first", level: "info" });
    expect(lines[1]).toMatchObject({
      event: "second",
      level: "error",
      error: { code: "E_TEST", status: 503, stack: expect.any(String) },
    });
  });
});
