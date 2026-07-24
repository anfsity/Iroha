/**
 * Adapted from Tsuk1ko/pxder (https://github.com/Tsuk1ko/pxder)
 * Original file: bin/pxder
 */

import "colors";
import Path from "path";
import Pixiv from "./index.js";
import pixivLogin from "./login.js";
import { checkProxy } from "./proxy.js";
import appState from "./appState.js";
import * as LoginProtocol from "./protocol/index.js";
import receiveLoginCode from "./protocol/receiver.js";
import { isLogFormat, isLogLevel, default as logger } from "./logger.js";
import { Command } from "commander";
import prompts from "prompts";
import open from "open";
import pkg from "../package.json" with { type: "json" };
import { getAppDataPath } from "./utils.js";
import { isUgoiraFormat } from "./ugoira.js";

const onCancel = () => {
  logger.info("cli", "prompt.cancelled", "Operation cancelled");
  process.exit(0);
};

/* -------------------------------------------------------------------------- */
/*  CLI definition                                                            */
/* -------------------------------------------------------------------------- */

const program = new Command();
const optionNewLine = "\n                         ";

program
  .usage("<options>")
  .option("--login [token]", "login Pixiv")
  .option("--logout", "logout Pixiv")
  .option(
    "--no-protocol",
    "use with --login to login without pixiv:// registration on Windows",
  )
  .option("--setting", "open options menu")
  .option(
    "-p, --pid <pid(s)>",
    "download illusts by PID, multiple PIDs separated by commas (,)",
  )
  .option(
    "-u, --uid <uid(s)>",
    "download / update illusts by UID, multiple UIDs separated by commas (,)",
  )
  .option("-f, --follow", "download / update illusts from your public follows")
  .option(
    "-F, --follow-private",
    "download / update illusts from your private follows",
  )
  .option("--force", "ignore last progress")
  .option(
    "-b, --bookmark",
    "download / update illusts from your public bookmark",
  )
  .option(
    "-B, --bookmark-private",
    "download / update illusts from your private bookmark",
  )
  .option(
    "-U, --update",
    "update all illustrators' illusts in your download path",
  )
  .option(
    "-M, --no-ugoira-meta",
    `will not request meta data for ugoira, it helps save time or${optionNewLine}avoid API rate limit error when downloading a tons of ugoiras`,
  )
  .option(
    "--ugoira-format <format>",
    "ugoira output format: zip, gif, or both (default: zip)",
  )
  .option("-O, --output-dir <dir>", "Specify download directory")
  .option("--debug", "enable debug logs")
  .option(
    "--log-level <level>",
    "log level: trace, debug, info, warn, error, or fatal",
  )
  .option("--log-format <format>", "log format: human or jsonl")
  .option("--log-file <path>", "write structured JSONL logs to a file")
  .option("--output-config-dir", "output the directory of config and exit")
  .option("--export-token", "output current refresh token and exit")
  .version(pkg.version, "-v, --version")
  .parse(process.argv);

/* -------------------------------------------------------------------------- */
/*  Main entry point                                                          */
/* -------------------------------------------------------------------------- */

interface systemError {
  errors: {
    system?: {
      message?: string;
    };
  };
}

function isSystemError(err: any): err is systemError {
  return (
    err &&
    typeof err === "object" &&
    "errors" in err &&
    err.errors?.system?.message !== undefined
  );
}

(async function run(): Promise<void> {
  try {
    const config = await Pixiv.readConfig();
    await main(config);
    await logger.flush();
    process.exitCode = 0;
  } catch (err: unknown) {
    if (isSystemError(err)) {
      const errMsg = err.errors.system!.message!;
      logger.fatal("cli", "run.failed", errMsg, {
        context: { category: "system" },
        error: err,
      });

      if (errMsg === "Invalid refresh token") {
        logger.warn(
          "auth",
          "refresh_token.invalid",
          "Maybe CLIENT_ID and CLIENT_SECRET are updated; please try to relogin",
        );
      }
    } else {
      logger.fatal("cli", "run.failed", "Iroha terminated unexpectedly", {
        error: err,
      });
    }
    await logger.flush();
    process.exitCode = 1;
  }
})();

/* -------------------------------------------------------------------------- */
/*  Core logic                                                                */
/* -------------------------------------------------------------------------- */
async function main(config: any): Promise<void> {
  const shouldDownload = await handleArgv(config);
  if (!shouldDownload) return;

  const opts = program.opts();

  // Validate configuration
  if (!(await Pixiv.checkConfig(config))) {
    logger.warn(
      "cli",
      "config.incomplete",
      "Run iroha -h for more usage information",
    );
    return;
  }

  // Export refresh token
  if (opts.exportToken) {
    process.stdout.write(`${config.refresh_token ?? ""}\n`);
    return;
  }

  await Pixiv.applyConfig(config);

  // Re-authenticate
  const pixiv = new Pixiv();
  await pixiv.relogin();

  // Begin downloading
  logger.info("cli", "download.started", "Download session started", {
    context: {
      outputDir: config.download.path || null,
      ugoiraFormat: appState.ugoiraFormat,
    },
  });
  if (typeof config.proxy === "string" && config.proxy.length > 0) {
    logger.info("proxy", "proxy.configured", "Using configured proxy", {
      context: { proxy: config.proxy },
    });
  }

  if (opts.follow) await pixiv.downloadFollowAll(false, !!opts.force);
  if (opts.followPrivate) await pixiv.downloadFollowAll(true, !!opts.force);
  if (opts.update) await pixiv.downloadUpdate();
  if (opts.bookmark) await pixiv.downloadBookmark();
  if (opts.bookmarkPrivate) await pixiv.downloadBookmark(true);

  if (opts.uid) {
    if (typeof opts.uid === "string") {
      const uidArray = opts.uid.split(",");
      await pixiv.downloadByUIDs(uidArray);
    } else {
      help();
    }
  }

  if (opts.pid) {
    if (typeof opts.pid === "string") {
      const pidArray = opts.pid.split(",");
      await pixiv.downloadByPIDs(pidArray);
    } else {
      help();
    }
  }

  const hasDownloadTarget =
    opts.follow ||
    opts.followPrivate ||
    opts.update ||
    opts.bookmark ||
    opts.bookmarkPrivate ||
    opts.uid ||
    opts.pid;

  if (!hasDownloadTarget) {
    help();
  }

  pixiv.clearReloginInterval();
  logger.info("cli", "download.completed", "Download session completed");
}

/* -------------------------------------------------------------------------- */
/*  Argument handling                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Processes CLI arguments for login, logout, settings, and global flags.
 *
 * @returns `true` if the caller should proceed to the download phase,
 *          `false` if the command was fully handled (e.g. login, settings).
 */
async function handleArgv(config: any): Promise<boolean> {
  const opts = program.opts();

  const logLevel = opts.logLevel ?? (opts.debug ? "debug" : "info");
  const logFormat = opts.logFormat ?? "human";
  if (!isLogLevel(logLevel)) {
    throw new Error(`Invalid log level: ${String(logLevel)}`);
  }
  if (!isLogFormat(logFormat)) {
    throw new Error(`Invalid log format: ${String(logFormat)}`);
  }
  logger.configure({
    level: logLevel,
    format: logFormat,
    filePath: opts.logFile ?? null,
  });

  if (opts.outputConfigDir) {
    logger.info("cli", "config.directory", "Configuration directory", {
      context: { path: getAppDataPath("iroha") },
    });
    return false;
  }

  appState.debug = !!opts.debug;
  appState.ugoiraMeta = !!opts.ugoiraMeta;
  const ugoiraFormat = opts.ugoiraFormat ?? config.download.ugoiraFormat;
  if (!isUgoiraFormat(ugoiraFormat)) {
    throw new Error(
      `Invalid ugoira format "${String(ugoiraFormat)}"; expected zip, gif, or both`,
    );
  }
  appState.ugoiraFormat = ugoiraFormat;

  // Clean up stale protocol registration (Windows only)
  if (process.platform === "win32" && (await LoginProtocol.exists())) {
    await LoginProtocol.uninstall();
  }

  // --- Login / Logout / Settings ---

  if (opts.login !== undefined) {
    await handleLogin(config, opts);
    return false;
  }

  if (opts.logout) {
    await Pixiv.logout();
    logger.info("auth", "logout.succeeded", "Logout succeeded");
    return false;
  }

  if (opts.setting) {
    await handleSettings(config);
    return false;
  }

  // Override download path if specified
  if (opts.outputDir) {
    config.download.path = Path.resolve(opts.outputDir);
  }

  return true;
}

/* -------------------------------------------------------------------------- */
/*  Login                                                                     */
/* -------------------------------------------------------------------------- */
async function handleLogin(
  config: any,
  opts: Record<string, unknown>,
): Promise<void> {
  logger.info("auth", "login.started", "Pixiv login started");
  try {
    await Pixiv.applyProxyConfig(config);

    if (typeof opts.login === "string") {
      // Token-based login
      const token = (opts.login as string).trim();
      logger.debug("auth", "login.token", "Login with refresh token", {
        context: { token },
      });
      await Pixiv.loginByToken(token);
    } else {
      // OAuth PKCE login
      const { login_url, code_verifier } = pixivLogin();
      let code: string;

      // Attempt automatic protocol-based login on Windows
      if (
        process.platform === "win32" &&
        opts.protocol &&
        (await LoginProtocol.canInstall()) &&
        (await LoginProtocol.install())
      ) {
        logger.info("auth", "login.url", "Waiting for browser login", {
          context: {
            url: login_url,
            instructions:
              "https://github.com/anfsity/Iroha/blob/main/README.md",
          },
        });

        open(login_url);
        code = await receiveLoginCode();
        await LoginProtocol.uninstall();
      } else {
        // Fallback: manual code entry
        console.log(
          "Before login, please read this first ->",
          "https://github.com/anfsity/Iroha/blob/main/README.md".cyan,
        );

        const { confirm } = await prompts(
          {
            type: "confirm",
            name: "confirm",
            message: "Continue?",
            initial: true,
          },
          { onCancel },
        );

        if (!confirm) return;

        logger.info("auth", "login.url", "Open the login URL in a browser", {
          context: { url: login_url },
        });
        await open(login_url);
        code = await promptForCode();
      }

      await Pixiv.login(code, code_verifier);
    }

    logger.info("auth", "login.succeeded", "Login succeeded");
  } catch (error) {
    logger.error(
      "auth",
      "login.failed",
      "Login failed; check the input or proxy setting",
      { error },
    );
  }
}

/**
 * Repeatedly prompt the user until a non-empty code is entered.
 */
async function promptForCode(): Promise<string> {
  const response = await prompts(
    {
      type: "text",
      name: "code",
      message: "Code:".yellow,
      validate: (value: string) =>
        value.trim() ? true : "Code cannot be empty",
    },
    {
      onCancel: () => {
        process.exit(1);
      },
    },
  );

  if (typeof response.code === "string") {
    return response.code.trim();
  }
  throw new Error("Invalid code input");
}

/* -------------------------------------------------------------------------- */
/*  Settings                                                                  */
/* -------------------------------------------------------------------------- */
async function handleSettings(config: any): Promise<void> {
  while (true) {
    console.clear();
    console.log("Iroha Options".green);

    const choices = [
      {
        title:
          `Download path: `.yellow + (config.download.path || "Not set".bgRed),
        value: "path",
      },
      {
        title: `Download thread: `.yellow + config.download.thread,
        value: "thread",
      },
      {
        title: `Download timeout: `.yellow + config.download.timeout,
        value: "timeout",
      },
      {
        title:
          `Auto rename: `.yellow +
          (config.download.autoRename ? "Enabled" : "Disabled"),
        value: "rename",
      },
      {
        title: `Ugoira output: `.yellow + config.download.ugoiraFormat,
        value: "ugoiraFormat",
      },
      {
        title: `Proxy: `.yellow + (config.proxy || "From env vars"),
        value: "proxy",
      },
      { title: "Exit".magenta, value: "exit" },
    ];

    const { action } = await prompts(
      {
        type: "select",
        name: "action",
        message: "Select a setting to modify:",
        choices,
      },
      { onCancel },
    );

    if (!action || action === "exit") break;

    switch (action) {
      case "path":
        await handleSettingDownloadPath(config);
        break;
      case "thread":
        await handleSettingDownloadThread(config);
        break;
      case "timeout":
        await handleSettingDownloadTimeout(config);
        break;
      case "rename":
        config.download.autoRename = !config.download.autoRename;
        break;
      case "ugoiraFormat":
        await handleSettingUgoiraFormat(config);
        break;
      case "proxy":
        await handleSettingProxy(config);
        break;
    }

    await Pixiv.writeConfig(config);
  }

  logger.info("config", "settings.saved", "Settings saved");
}

async function handleSettingDownloadPath(config: any): Promise<void> {
  const initial = config.download.path || "";
  const response = await prompts({
    type: "text",
    name: "value",
    message: "Please input a download path".yellow,
    format: (v: string) => Path.resolve(v.trim()),
    initial,
  });
  if (response.value) {
    config.download.path = response.value;
  }
}

async function handleSettingDownloadThread(config: any): Promise<void> {
  const { value } = await prompts(
    {
      type: "number",
      name: "value",
      message: "Download threads (1-32):",
      initial: config.download.thread || 5,
      validate: (v) => (v >= 1 && v <= 32 ? true : "Must be between 1 and 32"),
    },
    { onCancel },
  );

  if (value !== undefined) {
    config.download.thread = value;
  }
}

async function handleSettingDownloadTimeout(config: any): Promise<void> {
  const { value } = await prompts(
    {
      type: "number",
      name: "value",
      message: "Download timeout (seconds):",
      initial: config.download.timeout || 30,
      validate: (v) => (v > 0 ? true : "Must be greater than 0"),
    },
    { onCancel },
  );

  if (value !== undefined) {
    config.download.timeout = value;
  }
}

async function handleSettingUgoiraFormat(config: any): Promise<void> {
  const { value } = await prompts(
    {
      type: "select",
      name: "value",
      message: "Ugoira output format:",
      choices: [
        { title: "ZIP only", value: "zip" },
        { title: "GIF only", value: "gif" },
        { title: "GIF and ZIP", value: "both" },
      ],
      initial: ["zip", "gif", "both"].indexOf(
        config.download.ugoiraFormat,
      ),
    },
    { onCancel },
  );

  if (isUgoiraFormat(value)) {
    config.download.ugoiraFormat = value;
  }
}

async function handleSettingProxy(config: any): Promise<void> {
  const message =
    "Please input your HTTP/SOCKS proxy like:\n".yellow +
    "  <protocol>://[user:passwd@]<hostname>[:<port>]\n" +
    "  <protocol> can be http(s) / socks(4|4a|5|5h) / pac+(http|https|ftp|file)\n" +
    "Example\n".yellow +
    "  http://127.0.0.1:1080\n" +
    "  socks://127.0.0.1:7890\n" +
    "If you input nothing, iroha will load proxy from environment variables if available.\n"
      .yellow +
    "If you want to fully DISABLE it, please input ".yellow +
    "disable".red +
    ".\n".yellow;

  const response = await prompts(
    {
      type: "text",
      name: "value",
      message: message,
      validate: (input: string) =>
        checkProxy(input) ? true : "Incorrect format, please re-input.".bgRed,
    },
    { onCancel },
  );

  if (response.value !== undefined) {
    config.proxy = response.value;
  }
}
/* -------------------------------------------------------------------------- */
/*  Utilities                                                                 */
/* -------------------------------------------------------------------------- */

function help(): void {
  logger.warn("cli", "arguments.missing", "Missing arguments");
  program.outputHelp();
}
