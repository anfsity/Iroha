/**
 * Adapted from Tsuk1ko/pxder (https://github.com/Tsuk1ko/pxder)
 * Original file: src/tools.js
 */

import fse from "fs-extra";
import path from "node:path";
import * as readline from "readline";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import "colors";
import { homedir, platform } from "node:os";

export type DownloadOptions = AxiosRequestConfig & {
  resume?: boolean;
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
  return setInterval(() => {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write("Progress: " + `${valFn()}`.green);
  }, 500);
}

export function clearProgress(interval: NodeJS.Timeout): void {
  clearInterval(interval);
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
}

export async function download(
  dirpath: string,
  filename: string,
  url: string,
  axiosOption: DownloadOptions = {},
): Promise<AxiosResponse> {
  await fse.ensureDir(dirpath);
  const { resume = true, ...requestOptions } = axiosOption;
  const outputPath = path.join(dirpath, filename);
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

    return res;
  } catch (err: any) {
    if (timeout) {
      clearTimeout(timeout);
    }

    if (err.name === "AbortError" || err.message === "canceled") {
      throw new Error("Connection timeout");
    }

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
