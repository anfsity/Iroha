/**
 * Adapted from Tsuk1ko/pxder (https://github.com/Tsuk1ko/pxder)
 * Original file: src/illustrator.js
 */

import pLimit from "p-limit";
import appState from "./appState.js";
import { isNsfwIllust } from "./illust-filter.js";
import Illust from "./illustration.js";
import PixivApi from "./pixiv-api-client.js";

let pixiv: PixivApi;
const illustMetadataLimit = pLimit(4);

export class Illustrator {
  constructor(
    public id: number | string,
    public name: string = "",
    public exampleIllusts: Illust[] = [],
    public next: Record<string, string | null> = {
      illust: null,
      bookmark: null,
    },
  ) {}

  public lastPageSkippedNsfw: boolean = false;

  async setExampleIllusts(pillustsJSON: PixivIllustJSON[]): Promise<void> {
    this.exampleIllusts = [];
    // Network requests are sent in parallel only when requesting a ugoira.
    const results = await Promise.all(
      pillustsJSON.map((json) =>
        illustMetadataLimit(() => Illust.getIllusts(json)),
      ),
    );
    this.exampleIllusts = results.flat();
  }

  static setPixiv(p: PixivApi): void {
    pixiv = p;
  }

  async info(): Promise<UserData> {
    let userData: UserData;
    if (this.name.length > 0) {
      userData = {
        id: this.id,
        name: this.name,
      };
    } else {
      const res = await pixiv.userDetail(this.id);
      userData = res.user;
      this.name = userData.name;
    }

    return userData;
  }

  async getSomeIllusts(
    type: string,
    option?: Record<string, any>,
  ): Promise<Illust[]> {
    let json: PixivIllustResponse;

    const nxtUrl = this.next[type];

    if (nxtUrl) {
      json = await pixiv.requestUrl(nxtUrl);
    } else {
      if (type === "illust") {
        json = await pixiv.userIllusts(this.id);
      } else if (type === "bookmark") {
        json = await pixiv.userBookmarksIllust(this.id, option);
      } else {
        throw new Error(`Unsupported type: ${type}`);
      }
    }

    const pageIllusts = json.illusts || [];
    this.lastPageSkippedNsfw =
      appState.filterNsfw && pageIllusts.some(isNsfwIllust);

    const result =
      pageIllusts.length > 0
        ? (
            await Promise.all(
              pageIllusts.map((illustJSON: PixivIllustJSON) =>
                illustMetadataLimit(() => Illust.getIllusts(illustJSON)),
              ),
            )
          ).flat()
        : [];

    this.next[type] = json.next_url;

    return result;
  }

  async illusts(): Promise<Illust[]> {
    return this.getSomeIllusts("illust");
  }

  async bookmarks(isPrivate: boolean = false): Promise<Illust[]> {
    return this.getSomeIllusts("bookmark", {
      restrict: isPrivate ? "private" : "public",
    });
  }

  hasNext(type: string): boolean {
    return this.next[type] !== null;
  }
}

export default Illustrator;
