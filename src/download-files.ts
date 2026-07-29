/**
 * Copyright (C) 2026 Anfsity
 *
 * Adapted from Tsuk1ko/pxder (https://github.com/Tsuk1ko/pxder)
 * Original file: src/downloader.js
 */

import fse from "fs-extra";
import path from "node:path";
import type { DownloadConfig } from "./config.js";
import Illust from "./illustration.js";
import logger from "./logger.js";
import * as utils from "./utils.js";
import type { UgoiraFormat } from "./ugoira.js";

export function hasExpectedOutput(
  illust: Illust,
  dldir: string,
  ugoiraFormat: UgoiraFormat,
  ugoiraDir: utils.UgoiraDir = new utils.UgoiraDir(dldir),
): Promise<boolean> {
  if (!isUgoira(illust)) {
    return fse.pathExists(path.join(dldir, illust.file));
  }

  return hasExpectedUgoiraOutput(illust, dldir, ugoiraFormat, ugoiraDir);
}

async function hasExpectedUgoiraOutput(
  illust: Illust,
  dldir: string,
  ugoiraFormat: UgoiraFormat,
  ugoiraDir: utils.UgoiraDir,
): Promise<boolean> {
  const zipExists = await ugoiraDir.exists(illust.file);
  if (ugoiraFormat === "zip") return zipExists;

  const gifExists = await fse.pathExists(
    path.join(dldir, getUgoiraGifFilename(illust.file)),
  );
  return ugoiraFormat === "gif" ? gifExists : zipExists && gifExists;
}

export async function filterMissingIllusts(
  illusts: Illust[],
  dldir: string,
  ugoiraFormat: UgoiraFormat,
): Promise<Illust[]> {
  const ugoiraDir = new utils.UgoiraDir(dldir);
  const missing: Illust[] = [];

  for (const illust of illusts) {
    if (!(await hasExpectedOutput(illust, dldir, ugoiraFormat, ugoiraDir))) {
      missing.push(illust);
    }
  }

  return missing;
}

export async function findExistingUgoiraZip(
  illust: Illust,
  dldir: string,
): Promise<string | undefined> {
  return new utils.UgoiraDir(dldir).find(illust.file);
}

export async function getIllustratorNewDir(
  data: { id: number | string; name: string },
  config: DownloadConfig,
): Promise<string> {
  const mainDir = config.path;
  if (!mainDir) throw new Error("Download path is not configured");

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
        { context: { from: dldir, to: dldirNew } },
      );
      dldir = dldirNew;
    } catch (error) {
      logger.warn(
        "downloader",
        "directory.rename_failed",
        "Download directory rename failed",
        { context: { from: dldir, to: dldirNew }, error },
      );
    }
  }

  return dldir;
}

export function isUgoira(illust: Illust): boolean {
  return illust.file.toLowerCase().endsWith(".zip");
}

export function getIllustContext(illust: Illust): Record<string, unknown> {
  return {
    pid: illust.id,
    title: illust.title,
    filename: illust.file,
    url: illust.url,
    ugoira: isUgoira(illust),
  };
}

export function getTaskId(illust: Illust): string {
  return `illust-${illust.id}-${illust.file}`;
}

export function getUgoiraGifFilename(zipFilename: string): string {
  return zipFilename.replace(/\.zip$/i, ".gif");
}
