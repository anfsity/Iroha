/**
 * Adapted from Tsuk1ko/pxder (https://github.com/Tsuk1ko/pxder)
 * Original file: bin/pxder
 */

import "colors";
import open from "open";
import prompts from "prompts";
import Pixiv from "../index.js";
import pixivLogin from "../login.js";
import * as LoginProtocol from "../protocol/index.js";
import receiveLoginCode from "../protocol/receiver.js";
import { type AppConfig } from "../config.js";
import logger from "../logger.js";
import type { CliOptions } from "./program.js";

const onCancel = () => {
  logger.info("cli", "prompt.cancelled", "Operation cancelled");
  process.exit(0);
};

export async function handleLogin(
  config: AppConfig,
  options: CliOptions,
): Promise<void> {
  logger.info("auth", "login.started", "Pixiv login started");
  try {
    await Pixiv.applyProxyConfig(config);

    if (typeof options.login === "string") {
      const token = options.login.trim();
      logger.debug("auth", "login.token", "Login with refresh token", {
        context: { token },
      });
      await Pixiv.loginByToken(token);
    } else {
      const { login_url, code_verifier } = pixivLogin();
      let code: string;

      if (
        process.platform === "win32" &&
        options.protocol &&
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
        await open(login_url);
        code = await receiveLoginCode();
        await LoginProtocol.uninstall();
      } else {
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

export async function promptForCode(): Promise<string> {
  const response = await prompts(
    {
      type: "text",
      name: "code",
      message: "Code:".yellow,
      validate: (value: string) =>
        value.trim() ? true : "Code cannot be empty",
    },
    {
      onCancel: () => process.exit(1),
    },
  );

  if (typeof response.code === "string") return response.code.trim();
  throw new Error("Invalid code input");
}
