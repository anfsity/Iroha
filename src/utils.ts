/**
 * Adapted from Tsuk1ko/pxder (https://github.com/Tsuk1ko/pxder)
 * Original file: src/tools.js
 */

import fse from "fs-extra";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import { homedir, platform } from "node:os";
import { startProgress, stopProgress } from "./progress.js";
import logger, { type LogOptions } from "./logger.js";

export type DownloadOptions = AxiosRequestConfig & {
  resume?: boolean;
  log?: Pick<LogOptions, "context" | "async">;
};

export function getAppDataPath(appName: string): string {
  const baseDir =
    process.env.APPDATA ||
    (platform() === "win32"
      ? path.join(homedir(), "AppData", "Roaming")
      : path.join(homedir(), ".config"));
  return path.join(baseDir, appName);
}

export function showProgress(valFn: () => string | number): NodeJS.Timeout {
  return startProgress(() => `Progress: ${valFn()}`);
}

export function clearProgress(interval: NodeJS.Timeout): void {
  stopProgress(interval);
}

export async function download(
  dirpath: string,
  filename: string,
  url: string,
  axiosOption: DownloadOptions = {},
): Promise<AxiosResponse> {
  await fse.ensureDir(dirpath);
  const { resume = true, log, ...requestOptions } = axiosOption;
  const outputPath = path.join(dirpath, filename);
  const operationId = logger.createOperationId("download");
  const startedAt = Date.now();
  const existingSize =
    resume && (await fse.pathExists(outputPath))
      ? (await fse.stat(outputPath)).size
      : 0;
  const controller = new AbortController();
  const headers = {
    ...(requestOptions.headers as Record<string, string> | undefined),
  } as Record<string, string>;

  if (existingSize > 0) {
    headers.Range = `bytes=${existingSize}-`;
  }

  const config: AxiosRequestConfig = {
    ...requestOptions,
    headers,
    responseType: "stream",
    signal: controller.signal,
  };

  const finalUrl = new URL(url);

  logger.debug("transport", "download.started", "File download started", {
    context: {
      filename,
      url: finalUrl.href,
      existingSize,
      resumed: existingSize > 0,
      ...log?.context,
    },
    async: {
      operationId,
      ...log?.async,
      phase: "running",
    },
  });

  // why should we use timeout * 2 ? since the axios timeout only applies to the response, not the connection.
  let timeout: NodeJS.Timeout | null = requestOptions.timeout
    ? setTimeout(() => {
        controller.abort();
      }, requestOptions.timeout * 2)
    : null;

  try {
    const res = await axios.get(finalUrl.href, config);
    const append = existingSize > 0 && res.status === 206;
    await pipeline(
      res.data,
      createWriteStream(outputPath, { flags: append ? "a" : "w" }),
    );

    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }

    const bytes = await fse.stat(outputPath).then((stats) => stats.size);
    logger.debug("transport", "download.succeeded", "File download succeeded", {
      context: {
        filename,
        url: finalUrl.href,
        status: res.status,
        bytes,
        durationMs: Date.now() - startedAt,
        ...log?.context,
      },
      async: {
        operationId,
        ...log?.async,
        phase: "success",
        durationMs: Date.now() - startedAt,
      },
    });

    return res;
  } catch (err: any) {
    if (timeout) {
      clearTimeout(timeout);
    }

    if (err.name === "AbortError" || err.message === "canceled") {
      const timeoutError = new Error("Connection timeout", { cause: err });
      logger.debug("transport", "download.failed", timeoutError.message, {
        context: {
          filename,
          url: finalUrl.href,
          durationMs: Date.now() - startedAt,
          ...log?.context,
        },
        async: {
          operationId,
          ...log?.async,
          phase: "failed",
          durationMs: Date.now() - startedAt,
        },
        error: timeoutError,
      });
      throw timeoutError;
    }

    logger.debug("transport", "download.failed", "File download failed", {
      context: {
        filename,
        url: finalUrl.href,
        durationMs: Date.now() - startedAt,
        ...log?.context,
      },
      async: {
        operationId,
        ...log?.async,
        phase: "failed",
        durationMs: Date.now() - startedAt,
      },
      error: err,
    });
    throw err;
  }
}

export async function readJsonSafely<T>(
  path: string,
  defaultValue: T,
): Promise<T> {
  if (!(await fse.pathExists(path))) {
    return defaultValue;
  }

  try {
    return (await fse.readJSON(path)) as T;
  } catch (err) {
    return defaultValue;
  }
}

export class UgoiraDir {
  private files: Map<string, string> = new Map();
  private dirpath: string;
  private initialized: boolean = false;

  constructor(dirpath: string) {
    this.dirpath = dirpath;
  }

  private async init(): Promise<void> {
    if (this.initialized) return;

    if (await fse.pathExists(this.dirpath)) {
      const allFiles = await fse.readdir(this.dirpath);
      const existingFiles = allFiles
        .filter((file) => /\.zip$/i.test(file))
        .map((file) => [this.normalizeFilename(file), file] as const);
      this.files = new Map(existingFiles);
    }
    this.initialized = true;
  }

  public async exists(file: string): Promise<boolean> {
    await this.init();
    return this.files.has(this.normalizeFilename(file));
  }

  public async find(file: string): Promise<string | undefined> {
    await this.init();
    return this.files.get(this.normalizeFilename(file));
  }

  private normalizeFilename(filename: string): string {
    return filename.replace(/@\d+?ms/g, "");
  }
}

export { default as logError } from "./logError.js";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
