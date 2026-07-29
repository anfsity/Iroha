/**
 * Adapted from Tsuk1ko/pxder (https://github.com/Tsuk1ko/pxder)
 * Original file: bin/pxder
 */

import * as LoginProtocol from "../protocol/index.js";
import path from "node:path";
import Pixiv from "../index.js";
import { getIllustPolicy, type AppConfig } from "../config.js";
import logger, { isLogFormat, isLogLevel } from "../logger.js";
import { getAppDataPath } from "../utils.js";
import { isUgoiraFormat } from "../ugoira.js";
import { handleLogin } from "./login.js";
import { handleSettings } from "./settings.js";
import type { CliOptions } from "./program.js";

export interface ArgumentResult {
  shouldDownload: boolean;
  policy?: ReturnType<typeof getIllustPolicy>;
}

export async function handleArguments(
  config: AppConfig,
  options: CliOptions,
): Promise<ArgumentResult> {
  const logLevel = options.logLevel ?? (options.debug ? "debug" : "info");
  const logFormat = options.logFormat ?? "human";
  if (!isLogLevel(logLevel)) {
    throw new Error(`Invalid log level: ${String(logLevel)}`);
  }
  if (!isLogFormat(logFormat)) {
    throw new Error(`Invalid log format: ${String(logFormat)}`);
  }
  logger.configure({
    level: logLevel,
    format: logFormat,
    filePath: options.logFile ?? null,
  });

  if (options.outputConfigDir) {
    logger.info("cli", "config.directory", "Configuration directory", {
      context: { path: getAppDataPath("iroha") },
    });
    return { shouldDownload: false };
  }

  const ugoiraFormat = options.ugoiraFormat ?? config.download.ugoiraFormat;
  if (!isUgoiraFormat(ugoiraFormat)) {
    throw new Error(
      `Invalid ugoira format "${String(ugoiraFormat)}"; expected zip, gif, or both`,
    );
  }

  if (process.platform === "win32" && (await LoginProtocol.exists())) {
    await LoginProtocol.uninstall();
  }

  if (options.login !== undefined) {
    await handleLogin(config, options);
    return { shouldDownload: false };
  }
  if (options.logout) {
    await Pixiv.logout();
    logger.info("auth", "logout.succeeded", "Logout succeeded");
    return { shouldDownload: false };
  }
  if (options.setting) {
    await handleSettings(config);
    return { shouldDownload: false };
  }

  if (options.outputDir) config.download.path = path.resolve(options.outputDir);
  return {
    shouldDownload: true,
    policy: getIllustPolicy(config, {
      ugoiraMeta: options.ugoiraMeta !== false,
      ugoiraFormat,
    }),
  };
}
