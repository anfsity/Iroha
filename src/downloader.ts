/**
 * Adapted from Tsuk1ko/pxder (https://github.com/Tsuk1ko/pxder)
 * Original file: src/downloader.js
 */

import fse from "fs-extra";
import path from "node:path";
import pLimit from "p-limit";
import * as utils from "./utils.js";
import { sleep } from "./utils.js";
import Illust from "./illustration.js";
import Illustrator from "./illustrator.js";
import appState from "./appState.js";
import { convertUgoiraToGif, getUgoiraGifFilename } from "./ugoira.js";
import logger from "./logger.js";

const pixivRefer = "https://www.pixiv.net/";

interface DownloadListResult {
  dir: string;
  illusts: Illust[];
}

let config: DownloadConfig;
let httpsAgent: any = false;
const illustMetadataLimit = pLimit(4);

function isUgoira(illust: Illust): boolean {
  return illust.file.toLowerCase().endsWith(".zip");
}

function getIllustContext(illust: Illust): Record<string, unknown> {
  return {
    pid: illust.id,
    title: illust.title,
    filename: illust.file,
    url: illust.url,
    ugoira: isUgoira(illust),
  };
}

function getTaskId(illust: Illust): string {
  return `illust-${illust.id}-${illust.file}`;
}

async function hasExpectedOutput(
  illust: Illust,
  dldir: string,
  ugoiraDir: utils.UgoiraDir,
): Promise<boolean> {
  if (!isUgoira(illust)) {
    return fse.pathExists(path.join(dldir, illust.file));
  }

  const zipExists = await ugoiraDir.exists(illust.file);
  if (appState.ugoiraFormat === "zip") return zipExists;

  const gifExists = await fse.pathExists(
    path.join(dldir, getUgoiraGifFilename(illust.file)),
  );
  return appState.ugoiraFormat === "gif" ? gifExists : zipExists && gifExists;
}

async function filterMissingIllusts(
  illusts: Illust[],
  dldir: string,
): Promise<Illust[]> {
  const ugoiraDir = new utils.UgoiraDir(dldir);
  const missing: Illust[] = [];

  for (const illust of illusts) {
    if (!(await hasExpectedOutput(illust, dldir, ugoiraDir))) {
      missing.push(illust);
    }
  }

  return missing;
}

async function findExistingUgoiraZip(
  illust: Illust,
  dldir: string,
): Promise<string | undefined> {
  return new utils.UgoiraDir(dldir).find(illust.file);
}

async function finalizeUgoira(
  illust: Illust,
  zipPath: string,
  dldir: string,
): Promise<boolean> {
  // Regular illustrations are already in their final format. Only a ZIP
  // produced for an ugoira can be converted to GIF.
  if (!isUgoira(illust) || appState.ugoiraFormat === "zip") return true;

  const gifPath = path.join(dldir, getUgoiraGifFilename(illust.file));
  if (!(await fse.pathExists(gifPath))) {
    const operationId = logger.createOperationId("ugoira-convert");
    const startedAt = Date.now();
    logger.info(
      "ugoira",
      "conversion.started",
      "Ugoira GIF conversion started",
      {
        context: { ...getIllustContext(illust), zipPath, gifPath },
        async: {
          operationId,
          taskId: getTaskId(illust),
          phase: "running",
        },
      },
    );
    try {
      await convertUgoiraToGif(zipPath, gifPath, illust.ugoiraFrames);
      logger.info(
        "ugoira",
        "conversion.succeeded",
        "Ugoira GIF conversion succeeded",
        {
          context: {
            ...getIllustContext(illust),
            zipPath,
            gifPath,
            durationMs: Date.now() - startedAt,
          },
          async: {
            operationId,
            taskId: getTaskId(illust),
            phase: "success",
            durationMs: Date.now() - startedAt,
          },
        },
      );
    } catch (error) {
      logger.error(
        "ugoira",
        "conversion.failed",
        "GIF conversion failed; ZIP was kept",
        {
          context: {
            ...getIllustContext(illust),
            zipPath,
            gifPath,
            durationMs: Date.now() - startedAt,
          },
          async: {
            operationId,
            taskId: getTaskId(illust),
            phase: "failed",
            durationMs: Date.now() - startedAt,
          },
          error,
        },
      );
      return false;
    }
  }

  if (appState.ugoiraFormat === "gif") {
    await fse.remove(zipPath);
    logger.debug(
      "ugoira",
      "archive.removed",
      "Removed ZIP after GIF conversion",
      {
        context: { ...getIllustContext(illust), zipPath },
        async: { taskId: getTaskId(illust), phase: "success" },
      },
    );
  }
  return true;
}

export function setConfig(conf: DownloadConfig): void {
  config = conf;
}

export function setAgent(agent: any): void {
  httpsAgent = agent;
}

export async function downloadByIllustrators(
  illustrators: Illustrator[],
  callback?: (index: string | number) => void,
): Promise<void> {
  for (const [i, illustrator] of illustrators.entries()) {
    const illustrator = illustrators[i];
    if (!illustrator) continue;

    let illustratorInfo;
    try {
      illustratorInfo = await illustrator.info();
    } catch (err: any) {
      logger.warn(
        "downloader",
        "illustrator.info_failed",
        "Unable to load illustrator information",
        {
          context: { uid: illustrator.id },
          error: err,
        },
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
    );

    await downloadIllusts(
      info.illusts,
      path.join(config.path!, info.dir),
      config.thread,
    );

    callback?.(i);
  }
}

/**
 * Incrementally retrieve the list of undownloaded artworks by the illustrator.
 */
async function getDownloadListByIllustrator(
  illustrator: Illustrator,
  cachedInfo: any,
): Promise<DownloadListResult> {
  let illusts: Illust[] = [];

  const dir = await getIllustratorNewDir(cachedInfo);
  const dldir = path.join(config.path!, dir);
  const ugoiraDir = new utils.UgoiraDir(dldir);

  const illustExists = async (illust: Illust) =>
    hasExpectedOutput(illust, dldir, ugoiraDir);

  // Cached examples do not retain x_restrict. Fetch fresh metadata when the
  // filter is enabled instead of treating stale cached entries as safe.
  const exampleIllusts = appState.filterNsfw ? [] : illustrator.exampleIllusts;
  if (exampleIllusts) {
    let existNum = 0;
    for (const ei of exampleIllusts) {
      if (await illustExists(ei)) {
        existNum++;
      } else {
        illusts.push(ei);
      }
    }

    if (existNum > 0) {
      return { dir, illusts: illusts.reverse() };
    }
  }

  illusts = [];
  const processDisplay = utils.showProgress(() => illusts.length);

  let cnt: number;
  do {
    cnt = 0;
    const temps = await illustrator.illusts();
    for (const temp of temps) {
      if (!(await illustExists(temp))) {
        illusts.push(temp);
        cnt++;
      }
    }
  } while (
    illustrator.hasNext("illust") &&
    (cnt > 0 || illustrator.lastPageSkippedNsfw)
  );

  utils.clearProgress(processDisplay);

  return { dir, illusts: illusts.reverse() };
}

export async function downloadByBookmark(
  me: Illustrator,
  isPrivate: boolean = false,
): Promise<void> {
  const dir = `[bookmark] ${isPrivate ? "Private" : "Public"}`;
  const dldir = path.join(config.path!, dir);
  const ugoiraDir = new utils.UgoiraDir(dldir);

  const illustExists = async (illust: Illust) =>
    hasExpectedOutput(illust, dldir, ugoiraDir);

  logger.info(
    "downloader",
    "bookmark.collection_started",
    "Collecting bookmarked illustrations",
    {
      context: { private: isPrivate },
    },
  );

  const illusts: Illust[] = [];
  const processDisplay = utils.showProgress(() => illusts.length);

  let cnt: number;
  do {
    cnt = 0;
    const temps = await me.bookmarks(isPrivate);
    for (const temp of temps) {
      if (!(await illustExists(temp))) {
        illusts.push(temp);
        cnt++;
      }
    }
  } while (me.hasNext("bookmark") && (cnt > 0 || me.lastPageSkippedNsfw));

  utils.clearProgress(processDisplay);
  await downloadIllusts(illusts.reverse(), dldir, config.thread);
}

export async function downloadIllusts(
  illusts: Illust[],
  dldir: string,
  totalThread: number,
): Promise<any[]> {
  const tempDir = config.tmp!;

  await fse.ensureDir(tempDir);
  await fse.ensureDir(dldir);

  const hangup = 5 * 60 * 1000;
  const max_retries = 10;
  let pause = false;
  let continuousErr = 0;

  const downloadOne = async (
    illust: Illust,
    threadID: number,
    i: number,
  ): Promise<void> => {
    const dlFile = path.join(tempDir, illust.file);
    const finalFile = path.join(dldir, illust.file);
    const taskId = getTaskId(illust);
    const operationId = logger.createOperationId("download");
    const taskStartedAt = Date.now();
    const taskContext = {
      ...getIllustContext(illust),
      index: i + 1,
      total: illusts.length,
      workerId: String(threadID),
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
          workerId: String(threadID),
          phase: "queued",
        },
      },
    );

    // A ZIP may already be complete while its requested GIF output is not.
    // Convert it in place instead of downloading the archive again.
    if (isUgoira(illust) && appState.ugoiraFormat !== "zip") {
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
              workerId: String(threadID),
              phase: "running",
            },
          },
        );
        await finalizeUgoira(illust, path.join(dldir, existingZip), dldir);
        return;
      }
    }

    const options = {
      headers: { referer: pixivRefer },
      timeout: 1000 * config.timeout,
      httpsAgent: httpsAgent || undefined,
      resume: true,
    };

    for (let attempt = 1; attempt <= max_retries; ++attempt) {
      let waitedForPause = false;
      while (pause) {
        if (!waitedForPause) {
          logger.debug(
            "downloader",
            "download.waiting",
            "Download paused because the network is unstable",
            {
              context: { ...taskContext, attempt },
              async: {
                operationId,
                taskId,
                workerId: String(threadID),
                attempt,
                phase: "waiting",
              },
            },
          );
          waitedForPause = true;
        }
        await sleep(1000);
      }

      const attemptStartedAt = Date.now();
      logger.debug(
        "downloader",
        "download.attempt_started",
        "Download attempt started",
        {
          context: { ...taskContext, attempt },
          async: {
            operationId,
            taskId,
            workerId: String(threadID),
            attempt,
            phase: "running",
          },
        },
      );

      try {
        const res = await utils.download(tempDir, illust.file, illust.url, {
          ...options,
          log: {
            context: { pid: illust.id, filename: illust.file, attempt },
            async: {
              operationId,
              taskId,
              workerId: String(threadID),
              attempt,
              phase: "running",
            },
          },
        });

        const contentRange = res.headers["content-range"];
        const rangeMatch =
          typeof contentRange === "string"
            ? /\/([0-9]+)$/.exec(contentRange)
            : null;
        const rangeTotal = rangeMatch?.[1] ? Number(rangeMatch[1]) : undefined;
        const contentLength = res.headers["content-length"];
        const expectedSize =
          res.status === 206
            ? rangeTotal
            : typeof contentLength === "number" ||
                typeof contentLength === "string"
              ? Number(contentLength)
              : undefined;
        const stats = await fse.stat(dlFile);

        if (
          expectedSize !== undefined &&
          Number.isFinite(expectedSize) &&
          stats.size !== expectedSize
        ) {
          throw new Error(`Incomplete: ${stats.size}/${expectedSize}`);
        }

        await fse.move(dlFile, finalFile, { overwrite: true });
        if (!(await finalizeUgoira(illust, finalFile, dldir))) return;

        if (continuousErr > 0) continuousErr = 0;
        logger.info(
          "downloader",
          "download.succeeded",
          "Illustration downloaded successfully",
          {
            context: {
              ...taskContext,
              attempt,
              status: res.status,
              bytes: stats.size,
              durationMs: Date.now() - taskStartedAt,
              attemptDurationMs: Date.now() - attemptStartedAt,
            },
            async: {
              operationId,
              taskId,
              workerId: String(threadID),
              attempt,
              phase: "success",
              durationMs: Date.now() - taskStartedAt,
            },
          },
        );

        return;
      } catch (err: any) {
        const contentRange = err?.response?.headers?.["content-range"];
        const rangeMatch =
          typeof contentRange === "string"
            ? /\*\/([0-9]+)$/.exec(contentRange)
            : null;
        const rangeTotal = rangeMatch?.[1] ? Number(rangeMatch[1]) : undefined;
        if (err?.response?.status === 416 && rangeTotal !== undefined) {
          const partial = await fse.stat(dlFile).catch(() => null);
          if (partial?.size === rangeTotal) {
            await fse.move(dlFile, finalFile, { overwrite: true });
            if (!(await finalizeUgoira(illust, finalFile, dldir))) return;
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
                  workerId: String(threadID),
                  attempt,
                  phase: "success",
                  durationMs: Date.now() - taskStartedAt,
                },
              },
            );
            return;
          }
        }

        if (err?.response?.status === 404) {
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
                workerId: String(threadID),
                attempt,
                phase: "failed",
              },
              error: err,
            },
          );
          return;
        }

        continuousErr++;

        const isLastAttempt = attempt === max_retries;
        const logOptions = {
          context: {
            ...taskContext,
            attempt,
            status: err?.response?.status,
            code: err?.code,
            continuousErrors: continuousErr,
            durationMs: Date.now() - attemptStartedAt,
          },
          async: {
            operationId,
            taskId,
            workerId: String(threadID),
            attempt,
            phase: isLastAttempt ? ("failed" as const) : ("retrying" as const),
          },
          error: err,
        };
        if (isLastAttempt) {
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

        if (continuousErr > totalThread * 2) {
          if (!pause) {
            pause = true;
            logger.warn(
              "downloader",
              "network.paused",
              "Network unstable; pausing downloads for five minutes",
              {
                context: {
                  totalThread,
                  continuousErrors: continuousErr,
                  hangupMs: hangup,
                },
                async: {
                  operationId,
                  taskId,
                  workerId: String(threadID),
                  phase: "waiting",
                },
              },
            );
            setTimeout(() => {
              pause = false;
              continuousErr = 0;
              logger.info(
                "downloader",
                "network.resumed",
                "Download pause ended; retrying network operations",
                { context: { hangupMs: hangup } },
              );
            }, hangup);
          }
        }

        if (isLastAttempt) return;
        await sleep(2000 * attempt);
      }
    }
  };

  let idx = 0;
  const worker = async (threadID: number) => {
    while (idx < illusts.length) {
      const i = idx++;
      const illust = illusts[i];
      if (illust) {
        await downloadOne(illust, threadID, i);
      }
    }
  };

  const threads = Array.from({ length: totalThread }, (_, i) => worker(i));
  await Promise.all(threads);

  return [];
}

async function getIllustratorNewDir(data: {
  id: number | string;
  name: string;
}): Promise<string> {
  const mainDir = config.path!;
  let dldir: string | null = null;

  await fse.ensureDir(mainDir);
  const files = await fse.readdir(mainDir);

  const prefix = `(${data.id})`;
  for (const file of files) {
    if (file.startsWith(prefix)) {
      dldir = file;
      break;
    }
  }

  let iName = data.name;
  const nameExtIndex = iName.search(/@|＠/);
  if (nameExtIndex >= 1) iName = iName.substring(0, nameExtIndex);
  iName = iName.replace(/[/\\:*?"<>|.&$]/g, "").replace(/[ ]+$/, "");
  const dldirNew = `(${data.id})${iName}`;

  if (!dldir) {
    dldir = dldirNew;
  } else if (
    config.autoRename &&
    dldir.toLowerCase() !== dldirNew.toLowerCase()
  ) {
    try {
      await fse.rename(path.join(mainDir, dldir), path.join(mainDir, dldirNew));
      logger.info(
        "downloader",
        "directory.renamed",
        "Download directory renamed",
        {
          context: { from: dldir, to: dldirNew },
        },
      );
      dldir = dldirNew;
    } catch (err) {
      logger.warn(
        "downloader",
        "directory.rename_failed",
        "Download directory rename failed",
        {
          context: { from: dldir, to: dldirNew },
          error: err,
        },
      );
    }
  }

  return dldir;
}

export async function downloadByIllusts(illustJSON: any[]): Promise<void> {
  logger.info(
    "downloader",
    "metadata.collection_started",
    "Collecting illustration metadata",
    {
      context: { count: illustJSON.length },
    },
  );
  // Network requests are sent in parallel only when requesting a ugoira.
  const results = await Promise.all(
    illustJSON.map((json) =>
      illustMetadataLimit(() => Illust.getIllusts(json)),
    ),
  );
  const dldir = path.join(config.path!, "PID");
  const illusts = await filterMissingIllusts(results.flat(), dldir);
  logger.info(
    "downloader",
    "metadata.collection_completed",
    "Illustration metadata collected",
    {
      context: {
        requested: results.flat().length,
        missing: illusts.length,
        skipped: results.flat().length - illusts.length,
      },
    },
  );
  await downloadIllusts(illusts, dldir, config.thread);
}
