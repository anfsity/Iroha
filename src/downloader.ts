/**
 * Adapted from Tsuk1ko/pxder (https://github.com/Tsuk1ko/pxder)
 * Original file: src/downloader.js
 */

import "colors";
import fse from "fs-extra";
import path from "node:path";
import * as utils from "./utils.js";
import { sleep } from "./utils.js";
import Illust from "./illustration.js";
import Illustrator from "./illustrator.js";
import appState from "./appState.js";

const pixivRefer = "https://www.pixiv.net/";

interface DownloadListResult {
  dir: string;
  illusts: Illust[];
}

let config: DownloadConfig;
let httpsAgent: any = false;

export function setConfig(conf: DownloadConfig): void {
  config = conf;
}

export function setAgent(agent: any): void {
  httpsAgent = agent;
}

export async function downloadByIllustrators(
  illustrators: Illustrator[],
  callback?: (index: string | number) => void,
): Promise<void> {
  for (const [i, illustrator] of illustrators.entries()) {
    const illustrator = illustrators[i];
    if (!illustrator) continue;

    let illustratorInfo;
    try {
      illustratorInfo = await illustrator.info();
    } catch (err: any) {
      if (err instanceof Error) {
        console.log(err);
      } else {
        console.log(
          `\nIllustrator ${"uid ".gray}${illustrator.id.toString().cyan} may have left pixiv or does not exist.`,
        );
      }
      continue;
    }

    console.log(
      `\nCollecting illusts of ${(i + 1).toString().green}/${illustrators.length} ` +
        `${"uid ".gray}${illustrator.id.toString().cyan} ${illustrator.name.yellow}`,
    );

    const info = await getDownloadListByIllustrator(
      illustrator,
      illustratorInfo,
    );

    await downloadIllusts(
      info.illusts,
      path.join(config.path!, info.dir),
      config.thread,
    );

    callback?.(i);
  }
}

/**
 * Incrementally retrieve the list of undownloaded artworks by the illustrator.
 */
async function getDownloadListByIllustrator(
  illustrator: Illustrator,
  cachedInfo: any,
): Promise<DownloadListResult> {
  let illusts: Illust[] = [];

  const dir = await getIllustratorNewDir(cachedInfo);
  const dldir = path.join(config.path!, dir);
  const ugoiraDir = new utils.UgoiraDir(dldir);

  const illustExists = async (file: string) =>
    file.endsWith(".zip")
      ? await ugoiraDir.exists(file)
      : await fse.pathExists(path.join(dldir, file));

  const exampleIllusts = illustrator.exampleIllusts;
  if (exampleIllusts) {
    let existNum = 0;
    for (const ei of exampleIllusts) {
      if (await illustExists(ei.file)) {
        existNum++;
      } else {
        illusts.push(ei);
      }
    }

    if (existNum > 0) {
      return { dir, illusts: illusts.reverse() };
    }
  }

  illusts = [];
  const processDisplay = utils.showProgress(() => illusts.length);

  let cnt: number;
  do {
    cnt = 0;
    const temps = await illustrator.illusts();
    for (const temp of temps) {
      if (!(await illustExists(temp.file))) {
        illusts.push(temp);
        cnt++;
      }
    }
  } while (illustrator.hasNext("illust") && cnt > 0);

  utils.clearProgress(processDisplay);

  return { dir, illusts: illusts.reverse() };
}

export async function downloadByBookmark(
  me: Illustrator,
  isPrivate: boolean = false,
): Promise<void> {
  const dir = `[bookmark] ${isPrivate ? "Private" : "Public"}`;
  const dldir = path.join(config.path!, dir);
  const ugoiraDir = new utils.UgoiraDir(dldir);

  const illustExists = async (file: string) =>
    file.endsWith(".zip")
      ? await ugoiraDir.exists(file)
      : await fse.pathExists(path.join(dldir, file));

  console.log(
    `\nCollecting illusts of your bookmark (${isPrivate ? "Private" : "Public"})`,
  );

  const illusts: Illust[] = [];
  const processDisplay = utils.showProgress(() => illusts.length);

  let cnt: number;
  do {
    cnt = 0;
    const temps = await me.bookmarks(isPrivate);
    for (const temp of temps) {
      if (!(await illustExists(temp.file))) {
        illusts.push(temp);
        cnt++;
      }
    }
  } while (me.hasNext("bookmark") && cnt > 0);

  utils.clearProgress(processDisplay);
  await downloadIllusts(illusts.reverse(), dldir, config.thread);
}

export async function downloadIllusts(
  illusts: Illust[],
  dldir: string,
  totalThread: number,
): Promise<any[]> {
  const tempDir = config.tmp!;

  await fse.emptyDir(tempDir);
  await fse.ensureDir(dldir);

  const hangup = 5 * 60 * 1000;
  const max_retries = 10;
  let pause = false;
  let continuousErr = 0;

  const downloadOne = async (
    illust: Illust,
    threadID: number,
    i: number,
  ): Promise<void> => {
    const logPrefix = `[${threadID}]\t${(i + 1).toString().green}/${illusts.length}\t ${"pid".gray} ${illust.id.toString().cyan}\t`;

    const options = {
      headers: { referer: pixivRefer },
      timeout: 1000 * config.timeout,
      httpsAgent: httpsAgent || undefined,
    };

    for (let attempt = 1; attempt <= max_retries; ++attempt) {
      while (pause) {
        await sleep(1000);
      }

      try {
        const dlFile = path.join(tempDir, illust.file);
        const finalFile = path.join(dldir, illust.file);

        const res = await utils.download(
          tempDir,
          illust.file,
          illust.url,
          options,
        );

        const expectedSize = res.headers["content-length"];
        const stats = await fse.stat(dlFile);

        if (expectedSize && stats.size.toString() !== expectedSize.toString()) {
          await fse.remove(dlFile);
          throw new Error(`Incomplete: ${stats.size}/${expectedSize}`);
        }

        await fse.move(dlFile, finalFile, { overwrite: true });

        if (continuousErr > 0) continuousErr = 0;
        console.log(`${logPrefix}${illust.title.yellow}`);

        return;
      } catch (err: any) {
        if (err?.response?.status === 404) {
          console.log(`${"404".bgRed}\t${logPrefix}${illust.title.yellow}`);
          return;
        }

        continuousErr++;

        const isLastAttempt = attempt === max_retries;
        const colorLabel = isLastAttempt
          ? "[ERROR]".bgRed
          : `[Retry ${attempt}]`.bgYellow;
        console.log(
          `${colorLabel}${logPrefix}${err.message || "Unknown Error"}`,
        );

        if (continuousErr > totalThread * 2) {
          if (!pause) {
            pause = true;
            console.log(
              `\n${"Network unstable. Pausing for 5 minutes...".red}\n`,
            );
            setTimeout(() => {
              pause = false;
              continuousErr = 0;
            }, hangup);
          }
        }

        if (isLastAttempt) return;
        await sleep(2000 * attempt);
      }
    }
  };

  let idx = 0;
  const worker = async (threadID: number) => {
    while (idx < illusts.length) {
      const i = idx++;
      const illust = illusts[i];
      if (illust) {
        await downloadOne(illust, threadID, i);
      }
    }
  };

  const threads = Array.from({ length: totalThread }, (_, i) => worker(i));
  await Promise.all(threads);

  return [];
}

async function getIllustratorNewDir(data: {
  id: number | string;
  name: string;
}): Promise<string> {
  const mainDir = config.path!;
  let dldir: string | null = null;

  await fse.ensureDir(mainDir);
  const files = await fse.readdir(mainDir);

  const prefix = `(${data.id})`;
  for (const file of files) {
    if (file.startsWith(prefix)) {
      dldir = file;
      break;
    }
  }

  let iName = data.name;
  const nameExtIndex = iName.search(/@|＠/);
  if (nameExtIndex >= 1) iName = iName.substring(0, nameExtIndex);
  iName = iName.replace(/[/\\:*?"<>|.&$]/g, "").replace(/[ ]+$/, "");
  const dldirNew = `(${data.id})${iName}`;

  if (!dldir) {
    dldir = dldirNew;
  } else if (
    config.autoRename &&
    dldir.toLowerCase() !== dldirNew.toLowerCase()
  ) {
    try {
      await fse.rename(path.join(mainDir, dldir), path.join(mainDir, dldirNew));
      console.log(
        "\nDirectory renamed: %s => %s",
        dldir.yellow,
        dldirNew.green,
      );
      dldir = dldirNew;
    } catch (err) {
      console.log(
        "\nDirectory rename failed: %s => %s",
        dldir.yellow,
        dldirNew.red,
      );
    }
  }

  return dldir;
}

export async function downloadByIllusts(illustJSON: any[]): Promise<void> {
  console.log();
  // Network requests are sent in parallel only when requesting a ugoira.
  const results = await Promise.all(
    illustJSON.map((json) => Illust.getIllusts(json)),
  );
  let illusts: Illust[] = results.flat();
  await downloadIllusts(illusts, path.join(config.path!, "PID"), config.thread);
}
