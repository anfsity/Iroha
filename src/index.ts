/**
 * Copyright (C) 2026 Anfsity
 *
 * Adapted from Tsuk1ko/pxder (https://github.com/Tsuk1ko/pxder)
 * Original file: src/index.js
 */

import fse from "fs-extra";
import path from "node:path";
import type { ProxyAgent } from "proxy-agent";
import { getProxyAgent, delSysProxy } from "./proxy.js";
import * as utils from "./utils.js";
import PixivApi from "./pixiv-api-client.js";
import {
  downloadByBookmark,
  downloadByIllusts,
  downloadByIllustrators,
  type DownloadContext,
} from "./download-orchestrator.js";
import Illust from "./illustration.js";
import Illustrator from "./illustrator.js";
import {
  CONFIG_FILE_DIR,
  DEFAULT_CONFIG,
  type AppConfig,
  getIllustPolicy,
  readConfig,
  writeConfig,
} from "./config.js";
import type { IllustPolicy } from "./illust-policy.js";
import logger from "./logger.js";

interface FollowCacheEntry {
  id: number | string;
  name: string;
  illusts: IllustObject[];
}

interface IllustObject {
  id: number | string;
  title: string;
  url: string;
  file: string;
  ugoiraFrames?: UgoiraFrame[];
}

function deserializeIllust(data: IllustObject): Illust {
  return new Illust(
    data.id,
    data.title,
    data.url,
    data.file,
    data.ugoiraFrames,
  );
}

function getRuntimeConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    download: {
      ...config.download,
      tmp: config.download.tmp ?? path.join(CONFIG_FILE_DIR, "tmp"),
    },
  };
}

export default class Pixiv {
  private pixiv: PixivApi = new PixivApi();
  private reloginInterval: NodeJS.Timeout | null = null;
  private followNextUrl: string | null = null;
  private readonly config: AppConfig;
  private readonly policy: IllustPolicy;
  private readonly agent: ProxyAgent | null;

  constructor(
    config: AppConfig = DEFAULT_CONFIG,
    policy?: IllustPolicy,
    agent: ProxyAgent | null = null,
  ) {
    this.config = getRuntimeConfig(config);
    this.policy = policy ?? getIllustPolicy(config);
    this.agent = agent;
  }

  private get downloadContext(): DownloadContext {
    return {
      config: this.config.download,
      policy: this.policy,
      agent: this.agent,
    };
  }

  static async applyProxyConfig(config: AppConfig): Promise<ProxyAgent | null> {
    const agent = getProxyAgent(config.proxy);

    // ProxyAgent reads environment variables when a request is made. Keep
    // them available when no explicit proxy is configured.
    const useSystemProxy =
      config.proxy === "" ||
      config.proxy === undefined ||
      config.proxy === null;
    if (!useSystemProxy) delSysProxy();

    if (agent) PixivApi.setAgent(agent);
    return agent;
  }

  static async login(code: string, codeVerifier: string): Promise<void> {
    const pixivApi = new PixivApi();
    await pixivApi.tokenRequest(code, codeVerifier);
    const refreshToken = pixivApi.authInfo().refresh_token;
    const config = await readConfig();
    config.refresh_token = refreshToken;
    await writeConfig(config);
  }

  static async loginByToken(token: string): Promise<void> {
    const pixivApi = new PixivApi();
    await pixivApi.refreshAccessToken(token);
    const config = await readConfig();
    config.refresh_token = token;
    await writeConfig(config);
  }

  static async logout(): Promise<void> {
    const config = await readConfig();
    config.refresh_token = null;
    await writeConfig(config);
  }

  // FIXME: Keep the access-token refresh loop alive while a download session runs.
  async relogin(): Promise<boolean> {
    const refreshToken = this.config.refresh_token;
    if (!refreshToken) return false;

    this.clearReloginInterval();

    try {
      await this.pixiv.refreshAccessToken(refreshToken);
      Illustrator.setPixiv(this.pixiv);
      Illust.setPixiv(this.pixiv);
    } catch (error) {
      logger.error(
        "auth",
        "refresh.failed",
        "Initial Pixiv login refresh failed",
        { error },
      );
      return false;
    }

    const refreshLoop = async (): Promise<void> => {
      try {
        await this.pixiv.refreshAccessToken(refreshToken);
        logger.info(
          "auth",
          "refresh.succeeded",
          "Automatic token renewal succeeded",
        );
      } catch (error) {
        logger.warn(
          "auth",
          "refresh.retry_scheduled",
          "Automatic renewal failed; a retry will be attempted next time",
          { error },
        );
      } finally {
        if (this.reloginInterval) {
          this.reloginInterval = setTimeout(refreshLoop, 40 * 60 * 1000);
        }
      }
    };

    this.reloginInterval = setTimeout(refreshLoop, 40 * 60 * 1000);
    return true;
  }

  clearReloginInterval(): void {
    if (this.reloginInterval) {
      clearTimeout(this.reloginInterval);
      this.reloginInterval = null;
    }
  }

  async getMyFollow(isPrivate: boolean): Promise<Illustrator[]> {
    const follows: Illustrator[] = [];
    let next = this.followNextUrl;

    const addToFollows = async (
      data: PixivFollowingResponse,
    ): Promise<void> => {
      next = data.next_url;
      for (const preview of data.user_previews) {
        if (preview.user.id !== 11) {
          const illustrator = new Illustrator(
            preview.user.id,
            preview.user.name,
            [],
            undefined,
            this.policy,
          );
          await illustrator.setExampleIllusts(preview.illusts);
          follows.push(illustrator);
        }
      }
    };

    if (next) {
      await addToFollows(
        await this.pixiv.requestUrl<PixivFollowingResponse>(next),
      );
    } else {
      await addToFollows(
        await this.pixiv.userFollowing(this.pixiv.authInfo().user.id, {
          restrict: isPrivate ? "private" : "public",
        }),
      );
    }

    this.followNextUrl = next;
    return follows;
  }

  async getAllMyFollow(isPrivate: boolean = false): Promise<Illustrator[]> {
    const follows: Illustrator[] = [];
    const processDisplay = utils.showProgress(() => follows.length);
    try {
      do {
        follows.push(...(await this.getMyFollow(isPrivate)));
      } while (this.followNextUrl);
    } finally {
      utils.clearProgress(processDisplay);
    }
    return follows;
  }

  async downloadByUIDs(uids: string | string[]): Promise<void> {
    const uidArray = Array.isArray(uids) ? uids : [uids];
    for (const uid of uidArray) {
      try {
        await downloadByIllustrators(
          [new Illustrator(uid, "", [], undefined, this.policy)],
          this.downloadContext,
        );
      } catch (error) {
        logger.error(
          "downloader",
          "illustrator.failed",
          "Illustrator download failed",
          { context: { uid }, error },
        );
      }
    }
  }

  async downloadBookmark(isPrivate: boolean = false): Promise<void> {
    const me = new Illustrator(
      this.pixiv.authInfo().user.id,
      "",
      [],
      undefined,
      this.policy,
    );
    await downloadByBookmark(me, this.downloadContext, isPrivate);
  }

  async downloadFollowAll(isPrivate: boolean, force: boolean): Promise<void> {
    let follows: FollowCacheEntry[] | null = null;
    let illustrators: Illustrator[] | null = null;
    const tmpJson = path.join(
      CONFIG_FILE_DIR,
      `${isPrivate ? "private" : "public"}.json`,
    );
    const tmpJsonExists = await fse.pathExists(tmpJson);

    if (this.config.download.path) {
      await fse.ensureDir(this.config.download.path);
    }

    if (
      !tmpJsonExists ||
      force ||
      !(follows = await utils.readJsonSafely<FollowCacheEntry[] | null>(
        tmpJson,
        null,
      ))
    ) {
      logger.info(
        "pixiv",
        "follows.collection_started",
        "Collecting followed illustrators",
        { context: { private: isPrivate } },
      );
      follows = [];
      const collected = await this.getAllMyFollow(isPrivate);
      illustrators = collected;
      follows.push(
        ...collected.map((illustrator) => ({
          id: illustrator.id,
          name: illustrator.name,
          illusts: illustrator.exampleIllusts.map((illust) =>
            illust.getObject(),
          ),
        })),
      );
      await fse.ensureDir(CONFIG_FILE_DIR);
      await fse.writeJson(tmpJson, follows);
    }

    if (!illustrators && follows) {
      illustrators = follows.map((follow) => {
        const illustrator = new Illustrator(
          follow.id,
          follow.name,
          [],
          undefined,
          this.policy,
        );
        illustrator.exampleIllusts = follow.illusts.map(deserializeIllust);
        return illustrator;
      });
    }

    if (illustrators) {
      await downloadByIllustrators(
        illustrators,
        this.downloadContext,
        async () => {
          if (follows) {
            follows.shift();
            await fse.ensureDir(CONFIG_FILE_DIR);
            await fse.writeJson(tmpJson, follows);
          }
        },
      );
    }

    if (await fse.pathExists(tmpJson)) await fse.unlink(tmpJson);
  }

  async downloadUpdate(): Promise<void> {
    const downloadPath = this.config.download.path;
    if (!downloadPath) return;

    await fse.ensureDir(downloadPath);
    const uids: string[] = [];
    for (const file of await fse.readdir(downloadPath)) {
      const search = /^\(([0-9]+)\)/.exec(file);
      if (search?.[1]) uids.push(search[1]);
    }

    await downloadByIllustrators(
      uids.map((uid) => new Illustrator(uid, "", [], undefined, this.policy)),
      this.downloadContext,
    );
  }

  static utils() {
    return utils;
  }

  async downloadByPIDs(pids: string[]): Promise<void> {
    if (!this.config.download.path) return;
    const jsons: PixivIllustJSON[] = [];
    await fse.ensureDir(path.join(this.config.download.path, "PID"));

    for (const pid of pids) {
      const normalizedPid = pid.trim();
      if (!normalizedPid) continue;
      try {
        const json = await this.pixiv.illustDetail(normalizedPid);
        jsons.push(json.illust);
      } catch (error) {
        logger.warn(
          "pixiv",
          "illust.not_found",
          "Illustration does not exist",
          { context: { pid: normalizedPid }, error },
        );
      }
    }
    await downloadByIllusts(jsons, this.downloadContext);
  }
}

export { getIllustPolicy };
