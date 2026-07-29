/**
 * Copyright (C) 2026 Anfsity
 *
 * Adapted from Tsuk1ko/pxder (https://github.com/Tsuk1ko/pxder)
 * Original file: src/downloader.js
 */

import fse from "fs-extra";
import path from "node:path";
import Illust from "./illustration.js";
import logger from "./logger.js";
import {
  convertUgoiraToGif,
  getUgoiraGifFilename,
  type UgoiraFormat,
} from "./ugoira.js";
import { getIllustContext, getTaskId, isUgoira } from "./download-files.js";

export async function finalizeUgoira(
  illust: Illust,
  zipPath: string,
  dldir: string,
  ugoiraFormat: UgoiraFormat,
): Promise<boolean> {
  // Regular illustrations are already in their final format. Only a ZIP
  // produced for an ugoira can be converted to GIF.
  if (!isUgoira(illust) || ugoiraFormat === "zip") return true;

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

  if (ugoiraFormat === "gif") {
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
