/**
 * Copyright (C) 2026 Anfsity
 *
 * Adapted from Tsuk1ko/pxder (https://github.com/Tsuk1ko/pxder)
 * Original file: src/downloader.js
 */

import fse from "fs-extra";
import path from "node:path";
import pLimit from "p-limit";
import type { ProxyAgent } from "proxy-agent";
import type { DownloadConfig } from "./config.js";
import {
  filterMissingIllusts,
  findExistingUgoiraZip,
  getIllustContext,
  getIllustratorNewDir,
  getTaskId,
  hasExpectedOutput,
  isUgoira,
} from "./download-files.js";
import { download } from "./download-transport.js";
import Illust from "./illustration.js";
import Illustrator from "./illustrator.js";
import type { IllustPolicy } from "./illust-policy.js";
import logger from "./logger.js";
import * as utils from "./utils.js";
import { sleep } from "./utils.js";
import { finalizeUgoira } from "./ugoira-finalizer.js";

const pixivRefer = "https://www.pixiv.net/";
const illustMetadataLimit = pLimit(4);

export interface DownloadContext {
  config: DownloadConfig;
  policy: IllustPolicy;
  agent: ProxyAgent | null;
}

interface DownloadListResult {
  dir: string;
  illusts: Illust[];
}

interface HttpErrorShape {
  code?: string;
  response?: {
    status?: number;
    headers?: Record<string, unknown>;
  };
}

function asHttpError(error: unknown): HttpErrorShape {
  if (!error || typeof error !== "object") return {};
  return error as HttpErrorShape;
}

function requireDownloadPath(context: DownloadContext): string {
  if (!context.config.path) throw new Error("Download path is not configured");
  return context.config.path;
}

export async function downloadByIllustrators(
  illustrators: Illustrator[],
  context: DownloadContext,
  callback?: (index: string | number) => void,
): Promise<void> {
  for (const [i, illustrator] of illustrators.entries()) {
    let illustratorInfo: UserData;
    try {
      illustratorInfo = await illustrator.info();
    } catch (error) {
      logger.warn(
        "downloader",
        "illustrator.info_failed",
        "Unable to load illustrator information",
        { context: { uid: illustrator.id }, error },
      );
      continue;
    }

    logger.info(
      "downloader",
      "illustrator.collection_started",
      "Collecting illustrator illustrations",
      {
        context: {
          uid: illustrator.id,
          name: illustrator.name,
          index: i + 1,
          total: illustrators.length,
        },
      },
    );

    const info = await getDownloadListByIllustrator(
      illustrator,
      illustratorInfo,
      context,
    );
    await downloadIllusts(
      info.illusts,
      path.join(requireDownloadPath(context), info.dir),
      context.config.thread,
      context,
    );
    callback?.(i);
  }
}

async function getDownloadListByIllustrator(
  illustrator: Illustrator,
  cachedInfo: UserData,
  context: DownloadContext,
): Promise<DownloadListResult> {
  let illusts: Illust[] = [];
  const dir = await getIllustratorNewDir(cachedInfo, context.config);
  const dldir = path.join(requireDownloadPath(context), dir);
  const ugoiraDir = new utils.UgoiraDir(dldir);
  const illustExists = (illust: Illust) =>
    hasExpectedOutput(illust, dldir, context.policy.ugoiraFormat, ugoiraDir);

  // Cached examples do not retain x_restrict. Fetch fresh metadata when the
  // filter is enabled instead of treating stale cached entries as safe.
  const exampleIllusts = context.policy.filterNsfw
    ? []
    : illustrator.exampleIllusts;
  let existNum = 0;
  for (const example of exampleIllusts) {
    if (await illustExists(example)) {
      existNum++;
    } else {
      illusts.push(example);
    }
  }

  if (existNum > 0) {
    return { dir, illusts: illusts.reverse() };
  }

  illusts = [];
  const processDisplay = utils.showProgress(() => illusts.length);
  try {
    let count: number;
    do {
      count = 0;
      const current = await illustrator.illusts();
      for (const illust of current) {
        if (!(await illustExists(illust))) {
          illusts.push(illust);
          count++;
        }
      }
    } while (
      illustrator.hasNext("illust") &&
      (count > 0 || illustrator.lastPageSkippedNsfw)
    );
  } finally {
    utils.clearProgress(processDisplay);
  }

  return { dir, illusts: illusts.reverse() };
}

export async function downloadByBookmark(
  me: Illustrator,
  context: DownloadContext,
  isPrivate: boolean = false,
): Promise<void> {
  const dir = `[bookmark] ${isPrivate ? "Private" : "Public"}`;
  const dldir = path.join(requireDownloadPath(context), dir);
  const ugoiraDir = new utils.UgoiraDir(dldir);

  logger.info(
    "downloader",
    "bookmark.collection_started",
    "Collecting bookmarked illustrations",
    { context: { private: isPrivate } },
  );

  const illusts: Illust[] = [];
  const processDisplay = utils.showProgress(() => illusts.length);
  try {
    let count: number;
    do {
      count = 0;
      const current = await me.bookmarks(isPrivate);
      for (const illust of current) {
        if (
          !(await hasExpectedOutput(
            illust,
            dldir,
            context.policy.ugoiraFormat,
            ugoiraDir,
          ))
        ) {
          illusts.push(illust);
          count++;
        }
      }
    } while (me.hasNext("bookmark") && (count > 0 || me.lastPageSkippedNsfw));
  } finally {
    utils.clearProgress(processDisplay);
  }

  await downloadIllusts(
    illusts.reverse(),
    dldir,
    context.config.thread,
    context,
  );
}

export async function downloadIllusts(
  illusts: Illust[],
  dldir: string,
  totalThread: number,
  context: DownloadContext,
): Promise<void> {
  const tempDir = context.config.tmp;
  if (!tempDir) throw new Error("Temporary download path is not configured");

  await fse.ensureDir(tempDir);
  await fse.ensureDir(dldir);

  const hangup = 5 * 60 * 1000;
  const maxRetries = 10;
  let pause = false;
  let continuousErrors = 0;

  const downloadOne = async (
    illust: Illust,
    threadId: number,
    index: number,
  ): Promise<void> => {
    const downloadFile = path.join(tempDir, illust.file);
    const finalFile = path.join(dldir, illust.file);
    const taskId = getTaskId(illust);
    const operationId = logger.createOperationId("download");
    const taskStartedAt = Date.now();
    const taskContext = {
      ...getIllustContext(illust),
      index: index + 1,
      total: illusts.length,
      workerId: String(threadId),
      destination: dldir,
    };

    logger.info(
      "downloader",
      "download.queued",
      "Illustration queued for download",
      {
        context: taskContext,
        async: {
          operationId,
          taskId,
          workerId: String(threadId),
          phase: "queued",
        },
      },
    );

    // A ZIP may already be complete while its requested GIF output is not.
    // Convert it in place instead of downloading the archive again.
    if (isUgoira(illust) && context.policy.ugoiraFormat !== "zip") {
      const existingZip = await findExistingUgoiraZip(illust, dldir);
      if (existingZip) {
        logger.info(
          "downloader",
          "download.existing_archive",
          "Using an existing ugoira ZIP",
          {
            context: { ...taskContext, existingZip },
            async: {
              operationId,
              taskId,
              workerId: String(threadId),
              phase: "running",
            },
          },
        );
        await finalizeUgoira(
          illust,
          path.join(dldir, existingZip),
          dldir,
          context.policy.ugoiraFormat,
        );
        return;
      }
    }

    const options = {
      headers: { referer: pixivRefer },
      timeout: 1000 * context.config.timeout,
      httpsAgent: context.agent || undefined,
      resume: true,
    };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let loggedPause = false;
      while (pause) {
        if (!loggedPause) {
          logger.debug(
            "downloader",
            "download.waiting",
            "Download paused because the network is unstable",
            {
              context: { ...taskContext, attempt },
              async: {
                operationId,
                taskId,
                workerId: String(threadId),
                attempt,
                phase: "waiting",
              },
            },
          );
          loggedPause = true;
        }
        await sleep(1000);
      }

      const attemptStartedAt = Date.now();
      try {
        const response = await download(tempDir, illust.file, illust.url, {
          ...options,
          log: {
            context: { pid: illust.id, filename: illust.file, attempt },
            async: {
              operationId,
              taskId,
              workerId: String(threadId),
              attempt,
              phase: "running",
            },
          },
        });

        const contentRange = response.headers["content-range"];
        const rangeMatch =
          typeof contentRange === "string"
            ? /\/([0-9]+)$/.exec(contentRange)
            : null;
        const rangeTotal = rangeMatch?.[1] ? Number(rangeMatch[1]) : undefined;
        const contentLength = response.headers["content-length"];
        const expectedSize =
          response.status === 206
            ? rangeTotal
            : typeof contentLength === "number" ||
                typeof contentLength === "string"
              ? Number(contentLength)
              : undefined;
        const stats = await fse.stat(downloadFile);

        if (
          expectedSize !== undefined &&
          Number.isFinite(expectedSize) &&
          stats.size !== expectedSize
        ) {
          throw new Error(`Incomplete: ${stats.size}/${expectedSize}`);
        }

        await fse.move(downloadFile, finalFile, { overwrite: true });
        if (
          !(await finalizeUgoira(
            illust,
            finalFile,
            dldir,
            context.policy.ugoiraFormat,
          ))
        ) {
          return;
        }

        continuousErrors = 0;
        logger.info(
          "downloader",
          "download.succeeded",
          "Illustration downloaded successfully",
          {
            context: {
              ...taskContext,
              attempt,
              status: response.status,
              bytes: stats.size,
              durationMs: Date.now() - taskStartedAt,
              attemptDurationMs: Date.now() - attemptStartedAt,
            },
            async: {
              operationId,
              taskId,
              workerId: String(threadId),
              attempt,
              phase: "success",
              durationMs: Date.now() - taskStartedAt,
            },
          },
        );
        return;
      } catch (error) {
        const httpError = asHttpError(error);
        const contentRange = httpError.response?.headers?.["content-range"];
        const rangeMatch =
          typeof contentRange === "string"
            ? /\*\/([0-9]+)$/.exec(contentRange)
            : null;
        const rangeTotal = rangeMatch?.[1] ? Number(rangeMatch[1]) : undefined;

        if (httpError.response?.status === 416 && rangeTotal !== undefined) {
          const partial = await fse.stat(downloadFile).catch(() => null);
          if (partial?.size === rangeTotal) {
            await fse.move(downloadFile, finalFile, { overwrite: true });
            if (
              !(await finalizeUgoira(
                illust,
                finalFile,
                dldir,
                context.policy.ugoiraFormat,
              ))
            ) {
              return;
            }
            logger.info(
              "downloader",
              "download.succeeded",
              "Illustration download resumed after an already-complete range",
              {
                context: {
                  ...taskContext,
                  attempt,
                  status: 206,
                  bytes: partial.size,
                  durationMs: Date.now() - taskStartedAt,
                  attemptDurationMs: Date.now() - attemptStartedAt,
                },
                async: {
                  operationId,
                  taskId,
                  workerId: String(threadId),
                  attempt,
                  phase: "success",
                  durationMs: Date.now() - taskStartedAt,
                },
              },
            );
            return;
          }
        }

        if (httpError.response?.status === 404) {
          logger.warn(
            "downloader",
            "download.not_found",
            "Illustration returned HTTP 404",
            {
              context: {
                ...taskContext,
                attempt,
                status: 404,
                durationMs: Date.now() - attemptStartedAt,
              },
              async: {
                operationId,
                taskId,
                workerId: String(threadId),
                attempt,
                phase: "failed",
              },
              error,
            },
          );
          return;
        }

        continuousErrors++;
        const lastAttempt = attempt === maxRetries;
        const logOptions = {
          context: {
            ...taskContext,
            attempt,
            status: httpError.response?.status,
            code: httpError.code,
            continuousErrors,
            durationMs: Date.now() - attemptStartedAt,
          },
          async: {
            operationId,
            taskId,
            workerId: String(threadId),
            attempt,
            phase: lastAttempt ? ("failed" as const) : ("retrying" as const),
          },
          error,
        };
        if (lastAttempt) {
          logger.error(
            "downloader",
            "download.failed",
            "Illustration download failed after all retries",
            logOptions,
          );
        } else {
          logger.warn(
            "downloader",
            "download.retrying",
            "Illustration download failed; retrying",
            logOptions,
          );
        }

        if (continuousErrors > totalThread * 2 && !pause) {
          pause = true;
          logger.warn(
            "downloader",
            "network.paused",
            "Network unstable; pausing downloads for five minutes",
            {
              context: { totalThread, continuousErrors, hangupMs: hangup },
              async: {
                operationId,
                taskId,
                workerId: String(threadId),
                phase: "waiting",
              },
            },
          );
          setTimeout(() => {
            pause = false;
            continuousErrors = 0;
            logger.info(
              "downloader",
              "network.resumed",
              "Download pause ended; retrying network operations",
              { context: { hangupMs: hangup } },
            );
          }, hangup);
        }

        if (lastAttempt) return;
        await sleep(2000 * attempt);
      }
    }
  };

  let nextIndex = 0;
  const worker = async (threadId: number): Promise<void> => {
    while (nextIndex < illusts.length) {
      const index = nextIndex++;
      const illust = illusts[index];
      if (illust) await downloadOne(illust, threadId, index);
    }
  };

  await Promise.all(
    Array.from({ length: totalThread }, (_, threadId) => worker(threadId)),
  );
}

export async function downloadByIllusts(
  illustJSON: PixivIllustJSON[],
  context: DownloadContext,
): Promise<void> {
  logger.info(
    "downloader",
    "metadata.collection_started",
    "Collecting illustration metadata",
    { context: { count: illustJSON.length } },
  );

  const results = await Promise.all(
    illustJSON.map((json) =>
      illustMetadataLimit(() => Illust.getIllusts(json, context.policy)),
    ),
  );
  const dldir = path.join(requireDownloadPath(context), "PID");
  const allIllusts = results.flat();
  const illusts = await filterMissingIllusts(
    allIllusts,
    dldir,
    context.policy.ugoiraFormat,
  );

  logger.info(
    "downloader",
    "metadata.collection_completed",
    "Illustration metadata collected",
    {
      context: {
        requested: allIllusts.length,
        missing: illusts.length,
        skipped: allIllusts.length - illusts.length,
      },
    },
  );
  await downloadIllusts(illusts, dldir, context.config.thread, context);
}
