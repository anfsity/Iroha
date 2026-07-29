/**
 * Adapted from Tsuk1ko/pxder (https://github.com/Tsuk1ko/pxder)
 * Original file: src/tools.js
 */

import fse from "fs-extra";
import path from "node:path";
import { homedir, platform } from "node:os";
import { startProgress, stopProgress } from "./progress.js";

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
export { download } from "./download-transport.js";
export type { DownloadOptions } from "./download-transport.js";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
