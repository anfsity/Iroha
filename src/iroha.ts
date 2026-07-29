/**
 * Adapted from Tsuk1ko/pxder (https://github.com/Tsuk1ko/pxder)
 * Original file: bin/pxder
 */

import "colors";
import Pixiv from "./index.js";
import {
  CONFIG_FILE_DIR,
  getIllustPolicy,
  isConfigComplete,
  readConfig,
  type AppConfig,
} from "./config.js";
import logger from "./logger.js";
import { handleArguments } from "./cli/arguments.js";
import { createProgram, type CliOptions } from "./cli/program.js";

const program = createProgram();
program.parse(process.argv);

interface SystemError {
  errors: {
    system?: {
      message?: string;
    };
  };
}

function isSystemError(error: unknown): error is SystemError {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Partial<SystemError>;
  return candidate.errors?.system?.message !== undefined;
}

async function main(config: AppConfig, options: CliOptions): Promise<void> {
  const argumentResult = await handleArguments(config, options);
  if (!argumentResult.shouldDownload) return;

  if (!isConfigComplete(config)) {
    if (!config.refresh_token) {
      logger.error(
        "config",
        "auth.refresh_token.missing",
        "You must login first",
        { context: { command: "iroha --login" } },
      );
    }
    if (!config.download.path) {
      logger.error(
        "config",
        "download.path.missing",
        "You must set a download path first",
        { context: { command: "iroha --setting" } },
      );
    }
    logger.warn(
      "cli",
      "config.incomplete",
      "Run iroha -h for more usage information",
    );
    return;
  }

  const policy = argumentResult.policy ?? getIllustPolicy(config);
  if (options.exportToken) {
    process.stdout.write(`${config.refresh_token ?? ""}\n`);
    return;
  }

  const agent = await Pixiv.applyProxyConfig(config);
  const pixiv = new Pixiv(config, policy, agent);
  await pixiv.relogin();

  logger.info("cli", "download.started", "Download session started", {
    context: {
      outputDir: config.download.path || null,
      ugoiraFormat: policy.ugoiraFormat,
      filterNsfw: policy.filterNsfw,
      imageSource: policy.imageSource,
    },
  });
  if (typeof config.proxy === "string" && config.proxy.length > 0) {
    logger.info("proxy", "proxy.configured", "Using configured proxy", {
      context: { proxy: config.proxy },
    });
  }

  if (options.follow) await pixiv.downloadFollowAll(false, !!options.force);
  if (options.followPrivate) {
    await pixiv.downloadFollowAll(true, !!options.force);
  }
  if (options.update) await pixiv.downloadUpdate();
  if (options.bookmark) await pixiv.downloadBookmark();
  if (options.bookmarkPrivate) await pixiv.downloadBookmark(true);
  if (options.uid) {
    await pixiv.downloadByUIDs(options.uid.split(","));
  }
  if (options.pid) {
    await pixiv.downloadByPIDs(options.pid.split(","));
  }

  const hasDownloadTarget = Boolean(
    options.follow ||
    options.followPrivate ||
    options.update ||
    options.bookmark ||
    options.bookmarkPrivate ||
    options.uid ||
    options.pid,
  );
  if (!hasDownloadTarget) help();

  pixiv.clearReloginInterval();
  logger.info("cli", "download.completed", "Download session completed");
}

function help(): void {
  logger.warn("cli", "arguments.missing", "Missing arguments");
  program.outputHelp();
}

async function run(): Promise<void> {
  try {
    const config = await readConfig();
    await main(config, program.opts() as CliOptions);
    await logger.flush();
    process.exitCode = 0;
  } catch (error: unknown) {
    if (isSystemError(error)) {
      const message = error.errors.system?.message ?? "System error";
      logger.fatal("cli", "run.failed", message, {
        context: { category: "system" },
        error,
      });
      if (message === "Invalid refresh token") {
        logger.warn(
          "auth",
          "refresh_token.invalid",
          "Maybe CLIENT_ID and CLIENT_SECRET are updated; please try to relogin",
        );
      }
    } else {
      logger.fatal("cli", "run.failed", "Iroha terminated unexpectedly", {
        error,
      });
    }
    await logger.flush();
    process.exitCode = 1;
  }
}

void run();

export { CONFIG_FILE_DIR };
