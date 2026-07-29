import fse from "fs-extra";
import path from "node:path";
import { getAppDataPath } from "./utils.js";
import { isImageSource, type ImageSource } from "./pixiv-image-url.js";
import { DEFAULT_ILLUST_POLICY, type IllustPolicy } from "./illust-policy.js";
import { isUgoiraFormat, type UgoiraFormat } from "./ugoira.js";

export interface DownloadConfig {
  thread: number;
  timeout: number;
  path?: string;
  tmp?: string;
  autoRename?: boolean;
  ugoiraFormat: UgoiraFormat;
}

export interface AppConfig {
  download: DownloadConfig;
  refresh_token?: string | null;
  proxy?: string | null;
  imageSource: ImageSource;
  filterNsfw: boolean;
}

export type RawAppConfig = Partial<Omit<AppConfig, "download">> & {
  download?: Partial<DownloadConfig>;
  ugoiraFormat?: unknown;
};

export const CONFIG_FILE_DIR = getAppDataPath("iroha");
export const CONFIG_FILE = path.resolve(CONFIG_FILE_DIR, "config.json");

export const DEFAULT_CONFIG: AppConfig = {
  download: {
    thread: 5,
    timeout: 30,
    ugoiraFormat: "zip",
  },
  imageSource: "direct",
  filterNsfw: false,
};

export function normalizeConfig(raw: RawAppConfig): AppConfig {
  const source = raw && typeof raw === "object" ? raw : ({} as RawAppConfig);
  const { ugoiraFormat: legacyUgoiraFormat, ...withoutLegacyFormat } = source;
  const rawDownload =
    source.download && typeof source.download === "object"
      ? source.download
      : {};
  const configuredUgoiraFormat = rawDownload.ugoiraFormat ?? legacyUgoiraFormat;

  return {
    ...withoutLegacyFormat,
    download: {
      ...DEFAULT_CONFIG.download,
      ...rawDownload,
      thread:
        typeof rawDownload.thread === "number" && rawDownload.thread > 0
          ? rawDownload.thread
          : DEFAULT_CONFIG.download.thread,
      timeout:
        typeof rawDownload.timeout === "number" && rawDownload.timeout > 0
          ? rawDownload.timeout
          : DEFAULT_CONFIG.download.timeout,
      ...(typeof rawDownload.path === "string"
        ? { path: rawDownload.path }
        : {}),
      ...(typeof rawDownload.tmp === "string" ? { tmp: rawDownload.tmp } : {}),
      ...(typeof rawDownload.autoRename === "boolean"
        ? { autoRename: rawDownload.autoRename }
        : {}),
      ugoiraFormat: isUgoiraFormat(configuredUgoiraFormat)
        ? configuredUgoiraFormat
        : DEFAULT_CONFIG.download.ugoiraFormat,
    },
    imageSource: isImageSource(source.imageSource)
      ? source.imageSource
      : DEFAULT_CONFIG.imageSource,
    filterNsfw:
      typeof source.filterNsfw === "boolean"
        ? source.filterNsfw
        : DEFAULT_CONFIG.filterNsfw,
  };
}

export function getIllustPolicy(
  config: AppConfig,
  overrides: Partial<IllustPolicy> = {},
): IllustPolicy {
  return {
    ...DEFAULT_ILLUST_POLICY,
    imageSource: config.imageSource,
    filterNsfw: config.filterNsfw,
    ugoiraFormat: config.download.ugoiraFormat,
    ...overrides,
  };
}

export async function initConfig(forceInit: boolean = false): Promise<void> {
  await fse.ensureDir(CONFIG_FILE_DIR);
  const exists = await fse.pathExists(CONFIG_FILE);
  if (!exists || forceInit) {
    await fse.writeJson(CONFIG_FILE, DEFAULT_CONFIG);
  }
}

export async function readConfig(): Promise<AppConfig> {
  await initConfig();
  try {
    const raw = (await fse.readJSON(CONFIG_FILE)) as RawAppConfig;
    const config = normalizeConfig(raw);
    try {
      await writeConfig(config);
    } catch {
      // A read should still return the usable configuration if persistence fails.
    }
    return config;
  } catch {
    return normalizeConfig({});
  }
}

export async function writeConfig(config: AppConfig): Promise<void> {
  await fse.ensureDir(CONFIG_FILE_DIR);
  await fse.writeJson(CONFIG_FILE, config);
}

export function isConfigComplete(config: AppConfig): boolean {
  return Boolean(config.refresh_token && config.download.path);
}
