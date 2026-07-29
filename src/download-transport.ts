/**
 * Adapted from Tsuk1ko/pxder (https://github.com/Tsuk1ko/pxder)
 * Original file: src/tools.js
 */

import fse from "fs-extra";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import logger, { type LogOptions } from "./logger.js";

export type DownloadOptions = AxiosRequestConfig & {
  resume?: boolean;
  log?: Pick<LogOptions, "context" | "async">;
};

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

  // Axios timeout covers the response, so abort the whole request separately.
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
