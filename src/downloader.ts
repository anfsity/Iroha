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

    try {
      await illustrator.info();
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

    const info = await getDownloadListByIllustrator(illustrator);

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
): Promise<DownloadListResult> {
  let illusts: Illust[] = [];

  const dir = await illustrator.info().then(getIllustratorNewDir);
  const dldir = path.join(config.path!, dir); //< download directory
  const ugoiraDir = new utils.UgoiraDir(dldir);

  const illustExists = (file: string) =>
    file.endsWith(".zip")
      ? ugoiraDir.existsSync(file)
      : fse.existsSync(path.join(dldir, file));

  const exampleIllusts = illustrator.exampleIllusts;
  if (exampleIllusts) {
    let existNum = 0;
    for (const ei of exampleIllusts) {
      if (illustExists(ei.file)) existNum++;
      else illusts.push(ei);
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
      if (!illustExists(temp.file)) {
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
  const illustExists = (file: string) =>
    file.endsWith(".zip")
      ? ugoiraDir.existsSync(file)
      : fse.existsSync(path.join(dldir, file));

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
      if (!illustExists(temp.file)) {
        illusts.push(temp);
        cnt++;
      }
    }
  } while (me.hasNext("bookmark") && cnt > 0);

  utils.clearProgress(processDisplay);
  await downloadIllusts(illusts.reverse(), dldir, config.thread);
}

// multithread...
export async function downloadIllusts(
  illusts: Illust[],
  dldir: string,
  totalThread: number,
): Promise<any[]> {
  const tempDir = config.tmp!;
  let totalI = 0; //< total illustrations

  if (fse.existsSync(tempDir)) fse.removeSync(tempDir);
  fse.ensureDirSync(dldir);

  let errorThread = 0;
  let pause = false;
  const hangup = 5 * 60 * 1000;
  let errorTimeout: NodeJS.Timeout | null = null;

  const singleThread = async (threadID: number) => {
    while (true) {
      const i = totalI++;
      if (i >= illusts.length) return threadID;

      const illust = illusts[i];
      if (!illust) continue;
      const options: any = {
        headers: { referer: pixivRefer },
        timeout: 1000 * config.timeout,
      };

      if (httpsAgent) options.httpsAgent = httpsAgent;

      console.log(
        `  [${threadID}]\t${(i + 1).toString().green}/${illusts.length}\t ${"pid".gray} ${illust.id.toString().cyan}\t${illust.title.yellow}`,
      );

      // FIXME: emmm, this code is a complete mess, we need to tidy it up ...
      const tryDownload = async (times: number): Promise<void> => {
        if (times > 10) {
          if (errorThread > 1) {
            if (errorTimeout) clearTimeout(errorTimeout);
            errorTimeout = setTimeout(() => {
              console.log("\n" + "Network error! Pause 5 minutes.".red + "\n");
            }, 1000);
            pause = true;
          } else return;
        }

        if (pause) {
          times = 1;
          await sleep(hangup);
          pause = false;
        }

        try {
          const res = await utils.download(
            tempDir,
            illust.file,
            illust.url,
            options,
          );

          const fileSize = res.headers["content-length"];
          const dlFile = path.join(tempDir, illust.file);

          // FIXME: maybe we should fix this bug, let me figure it out. Theoretically, there shouldnt be any sleep here
          await sleep(1000);

          for (let j = 0; j < 15 && !fse.existsSync(dlFile); j++)
            await sleep(200);

          const dlFileSize = fse.statSync(dlFile).size;
          if (!fileSize || dlFileSize.toString() === fileSize.toString()) {
            fse.moveSync(dlFile, path.join(dldir, illust.file), {
              overwrite: true,
            });
          } else {
            fse.unlinkSync(dlFile);
            throw new Error(`Incomplete download ${dlFileSize}/${fileSize}`);
          }
          if (times !== 1) errorThread--;
        } catch (e: any) {
          if (e?.response?.status === 404) {
            console.log(
              `  ${"404".bgRed}\t${(i + 1).toString().green}/${illusts.length}\t ${"pid".gray} ${illust.id.toString().cyan}\t${illust.title.yellow}`,
            );
            return;
          }

          if (times === 1) errorThread++;
          if (appState.debug) console.error(e);

          console.log(
            `  ${times >= 10 ? `[${threadID}]`.bgRed : `[${threadID}]`.bgYellow}\t` +
              `${(i + 1).toString().green}/${illusts.length}\t ${"pid".gray} ` +
              `${illust.id.toString().cyan}\t${illust.title.yellow}`,
          );
          return tryDownload(times + 1);
        }
      };

      await tryDownload(1);
    }
  };

  const threads = [];
  for (let t = 0; t < totalThread; t++) {
    threads.push(
      singleThread(t).catch((e) => {
        if (appState.debug) console.error(e);
      }),
    );
  }

  return Promise.all(threads);
}

async function getIllustratorNewDir(data: {
  id: number | string;
  name: string;
}): Promise<string> {
  const mainDir = config.path!;
  let dldir: string | null = null;

  await fse.ensureDir(mainDir);
  const files = await fse.readdir(mainDir);

  for (const file of files) {
    if (file.indexOf(`(${data.id})`) === 0) {
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
