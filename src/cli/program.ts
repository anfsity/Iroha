/**
 * Adapted from Tsuk1ko/pxder (https://github.com/Tsuk1ko/pxder)
 * Original file: bin/pxder
 */

import { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };

export interface CliOptions {
  login?: string | boolean;
  logout?: boolean;
  protocol?: boolean;
  setting?: boolean;
  pid?: string;
  uid?: string;
  follow?: boolean;
  followPrivate?: boolean;
  force?: boolean;
  bookmark?: boolean;
  bookmarkPrivate?: boolean;
  update?: boolean;
  ugoiraMeta?: boolean;
  ugoiraFormat?: string;
  outputDir?: string;
  debug?: boolean;
  logLevel?: string;
  logFormat?: string;
  logFile?: string;
  outputConfigDir?: boolean;
  exportToken?: boolean;
}

export function createProgram(): Command {
  const optionNewLine = "\n                         ";
  return new Command()
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
    .option(
      "-f, --follow",
      "download / update illusts from your public follows",
    )
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
    .version(pkg.version, "-v, --version");
}
