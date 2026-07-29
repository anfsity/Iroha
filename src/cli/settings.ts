/**
 * Copyright (C) 2026 Anfsity
 *
 * Adapted from Tsuk1ko/pxder (https://github.com/Tsuk1ko/pxder)
 * Original file: bin/pxder
 */

import "colors";
import Path from "path";
import prompts from "prompts";
import { type AppConfig, writeConfig } from "../config.js";
import { isImageSource } from "../pixiv-image-url.js";
import logger from "../logger.js";
import { checkProxy } from "../proxy.js";
import { isUgoiraFormat } from "../ugoira.js";

const onCancel = () => {
  logger.info("cli", "prompt.cancelled", "Operation cancelled");
  process.exit(0);
};

export async function handleSettings(config: AppConfig): Promise<void> {
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
        title:
          `Image source: `.yellow +
          (config.imageSource === "pixivcat"
            ? "PixivCat (i.pixiv.cat)"
            : "Direct (i.pximg.net)"),
        value: "imageSource",
      },
      {
        title:
          `Filter NSFW: `.yellow + (config.filterNsfw ? "Enabled" : "Disabled"),
        value: "filterNsfw",
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
      case "imageSource":
        await handleSettingImageSource(config);
        break;
      case "filterNsfw":
        config.filterNsfw = !config.filterNsfw;
        break;
      case "proxy":
        await handleSettingProxy(config);
        break;
    }
    await writeConfig(config);
  }
  logger.info("config", "settings.saved", "Settings saved");
}

async function handleSettingDownloadPath(config: AppConfig): Promise<void> {
  const response = await prompts({
    type: "text",
    name: "value",
    message: "Please input a download path".yellow,
    format: (value: string) => Path.resolve(value.trim()),
    initial: config.download.path || "",
  });
  if (response.value) config.download.path = response.value;
}

async function handleSettingDownloadThread(config: AppConfig): Promise<void> {
  const { value } = await prompts(
    {
      type: "number",
      name: "value",
      message: "Download threads (1-32):",
      initial: config.download.thread,
      validate: (input) =>
        input >= 1 && input <= 32 ? true : "Must be between 1 and 32",
    },
    { onCancel },
  );
  if (value !== undefined) config.download.thread = value;
}

async function handleSettingDownloadTimeout(config: AppConfig): Promise<void> {
  const { value } = await prompts(
    {
      type: "number",
      name: "value",
      message: "Download timeout (seconds):",
      initial: config.download.timeout,
      validate: (input) => (input > 0 ? true : "Must be greater than 0"),
    },
    { onCancel },
  );
  if (value !== undefined) config.download.timeout = value;
}

async function handleSettingUgoiraFormat(config: AppConfig): Promise<void> {
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
      initial: ["zip", "gif", "both"].indexOf(config.download.ugoiraFormat),
    },
    { onCancel },
  );
  if (isUgoiraFormat(value)) config.download.ugoiraFormat = value;
}

async function handleSettingImageSource(config: AppConfig): Promise<void> {
  const { value } = await prompts(
    {
      type: "select",
      name: "value",
      message: "Image source:",
      choices: [
        { title: "Direct (i.pximg.net)", value: "direct" },
        { title: "PixivCat (i.pixiv.cat)", value: "pixivcat" },
      ],
      initial: config.imageSource === "pixivcat" ? 1 : 0,
    },
    { onCancel },
  );
  if (isImageSource(value)) config.imageSource = value;
}

async function handleSettingProxy(config: AppConfig): Promise<void> {
  const message =
    "Please input your HTTP/SOCKS proxy like:\n" +
    "  <protocol>://[user:passwd@]<hostname>[:<port>]\n" +
    "  <protocol> can be http(s) / socks(4|4a|5|5h) / pac+(http|https|ftp|file)\n" +
    "Example\n  http://127.0.0.1:1080\n  socks://127.0.0.1:7890\n" +
    "If you input nothing, iroha will load proxy from environment variables if available.\n" +
    "If you want to fully DISABLE it, please input disable.\n";
  const response = await prompts(
    {
      type: "text",
      name: "value",
      message,
      validate: (input: string) =>
        checkProxy(input) ? true : "Incorrect format, please re-input.",
    },
    { onCancel },
  );
  if (response.value !== undefined) config.proxy = response.value;
}
