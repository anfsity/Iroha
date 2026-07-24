/**
 * Adapted from Tsuk1ko/pxder (https://github.com/Tsuk1ko/pxder)
 * Original file: src/illust.js
 */

import "colors";
import type PixivApi from "./pixiv-api-client.js";
import appState from "./appState.js";

interface IllustObject {
  id: number | string;
  title: string;
  url: string;
  file: string;
  ugoiraFrames?: UgoiraFrame[];
}

let pixiv: PixivApi;

export class Illust {
  constructor(
    public id: number | string,
    public title: string,
    public url: string,
    public file: string,
    public ugoiraFrames?: UgoiraFrame[],
  ) {}

  static setPixiv(p: PixivApi): void {
    pixiv = p;
  }

  public getObject(): IllustObject {
    const object: IllustObject = {
      id: this.id,
      title: this.title,
      url: this.url,
      file: this.file,
    };
    if (this.ugoiraFrames) object.ugoiraFrames = this.ugoiraFrames;
    return object;
  }

  static async getIllusts(illustJSON: PixivIllustJSON): Promise<Illust[]> {
    const illusts: Illust[] = [];

    // remove ASCII code like '\n', '\r', '\t'
    const title = illustJSON.title.replace(/[\x00-\x1F\x7F]/g, "");
    // remove unrelated char from title, for example: /summer swimsuit/ &* @photo$ -> summer swimsuit photo
    // but we havent perform unicode yet, this is a tricky prolem, let it go ~
    const fileName = title.replace(/[/\\:*?"<>|.&$]/g, "");
    const id = illustJSON.id;

    if (illustJSON.type === "ugoira") {
      const originalUrl = illustJSON.meta_single_page.original_image_url || "";
      const zipUrl = originalUrl
        .replace("img-original", "img-zip-ugoira")
        .replace(/_ugoira0\.(.*)/, "_ugoira1920x1080.zip");

      if (appState.ugoiraMeta) {
        try {
          const res = await pixiv.ugoiraMetaData(id);
          const frames = res.ugoira_metadata.frames as UgoiraFrame[];
          const uDelay = frames[0]?.delay ?? 100;
          illusts.push(
            new Illust(
              id,
              title,
              zipUrl,
              `(${id})${fileName}@${uDelay}ms.zip`,
              frames,
            ),
          );
        } catch (error) {
          console.error(
            "\nFailed to get ugoira meta data. If you get a rate limit error, please use ",
            "--no-ugoira-meta".yellow,
            "argument to avoid it.",
            error,
            "\n",
          );

          illusts.push(new Illust(id, title, zipUrl, `(${id})${fileName}.zip`));
        }
      } else {
        illusts.push(new Illust(id, title, zipUrl, `(${id})${fileName}.zip`));
      }
    } else if (illustJSON.meta_pages.length > 0) {
      for (let i = 0; i < illustJSON.meta_pages.length; i++) {
        const url = illustJSON.meta_pages[i]!.image_urls.original;
        const ext = url.substring(url.lastIndexOf("."));
        illusts.push(
          new Illust(
            id,
            `${title}_p${i}`,
            url,
            `(${id})${fileName}_p${i}${ext}`,
          ),
        );
      }
    } else if (illustJSON.meta_single_page.original_image_url) {
      const url = illustJSON.meta_single_page.original_image_url;
      const ext = url.substring(url.lastIndexOf("."));
      illusts.push(new Illust(id, title, url, `(${id})${fileName}${ext}`));
    }

    return illusts;
  }
}

export default Illust;
