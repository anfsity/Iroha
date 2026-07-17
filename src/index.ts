import "colors";
import fse from "fs-extra";
import path from "node:path";

import { getProxyAgent, delSysProxy } from "./proxy.js";
import * as utils from "./utils.js";
import PixivApi from "./pixiv-api-client.js";
import * as Downloader from "./downloader.js";
import Illust from "./illustration.js";
import Illustrator from "./illustrator.js";
import appState from "./appState.js";

const CONFIG_FILE_DIR: string = utils.getAppDataPath("iroha");
const CONFIG_FILE = path.resolve(CONFIG_FILE_DIR, "config.json");

interface AppConfig {
  download: DownloadConfig;
  refresh_token?: string | null;
  proxy?: string | null;
}

const defaultConfig: AppConfig = {
  download: {
    thread: 5,
    timeout: 30,
  },
} as const;

let __config: AppConfig;

export default class Pixiv {
  private pixiv: PixivApi = new PixivApi();
  private reloginInterval: NodeJS.Timeout | null = null;
  private followNextUrl: string | null = null;

  static initConfig(forceInit: boolean = false): void {
    fse.ensureDirSync(CONFIG_FILE_DIR);
    if (!fse.existsSync(CONFIG_FILE_DIR) || forceInit) {
      fse.writeJsonSync(CONFIG_FILE, defaultConfig);
    }
  }

  static readConfig(): AppConfig {
    this.initConfig();
    const config: AppConfig = (() => {
      try {
        return fse.readJSONSync(CONFIG_FILE);
      } catch (err: any) {
        return defaultConfig;
      }
    })();

    config.download = {
      ...defaultConfig.download,
      ...config.download,
    };

    return config;
  }

  static writeConfig(config: AppConfig): void {
    fse.ensureDirSync(CONFIG_FILE_DIR);
    fse.writeJsonSync(CONFIG_FILE, config);
  }

  static checkConfig(config: AppConfig = this.readConfig()): boolean {
    let check: boolean = true;
    if (!config.refresh_token) {
      console.error(
        "\nYou must login first!".red + "\n Try " + "iroha --login".yellow,
      );
      check = false;
    }

    if (!config.download.path) {
      console.error(
        "\nYou must set download path first!".red +
          "\n Try " +
          "iroha --setting".yellow,
      );
    }

    return check;
  }

  static applyConfig(config: AppConfig = this.readConfig()): void {
    __config = config;
    config.download.tmp = path.join(CONFIG_FILE_DIR, "tmp");
    Downloader.setConfig(config.download);
    this.applyProxyConfig(config);
  }

  static applyProxyConfig(config: AppConfig = this.readConfig()): void {
    const agent = getProxyAgent(config.proxy);
    delSysProxy();
    if (agent) {
      Downloader.setAgent(agent);
      PixivApi.setAgent(agent);
      appState.proxyAgent = agent;
    }
  }

  static async login(code: string, code_verifier: string): Promise<void> {
    const pixivApi = new PixivApi();
    await pixivApi.tokenRequest(code, code_verifier);
    const refresh_token = pixivApi.authInfo().refresh_token;
    const config = this.readConfig();
    config.refresh_token = refresh_token;
    this.writeConfig(config);
  }

  static async loginByToken(token: string): Promise<void> {
    const pixivApi = new PixivApi();
    await pixivApi.refreshAccessToken(token);
    const config = this.readConfig();
    config.refresh_token = token;
    this.writeConfig(config);
  }

  // FIXME: ... Perhaps the author really doesnt know how to write asynchronous programming :)
  async relogin(): Promise<boolean> {
    const refresh_token = Pixiv.readConfig().refresh_token;
    if (!refresh_token) return false;

    this.clearReloginInterval();

    try {
      await this.pixiv.refreshAccessToken(refresh_token);
      Illustrator.setPixiv(this.pixiv);
      Illust.setPixiv(this.pixiv);
    } catch (err: any) {
      console.error("Initial Pixiv login refresh failed".red, err);
      return false;
    }

    const refreshLoop = async () => {
      try {
        if (this.pixiv) {
          await this.pixiv.refreshAccessToken(refresh_token);
          console.log("Automatic renewal successful.".green);
        }
      } catch (err: any) {
        console.error(
          "Automatic renewal failed; a retry will be attempted next time:".red,
          err,
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

  static logout(): void {
    const config = this.readConfig();
    config.refresh_token = null;
    this.writeConfig(config);
  }

  async getMyFollow(isPrivate: boolean): Promise<Illustrator[]> {
    const follows: Illustrator[] = [];
    let next = this.followNextUrl;

    const addToFollows = async (data: any) => {
      next = data.next_url;
      for (const preview of data.user_previews) {
        if (preview.user.id !== 11) {
          const tmp = new Illustrator(preview.user.id, preview.user.name);
          await tmp.setExampleIllusts(preview.illusts);
          follows.push(tmp);
        }
      }
    };

    if (next) {
      await this.pixiv.requestUrl(next).then(addToFollows);
    } else {
      await this.pixiv
        .userFollowing(this.pixiv.authInfo().user.id, {
          restrict: isPrivate ? "private" : "public",
        })
        .then(addToFollows);
    }

    this.followNextUrl = next;
    return follows;
  }

  hasNextFollow(): boolean {
    return !!this.followNextUrl;
  }

  async getAllMyFollow(isPrivate: boolean = false): Promise<Illustrator[]> {
    const follows: Illustrator[] = [];

    const processDisplay = utils.showProgress(() => follows.length);

    do {
      follows.push(...(await this.getMyFollow(isPrivate)));
    } while (this.followNextUrl);

    utils.clearProgress(processDisplay);

    return follows;
  }

  async downloadByUIDs(uids: string | string[]): Promise<void> {
    const uidArray = Array.isArray(uids) ? uids : [uids];
    for (const uid of uidArray) {
      await Downloader.downloadByIllustrators([new Illustrator(uid)]).catch(
        utils.logError,
      );
    }
  }

  async downloadBookmark(isPrivate: boolean = false): Promise<void> {
    const me = new Illustrator(this.pixiv.authInfo().user.id);
    await Downloader.downloadByBookmark(me, isPrivate);
  }

  async downloadFollowAll(isPrivate: boolean, force: boolean): Promise<void> {
    let follows: any[] | null = null;
    let illustrators: Illustrator[] | null = null;

    const tmpJson = path.join(
      CONFIG_FILE_DIR,
      (isPrivate ? "private" : "public") + ".json",
    );
    const tmpJsonExist = fse.existsSync(tmpJson);

    if (__config.download.path) {
      fse.ensureDirSync(__config.download.path);
    }

    if (
      !tmpJsonExist ||
      force ||
      (tmpJsonExist && !(follows = utils.readJsonSafely(tmpJson, null)))
    ) {
      console.log("\nCollecting your follows");
      follows = [];
      const ret = await this.getAllMyFollow(isPrivate);
      illustrators = ret;
      ret.forEach((illustrator) => {
        follows!.push({
          id: illustrator.id,
          name: illustrator.name,
          illusts: illustrator.exampleIllusts,
        });
      });
      fse.ensureDirSync(CONFIG_FILE_DIR);
      fse.writeJsonSync(tmpJson, follows);
    }

    if (!illustrators && follows) {
      illustrators = [];
      for (const follow of follows) {
        const tempI = new Illustrator(follow.id, follow.name);
        tempI.exampleIllusts = follow.illusts;
        illustrators.push(tempI);
      }
    }

    if (illustrators) {
      await Downloader.downloadByIllustrators(illustrators, () => {
        if (follows) {
          follows.shift();
          fse.ensureDirSync(CONFIG_FILE_DIR);
          fse.writeJsonSync(tmpJson, follows);
        }
      });
    }

    if (fse.existsSync(tmpJson)) {
      fse.unlinkSync(tmpJson);
    }
  }

  async downloadUpdate(): Promise<void> {
    const uids: string[] = [];
    if (!__config.download.path) return;

    fse.ensureDirSync(__config.download.path);
    const files = fse.readdirSync(__config.download.path);
    for (const file of files) {
      const search = /^\(([0-9]+)\)/.exec(file);
      if (search && search[1]) uids.push(search[1]);
    }
    const illustrators: Illustrator[] = [];
    uids.forEach((uid) => illustrators.push(new Illustrator(uid)));
    await Downloader.downloadByIllustrators(illustrators);
  }

  static utils() {
    return utils;
  }

  async downloadByPIDs(pids: string[]): Promise<void> {
    const jsons: any[] = [];
    if (!__config.download.path) return;

    const dirPath = path.join(__config.download.path, "PID");
    fse.ensureDirSync(dirPath);
    const exists = fse
      .readdirSync(dirPath)
      .map((file) => {
        const search = /^\(([0-9]+)\)/.exec(file);
        if (search && search[1]) return search[1];
        return null;
      })
      .filter((pid): pid is string => pid !== null);

    for (const pid of pids) {
      if (exists.includes(pid)) continue;
      try {
        const json = await this.pixiv.illustDetail(pid);
        jsons.push(json.illust);
      } catch (error) {
        console.log(`${pid} does not exist`.gray);
      }
    }
    await Downloader.downloadByIllusts(jsons);
  }
}
