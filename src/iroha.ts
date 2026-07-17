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
import readline from "readline-sync";
import prompts from "prompts";
import open from "open";
import { createRequire } from "module";

/* -------------------------------------------------------------------------- */
/*  Package metadata                                                          */
/* -------------------------------------------------------------------------- */

const require = createRequire(import.meta.url);
const pkg: { version: string } = (() => {
  try {
    return require("../package.json");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND") {
      throw error;
    }
    return require("../../package.json");
  }
})();

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

main()
  .then(() => {
    process.exit(0);
  })
  .catch((e: unknown) => {
    if (appState.debug) {
      logError(e);
    } else if (typeof e === "object" && e !== null && "errors" in e) {
      const err = e as { errors?: { system?: { message?: string } } };
      const errMsg = err.errors?.system?.message;
      if (errMsg) {
        console.error(`\n${"ERROR:".red} ${errMsg}\n`);
        if (errMsg === "Invalid refresh token") {
          console.log(
            "Maybe CLIENT_ID and CLIENT_SECRET are updated, please try to relogin.\n"
              .yellow,
          );
        }
      } else {
        logError(e);
      }
    } else {
      logError(e);
    }
    process.exit(1);
  });

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
    const { getAppDataPath } = require("appdata-path") as {
      getAppDataPath: (name: string) => string;
    };
    console.log(getAppDataPath("iroha"));
    return false;
  }

  // Global flags → typed singleton instead of `(global as any)`
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
          "https://git.io/Jt6Lj".cyan,
        );
        open(login_url);
        code = await receiveLoginCode();
        await LoginProtocol.uninstall();
      } else {
        // Fallback: manual code entry
        console.log(
          "Before login, please read this first ->",
          "https://git.io/Jt6Lj".cyan,
        );
        if (!readline.keyInYN("Continue?")) return;
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
    if (appState.debug) console.error(error);
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
      validate: (value: string) => (value.trim() ? true : "Code cannot be empty"),
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
  let index: number;

  do {
    console.clear();
    console.log("Iroha Options".green);

    const optionsMenu = [
      "Download path\t".yellow +
        (config.download.path
          ? config.download.path
          : "Null, please set one".bgRed),
      "Download thread\t".yellow + config.download.thread,
      "Download timeout\t".yellow + config.download.timeout,
      "Auto rename\t\t".yellow +
        (config.download.autoRename ? "Enabled" : "Disabled"),
      "Proxy\t\t".yellow +
        (checkProxy(config.proxy) && config.proxy
          ? config.proxy === "disable"
            ? "Disabled"
            : config.proxy
          : "From env vars"),
    ];

    index = readline.keyInSelect(optionsMenu, "Press a key:", {
      cancel: "Exit".bgMagenta,
    });
    console.log();

    switch (index) {
      case 0:
        await handleSettingDownloadPath();
        break;
      case 1:
        handleSettingDownloadThread();
        break;
      case 2:
        handleSettingDownloadTimeout();
        break;
      case 3:
        config.download.autoRename = !config.download.autoRename;
        break;
      case 4:
        handleSettingProxy();
        break;
    }

    Pixiv.writeConfig(config);
  } while (index !== -1);

  console.log("Exit".green);
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

function handleSettingDownloadThread(): void {
  config.download.thread = getStrictIntInput(
    "Please input the number of download thread:".yellow +
      " [1-32, default is 5]\n",
    { defaultInput: "5" },
    (input: number) => input >= 1 && input <= 32,
    "It must be between 1 and 32.",
  );
}

function handleSettingDownloadTimeout(): void {
  config.download.timeout = getStrictIntInput(
    "Please input the seconds of download timeout:".yellow +
      " [default is 30]\n",
    { defaultInput: "30" },
    (input: number) => input > 0,
    "It must be greater than 0.",
  );
}

function handleSettingProxy(): void {
  config.proxy = readline.question(
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
      ".\n".yellow,
    {
      limitMessage: "\nIncorrect format, please re-input.\n".bgRed,
      limit: checkProxy,
    },
  );
}

/* -------------------------------------------------------------------------- */
/*  Utilities                                                                 */
/* -------------------------------------------------------------------------- */

function getStrictIntInput(
  question: string,
  option: readline.BasicOptions,
  limit: (input: number) => boolean,
  limitReply: string,
): number {
  let result = readline.questionInt(question, option);
  while (!limit(result)) {
    console.log("\n" + limitReply.bgRed + "\n");
    result = readline.questionInt(question, option);
  }
  return result;
}

function help(): void {
  console.error("\nMissing arguments!".bgRed);
  program.outputHelp();
}
