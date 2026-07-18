/**
 * Adapted from Tsuk1ko/pxder (https://github.com/Tsuk1ko/pxder)
 * Original file: bin/pxder
 */

import "colors";
import Path from "path";
import Pixiv from "./index.js";
import pixivLogin from "./login.js";
import logError from "./logError.js";
import { checkProxy } from "./proxy.js";
import appState from "./appState.js";
import * as LoginProtocol from "./protocol/index.js";
import receiveLoginCode from "./protocol/receiver.js";
import { Command } from "commander";
import prompts from "prompts";
import open from "open";
import pkg from "../package.json" with { type: "json" };
import { getAppDataPath } from "./utils.js";

const onCancel = () => {
  console.log("\nOperation cancelled.".yellow);
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
  .option("-O, --output-dir <dir>", "Specify download directory")
  .option("--debug", "output all error messages while running")
  .option("--output-config-dir", "output the directory of config and exit")
  .option("--export-token", "output current refresh token and exit")
  .version(pkg.version, "-v, --version")
  .parse(process.argv);

/* -------------------------------------------------------------------------- */
/*  Main entry point                                                          */
/* -------------------------------------------------------------------------- */

const config = Pixiv.readConfig();

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
    await main();
    process.exit(0);
  } catch (err: unknown) {
    if (appState.debug) {
      logError(err);
      return;
    }

    if (isSystemError(err)) {
      const errMsg = err.errors.system!.message!;
      console.error(`\n${"ERROR:".red} ${errMsg}\n`);

      if (errMsg === "Invalid refresh token") {
        console.log(
          "Maybe CLIENT_ID and CLIENT_SECRET are updated, please try to relogin.\n"
            .yellow,
        );
      }
      return;
    }

    logError(err);

    process.exit(0);
  }
})();

/* -------------------------------------------------------------------------- */
/*  Core logic                                                                */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const shouldDownload = await handleArgv();
  if (!shouldDownload) return;

  const opts = program.opts();

  // Validate configuration
  if (!Pixiv.checkConfig(config)) {
    console.log(
      "\nRun " + "iroha -h".yellow + " for more usage information.\n",
    );
    return;
  }

  // Export refresh token
  if (opts.exportToken) {
    console.log(config.refresh_token);
    return;
  }

  Pixiv.applyConfig(config);

  // Re-authenticate
  const pixiv = new Pixiv();
  await pixiv.relogin();

  // Begin downloading
  console.log(
    "\nDownload Path:\t".cyan +
      (config.download.path ? config.download.path.toString().yellow : ""),
  );
  if (typeof config.proxy === "string" && config.proxy.length > 0) {
    console.log("Using Proxy:\t".cyan + config.proxy.yellow);
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
  console.log();
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
async function handleArgv(): Promise<boolean> {
  const opts = program.opts();

  if (opts.outputConfigDir) {
    console.log(getAppDataPath("iroha"));
    return false;
  }

  appState.debug = !!opts.debug;
  appState.ugoiraMeta = !!opts.ugoiraMeta;

  // Clean up stale protocol registration (Windows only)
  if (process.platform === "win32" && (await LoginProtocol.exists())) {
    await LoginProtocol.uninstall();
  }

  // --- Login / Logout / Settings ---

  if (opts.login !== undefined) {
    await handleLogin(opts);
    return false;
  }

  if (opts.logout) {
    Pixiv.logout();
    console.log("\nLogout success!\n".green);
    return false;
  }

  if (opts.setting) {
    await handleSettings();
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

async function handleLogin(opts: Record<string, unknown>): Promise<void> {
  console.log("\nPixiv Login\n".cyan);
  try {
    Pixiv.applyProxyConfig(config);

    if (typeof opts.login === "string") {
      // Token-based login
      const token = (opts.login as string).trim();
      console.log("Login with refresh token", token.yellow);
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
        console.log("Login URL:", login_url.cyan);
        console.log(
          "Waiting login... More details:",
          "https://github.com/anfsity/Iroha/blob/main/README.md".cyan,
        );

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

        console.log("\nLogin URL:", login_url.cyan);
        await open(login_url);
        code = await promptForCode();
      }

      await Pixiv.login(code, code_verifier);
    }

    console.log("\nLogin success!\n".green);
  } catch (error) {
    console.log(
      "\nLogin fail!".red,
      "Please check your input or proxy setting.\n",
    );

    if (appState.debug) {
      console.error(error);
    }
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

async function handleSettings(): Promise<void> {
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
        await handleSettingDownloadPath();
        break;
      case "thread":
        await handleSettingDownloadThread();
        break;
      case "timeout":
        await handleSettingDownloadTimeout();
        break;
      case "rename":
        config.download.autoRename = !config.download.autoRename;
        break;
      case "proxy":
        await handleSettingProxy();
        break;
    }

    Pixiv.writeConfig(config);
  }

  console.log("Settings saved.".green);
}

async function handleSettingDownloadPath(): Promise<void> {
  const initial = config.download.path || "";
  config.download.path =
    (
      await prompts({
        type: "text",
        name: "value",
        message: "Please input a download path".yellow,
        format: (v: string) => Path.resolve(v.trim()),
        initial,
      })
    ).value || initial;
}

async function handleSettingDownloadThread(): Promise<void> {
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

async function handleSettingDownloadTimeout(): Promise<void> {
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

async function handleSettingProxy(): Promise<void> {
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
  console.error("\nMissing arguments!".bgRed);
  program.outputHelp();
}
