import fse from "fs-extra";
import path from "node:path";
import * as readline from "readline";
import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import "colors";
import { homedir, platform } from "node:os";

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
  axiosOption: AxiosRequestConfig = {},
): Promise<AxiosResponse> {
  fse.ensureDirSync(dirpath);
  const controller = new AbortController();

  const config: AxiosRequestConfig = {
    ...axiosOption,
    headers: { ...axiosOption.headers },
    responseType: "arraybuffer",
    signal: controller.signal,
  };

  const finalUrl = new URL(url);

  // why should we use timeout * 2 ? since the axios timeout only applies to the response, not the connection.
  let timeout: NodeJS.Timeout | null = axiosOption.timeout
    ? setTimeout(() => {
        controller.abort();
      }, axiosOption.timeout * 2)
    : null;

  try {
    const res = await axios.get(finalUrl.href, config);
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }

    fse.writeFileSync(path.join(dirpath, filename), res.data);
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

export function readJsonSafely<T>(path: string, defaultValue: T): T {
  if (!fse.existsSync(path)) {
    return defaultValue;
  }

  try {
    return fse.readJSONSync(path) as T;
  } catch (err) {
    return defaultValue;
  }
}

export class UgoiraDir {
  private files: Set<string>;

  constructor(dirpath: string) {
    const existingFiles = fse.existsSync(dirpath)
      ? fse
          .readdirSync(dirpath)
          .filter((file) => file.endsWith(".zip"))
          .map((file) => this.normalizeFilename(file))
      : [];

    this.files = new Set(existingFiles);
  }

  public existsSync(file: string): boolean {
    return this.files.has(this.normalizeFilename(file));
  }

  private normalizeFilename(filename: string): string {
    return filename.replace(/@\d+?ms/g, "");
  }
}

export { default as logError } from "./logError.js";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

