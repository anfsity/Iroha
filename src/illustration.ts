/**
 * Adapted from Tsuk1ko/pxder (https://github.com/Tsuk1ko/pxder)
 * Original file: src/illust.js
 */

import type PixivApi from "./pixiv-api-client.js";
import { isNsfwIllust } from "./illust-filter.js";
import { DEFAULT_ILLUST_POLICY, type IllustPolicy } from "./illust-policy.js";
import logger from "./logger.js";
import { replacePixivImageUrl } from "./pixiv-image-url.js";

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

  static async getIllusts(
    illustJSON: PixivIllustJSON,
    policy: IllustPolicy = DEFAULT_ILLUST_POLICY,
  ): Promise<Illust[]> {
    const illusts: Illust[] = [];
    const id = illustJSON.id;

    // Skip NSFW illustrations when filtering is enabled.
    if (policy.filterNsfw && isNsfwIllust(illustJSON)) {
      logger.info(
        "filter",
        "illust.nsfw_skipped",
        "Skipped an NSFW illustration",
        {
          context: { pid: id, xRestrict: illustJSON.x_restrict },
        },
      );
      return illusts;
    }

    // remove ASCII code like '\n', '\r', '\t'
    const title = illustJSON.title.replace(/[\x00-\x1F\x7F]/g, "");
    // remove unrelated char from title, for example: /summer swimsuit/ &* @photo$ -> summer swimsuit photo
    // but we havent perform unicode yet, this is a tricky prolem, let it go ~
    const fileName = title.replace(/[/\\:*?"<>|.&$]/g, "");

    if (illustJSON.type === "ugoira") {
      const originalUrl = illustJSON.meta_single_page.original_image_url || "";
      const zipUrl = replacePixivImageUrl(
        originalUrl
          .replace("img-original", "img-zip-ugoira")
          .replace(/_ugoira0\.(.*)/, "_ugoira1920x1080.zip"),
        policy.imageSource,
      );

      if (policy.ugoiraMeta) {
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
          logger.warn(
            "ugoira",
            "metadata.failed",
            "Failed to get ugoira metadata; continuing without frame metadata",
            {
              context: {
                pid: id,
                command: "--no-ugoira-meta",
              },
              error,
            },
          );

          illusts.push(new Illust(id, title, zipUrl, `(${id})${fileName}.zip`));
        }
      } else {
        illusts.push(new Illust(id, title, zipUrl, `(${id})${fileName}.zip`));
      }
    } else if (illustJSON.meta_pages.length > 0) {
      for (let i = 0; i < illustJSON.meta_pages.length; i++) {
        const url = replacePixivImageUrl(
          illustJSON.meta_pages[i]!.image_urls.original,
          policy.imageSource,
        );
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
      const url = replacePixivImageUrl(
        illustJSON.meta_single_page.original_image_url,
        policy.imageSource,
      );
      const ext = url.substring(url.lastIndexOf("."));
      illusts.push(new Illust(id, title, url, `(${id})${fileName}${ext}`));
    }

    return illusts;
  }
}

export default Illust;
