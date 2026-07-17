/*
https://github.com/alphasp/pixiv-api-client

MIT License

Copyright (c) 2016 alphasp <gmerudotcom@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

// I adopted it from the original source

import "colors";
import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
} from "axios";
import qs from "qs";
import md5 from "blueimp-md5";
import moment from "moment";
import * as readline from "readline";
import logError from "./logError.js";
import { sleep } from "./utils.js";


const BASE_URL: string = "https://app-api.pixiv.net";
const CLIENT_ID: string = "MOBrBDS8blbauoSck0ZfDbtuzpyT";
const CLIENT_SECRET: string = "lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj";
const HASH_SECRET: string =
  "28c1fdd170a5204386cb1313c7077b34f83e4aaf4aa829ce78c231e05b0bae2c";

let http: AxiosInstance | null = null;

function getHttp(): AxiosInstance {
  if (!http) {
    http = axios.create();
  }
  return http;
}

async function callApi(
  url: string,
  options: AxiosRequestConfig,
  retry: number = 2,
  axiosInstance?: AxiosInstance,
): Promise<any> {
  const finalUrl: string = /^https?:\/\//i.test(url) ? url : BASE_URL + url;
  const instance = axiosInstance || getHttp();

  try {
    const res = await instance(finalUrl, options);
    return res.data;
  } catch (rawErr: any) {
    const err = rawErr as AxiosError<any>;

    if (err.code == "ECONNRESET") {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.error("Connection reset detected.".gray);
      await sleep(3000);
      return callApi(url, options, retry, instance);
    }

    if (err.response && err.response.data) {
      const msg: string = JSON.stringify(err.response.data);

      if (/rate limit/i.test(msg)) {
        console.error("Rate limit detected. Pause for 10 mintues.".gray);
        await sleep(10 * 60 * 1000);
        return callApi(url, options, retry, instance);
      } else {
        throw msg;
      }
    } else {
      if (retry <= 0) {
        throw err.message;
      }

      console.error("RETRY".yellow, url);
      console.error(err.message);
      await sleep(1000);

      return callApi(url, options, retry - 1, instance);
    }
  }
}

export type PixivOptions = {
  restrict?: "public" | "private";
  [key: string]: any;
};

export class PixivApi {
  private headers: Record<string, string>;
  private axiosInstance: AxiosInstance;
  private auth: any = null;

  public username?: undefined;
  public password?: undefined;
  public rememberPassword?: boolean;

  constructor() {
    this.headers = {
      "App-OS": "android",
      "Accept-Language": "en-us",
      "App-OS-Version": "9.0",
      "App-Version": "5.0.234",
      "User-Agent": "PixivAndroidApp/5.0.234 (Android 9.0; Pixel 3)",
    };
    this.axiosInstance = getHttp();
  }

  public static setAgent(agent: any): void {
    const instance = getHttp();
    instance.defaults.httpsAgent = agent;
    instance.defaults.httpAgent = agent;
  }

  private getDefaultHeaders(): Record<string, string> {
    const datetime = moment().format();
    return Object.assign({}, this.headers, {
      "X-Client-Time": datetime,
      "X-Client-Hash": md5(`${datetime}${HASH_SECRET}`),
    });
  }

  public async tokenRequest(code: string, code_verifier: string): Promise<any> {
    const data = qs.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      code_verifier,
      redirect_uri: `${BASE_URL}/web/v1/users/auth/pixiv/callback`,
      grant_type: "authorization_code",
      include_policy: true,
    });

    const options: AxiosRequestConfig = {
      method: "POST",
      headers: Object.assign(this.getDefaultHeaders(), {
        "Content-Type": "application/x-www-form-urlencoded",
      }),
      data,
    };

    try {
      const data = await callApi(
        "https://oauth.secure.pixiv.net/auth/token",
        options,
        2,
        this.axiosInstance,
      );
      this.auth = data.response;
      return data.response;
    } catch (err: any) {
      if (err.response) {
        throw err.response.data;
      } else {
        throw err.message;
      }
    }
  }

  public logout(): Promise<void> {
    this.auth = null;
    this.username = undefined;
    this.password = undefined;
    delete this.headers.Authorization;
    return Promise.resolve();
  }

  public authInfo(): any {
    return this.auth;
  }

  public async refreshAccessToken(refreshToken?: string): Promise<any> {
    if ((!this.auth || !this.auth.refresh_token) && !refreshToken) {
      throw new Error("refresh_token required");
    }
    const data = qs.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      get_secure_url: true,
      include_policy: true,
      grant_type: "refresh_token",
      refresh_token: refreshToken || this.auth.refresh_token,
    });
    const options: AxiosRequestConfig = {
      method: "POST",
      headers: Object.assign(this.getDefaultHeaders(), {
        "Content-Type": "application/x-www-form-urlencoded",
      }),
      data,
    };
    const resData = await callApi(
      "https://oauth.secure.secure.pixiv.net/auth/token",
      options,
      2,
      this.axiosInstance,
    );
    this.auth = resData.response;
    return resData.response;
  }

  public setLanguage(lang: string): void {
    this.headers["Accept-Language"] = lang;
  }

  public async requestUrl(
    url: string,
    options: AxiosRequestConfig = {},
  ): Promise<any> {
    if (!url) {
      throw new Error("Url cannot be empty");
    }
    options.headers = Object.assign(
      this.getDefaultHeaders(),
      options.headers || {},
    );
    if (this.auth && this.auth.access_token) {
      options.headers.Authorization = `Bearer ${this.auth.access_token}`;
    }

    try {
      return await callApi(url, options, 2, this.axiosInstance);
    } catch (err) {
      if (this.rememberPassword && this.username && this.password) {
        await (this as any).login(this.username, this.password);
        options.headers.Authorization = `Bearer ${this.auth.access_token}`;
        return await callApi(url, options, 2, this.axiosInstance);
      }
      throw err;
    }
  }

  public userState() {
    return this.requestUrl("/v1/user/me/state");
  }

  public searchIllust(word: string, options?: PixivOptions) {
    if (!word) return Promise.reject(new Error("word required"));
    const queryString = qs.stringify(
      Object.assign(
        { word, search_target: "partial_match_for_tags", sort: "date_desc" },
        options,
      ),
    );
    return this.requestUrl(`/v1/search/illust?${queryString}`);
  }

  public searchIllustPopularPreview(
    word: string,
    options?: PixivOptions,
  ) {
    if (!word) return Promise.reject(new Error("word required"));
    const queryString = qs.stringify(
      Object.assign({ word, search_target: "partial_match_for_tags" }, options),
    );
    return this.requestUrl(`/v1/search/popular-preview/illust?${queryString}`);
  }

  public searchNovel(word: string, options?: PixivOptions) {
    if (!word) return Promise.reject(new Error("word required"));
    const queryString = qs.stringify(
      Object.assign(
        { word, search_target: "partial_match_for_tags", sort: "date_desc" },
        options,
      ),
    );
    return this.requestUrl(`/v1/search/novel?${queryString}`);
  }

  public searchNovelPopularPreview(
    word: string,
    options?: PixivOptions,
  ) {
    if (!word) return Promise.reject(new Error("word required"));
    const queryString = qs.stringify(
      Object.assign({ word, search_target: "partial_match_for_tags" }, options),
    );
    return this.requestUrl(`/v1/search/popular-preview/novel?${queryString}`);
  }

  public searchIllustBookmarkRanges(
    word: string,
    options?: PixivOptions,
  ) {
    if (!word) return Promise.reject(new Error("word required"));
    const queryString = qs.stringify(
      Object.assign({ word, search_target: "partial_match_for_tags" }, options),
    );
    return this.requestUrl(`/v1/search/bookmark-ranges/illust?${queryString}`);
  }

  public searchNovelBookmarkRanges(
    word: string,
    options?: PixivOptions,
  ) {
    if (!word) return Promise.reject(new Error("word required"));
    const queryString = qs.stringify(
      Object.assign({ word, search_target: "partial_match_for_tags" }, options),
    );
    return this.requestUrl(`/v1/search/bookmark-ranges/novel?${queryString}`);
  }

  public searchUser(word: string) {
    if (!word) return Promise.reject(new Error("word required"));
    return this.requestUrl(`/v1/search/user?${qs.stringify({ word })}`);
  }

  public searchAutoComplete(word: string) {
    if (!word) return Promise.reject(new Error("word required"));
    return this.requestUrl(`/v1/search/autocomplete?${qs.stringify({ word })}`);
  }

  public searchAutoCompleteV2(word: string) {
    if (!word) return Promise.reject(new Error("word required"));
    return this.requestUrl(`/v2/search/autocomplete?${qs.stringify({ word })}`);
  }

  public userDetail(id: number | string, options?: PixivOptions) {
    if (!id) return Promise.reject(new Error("user_id required"));
    const queryString = qs.stringify(Object.assign({ user_id: id }, options));
    return this.requestUrl(`/v1/user/detail?${queryString}`);
  }

  public userIllusts(id: number | string, options?: PixivOptions) {
    if (!id) return Promise.reject(new Error("user_id required"));
    const queryString = qs.stringify(Object.assign({ user_id: id }, options));
    return this.requestUrl(`/v1/user/illusts?${queryString}`);
  }

  public userNovels(id: number | string, options?: PixivOptions) {
    if (!id) return Promise.reject(new Error("user_id required"));
    const queryString = qs.stringify(Object.assign({ user_id: id }, options));
    return this.requestUrl(`/v1/user/novels?${queryString}`);
  }

  public userBookmarksIllust(
    id: number | string,
    options?: PixivOptions,
  ) {
    if (!id) return Promise.reject(new Error("user_id required"));
    const queryString = qs.stringify(
      Object.assign({ user_id: id, restrict: "public" }, options),
    );
    return this.requestUrl(`/v1/user/bookmarks/illust?${queryString}`);
  }

  public userBookmarkIllustTags(options?: PixivOptions) {
    const queryString = qs.stringify(
      Object.assign({ restrict: "public" }, options),
    );
    return this.requestUrl(`/v1/user/bookmark-tags/illust?${queryString}`);
  }

  public illustBookmarkDetail(
    id: number | string,
    options?: PixivOptions,
  ) {
    if (!id) return Promise.reject(new Error("illust_id required"));
    const queryString = qs.stringify(Object.assign({ illust_id: id }, options));
    return this.requestUrl(`/v2/illust/bookmark/detail?${queryString}`);
  }

  public userBookmarksNovel(
    id: number | string,
    options?: PixivOptions,
  ) {
    if (!id) return Promise.reject(new Error("user_id required"));
    const queryString = qs.stringify(
      Object.assign({ user_id: id, restrict: "public" }, options),
    );
    return this.requestUrl(`/v1/user/bookmarks/novel?${queryString}`);
  }

  public userBookmarkNovelTags(options?: PixivOptions) {
    const queryString = qs.stringify(
      Object.assign({ restrict: "public" }, options),
    );
    return this.requestUrl(`/v1/user/bookmark-tags/novel?${queryString}`);
  }

  public illustWalkthrough() {
    return this.requestUrl("/v1/walkthrough/illusts");
  }

  public illustComments(id: number | string, options?: PixivOptions) {
    if (!id) return Promise.reject(new Error("illust_id required"));
    const queryString = qs.stringify(
      Object.assign({ illust_id: id, include_total_comments: true }, options),
    );
    return this.requestUrl(`/v1/illust/comments?${queryString}`);
  }

  public illustCommentsV2(id: number | string, options?: PixivOptions) {
    if (!id) return Promise.reject(new Error("illust_id required"));
    const queryString = qs.stringify(Object.assign({ illust_id: id }, options));
    return this.requestUrl(`/v2/illust/comments?${queryString}`);
  }

  public illustCommentReplies(id: number | string) {
    if (!id) return Promise.reject(new Error("comment_id required"));
    return this.requestUrl(
      `/v1/illust/comment/replies?${qs.stringify({ comment_id: id })}`,
    );
  }

  public illustRelated(id: number | string, options?: PixivOptions) {
    if (!id) return Promise.reject(new Error("illust_id required"));
    const queryString = qs.stringify(Object.assign({ illust_id: id }, options));
    return this.requestUrl(`/v2/illust/related?${queryString}`);
  }

  public illustDetail(id: number | string, options?: PixivOptions) {
    if (!id) return Promise.reject(new Error("illust_id required"));
    const queryString = qs.stringify(Object.assign({ illust_id: id }, options));
    return this.requestUrl(`/v1/illust/detail?${queryString}`);
  }

  public illustNew(options?: PixivOptions) {
    const queryString = qs.stringify(
      Object.assign({ content_type: "illust" }, options),
    );
    return this.requestUrl(`/v1/illust/new?${queryString}`);
  }

  public illustFollow(options?: PixivOptions) {
    const queryString = qs.stringify(
      Object.assign({ restrict: "all" }, options),
    );
    return this.requestUrl(`/v2/illust/follow?${queryString}`);
  }

  public illustRecommended(options?: PixivOptions) {
    const queryString = qs.stringify(
      Object.assign({ include_ranking_illusts: true }, options),
    );
    return this.requestUrl(`/v1/illust/recommended?${queryString}`);
  }

  public illustRanking(options?: PixivOptions) {
    const queryString = qs.stringify(Object.assign({ mode: "day" }, options));
    return this.requestUrl(`/v1/illust/ranking?${queryString}`);
  }

  public illustMyPixiv() {
    return this.requestUrl("/v2/illust/mypixiv");
  }

  public illustAddComment(
    id: number | string,
    comment: string,
    parentCommentId?: number | string,
  ) {
    if (!id) return Promise.reject(new Error("illust_id required"));
    if (!comment) return Promise.reject(new Error("comment required"));
    return this.requestUrl("/v1/illust/comment/add", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: qs.stringify({
        illust_id: id,
        comment,
        parent_comment_id: parentCommentId,
      }),
    });
  }

  public novelAddComment(
    id: number | string,
    comment: string,
    parentCommentId?: number | string,
  ) {
    if (!id) return Promise.reject(new Error("novel_id required"));
    if (!comment) return Promise.reject(new Error("comment required"));
    return this.requestUrl("/v1/novel/comment/add", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: qs.stringify({
        novel_id: id,
        comment,
        parent_comment_id: parentCommentId,
      }),
    });
  }

  public trendingTagsIllust(options?: PixivOptions) {
    return this.requestUrl(
      `/v1/trending-tags/illust?${qs.stringify(options || {})}`,
    );
  }

  public trendingTagsNovel(options?: PixivOptions) {
    return this.requestUrl(
      `/v1/trending-tags/novel?${qs.stringify(options || {})}`,
    );
  }

  public bookmarkIllust(
    id: number | string,
    restrict?: "public" | "private",
    tags?: string[],
  ) {
    if (!id) return Promise.reject(new Error("illust_id required"));
    if (restrict && ["public", "private"].indexOf(restrict) === -1)
      return Promise.reject(new Error("invalid restrict value"));
    if (tags && !Array.isArray(tags))
      return Promise.reject(new Error("invalid tags value"));
    return this.requestUrl("/v2/illust/bookmark/add", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: qs.stringify({
        illust_id: id,
        restrict: restrict || "public",
        tags: tags && tags.length ? tags : undefined,
      }),
    });
  }

  public unbookmarkIllust(id: number | string) {
    if (!id) return Promise.reject(new Error("illust_id required"));
    return this.requestUrl("/v1/illust/bookmark/delete", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: qs.stringify({ illust_id: id }),
    });
  }

  public bookmarkNovel(
    id: number | string,
    restrict?: "public" | "private",
    tags?: string[],
  ) {
    if (!id) return Promise.reject(new Error("novel_id required"));
    if (restrict && ["public", "private"].indexOf(restrict) === -1)
      return Promise.reject(new Error("invalid restrict value"));
    if (tags && !Array.isArray(tags))
      return Promise.reject(new Error("invalid tags value"));
    return this.requestUrl("/v2/novel/bookmark/add", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: qs.stringify({
        novel_id: id,
        restrict: restrict || "public",
        tags: tags && tags.length ? tags : undefined,
      }),
    });
  }

  public unbookmarkNovel(id: number | string) {
    if (!id) return Promise.reject(new Error("novel_id required"));
    return this.requestUrl("/v1/novel/bookmark/delete", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: qs.stringify({ novel_id: id }),
    });
  }

  public followUser(id: number | string, restrict?: "public" | "private") {
    if (!id) return Promise.reject(new Error("user_id required"));
    if (restrict && ["public", "private"].indexOf(restrict) === -1)
      return Promise.reject(new Error("invalid restrict value"));
    return this.requestUrl("/v1/user/follow/add", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: qs.stringify({ user_id: id, restrict: restrict || "public" }),
    });
  }

  public unfollowUser(id: number | string) {
    if (!id) return Promise.reject(new Error("user_id required"));
    return this.requestUrl("/v1/user/follow/delete", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: qs.stringify({ user_id: id, restrict: "public" }),
    });
  }

  public mangaRecommended(options?: PixivOptions) {
    const queryString = qs.stringify(
      Object.assign({ include_ranking_label: true }, options),
    );
    return this.requestUrl(`/v1/manga/recommended?${queryString}`);
  }

  public mangaNew(options?: PixivOptions) {
    const queryString = qs.stringify(
      Object.assign({ content_type: "manga" }, options),
    );
    return this.requestUrl(`/v1/illust/new?${queryString}`);
  }

  public novelRecommended(options?: PixivOptions) {
    const queryString = qs.stringify(
      Object.assign({ include_ranking_novels: true }, options),
    );
    return this.requestUrl(`/v1/novel/recommended?${queryString}`);
  }

  public novelNew(options?: PixivOptions) {
    return this.requestUrl(`/v1/novel/new?${qs.stringify(options || {})}`);
  }

  public novelComments(id: number | string, options?: PixivOptions) {
    if (!id) return Promise.reject(new Error("novel_id required"));
    const queryString = qs.stringify(
      Object.assign({ novel_id: id, include_total_comments: true }, options),
    );
    return this.requestUrl(`/v1/novel/comments?${queryString}`);
  }

  public novelCommentsV2(id: number | string, options?: PixivOptions) {
    if (!id) return Promise.reject(new Error("novel_id required"));
    const queryString = qs.stringify(Object.assign({ novel_id: id }, options));
    return this.requestUrl(`/v2/novel/comments?${queryString}`);
  }

  public novelCommentReplies(id: number | string) {
    if (!id) return Promise.reject(new Error("comment_id required"));
    return this.requestUrl(
      `/v1/novel/comment/replies?${qs.stringify({ comment_id: id })}`,
    );
  }

  public novelSeries(id: number | string) {
    if (!id) return Promise.reject(new Error("series_id required"));
    return this.requestUrl(
      `/v1/novel/series?${qs.stringify({ series_id: id })}`,
    );
  }

  public novelDetail(id: number | string) {
    if (!id) return Promise.reject(new Error("novel_id required"));
    return this.requestUrl(
      `/v2/novel/detail?${qs.stringify({ novel_id: id })}`,
    );
  }

  public novelText(id: number | string) {
    if (!id) return Promise.reject(new Error("novel_id required"));
    return this.requestUrl(`/v1/novel/text?${qs.stringify({ novel_id: id })}`);
  }

  public novelFollow(options?: PixivOptions) {
    const queryString = qs.stringify(
      Object.assign({ restrict: "all" }, options),
    );
    return this.requestUrl(`/v1/novel/follow?${queryString}`);
  }

  public novelMyPixiv() {
    return this.requestUrl("/v1/novel/mypixiv");
  }

  public novelRanking(options?: PixivOptions) {
    const queryString = qs.stringify(Object.assign({ mode: "day" }, options));
    return this.requestUrl(`/v1/novel/ranking?${queryString}`);
  }

  public novelBookmarkDetail(
    id: number | string,
    options?: PixivOptions,
  ) {
    if (!id) return Promise.reject(new Error("novel_id required"));
    const queryString = qs.stringify(Object.assign({ novel_id: id }, options));
    return this.requestUrl(`/v2/novel/bookmark/detail?${queryString}`);
  }

  public userRecommended(options?: PixivOptions) {
    return this.requestUrl(
      `/v1/user/recommended?${qs.stringify(options || {})}`,
    );
  }

  public userFollowing(id: number | string, options?: PixivOptions) {
    if (!id) return Promise.reject(new Error("user_id required"));
    const queryString = qs.stringify(
      Object.assign({ user_id: id, restrict: "public" }, options),
    );
    return this.requestUrl(`/v1/user/following?${queryString}`);
  }

  public userFollowDetail(id: number | string) {
    if (!id) return Promise.reject(new Error("user_id required"));
    return this.requestUrl(
      `/v1/user/follow/detail?${qs.stringify({ user_id: id })}`,
    );
  }

  public userFollower(id: number | string, options?: PixivOptions) {
    if (!id) return Promise.reject(new Error("user_id required"));
    const queryString = qs.stringify(Object.assign({ user_id: id }, options));
    return this.requestUrl(`/v1/user/follower?${queryString}`);
  }

  public userMyPixiv(id: number | string) {
    if (!id) return Promise.reject(new Error("user_id required"));
    return this.requestUrl(`/v1/user/mypixiv?${qs.stringify({ user_id: id })}`);
  }

  public ugoiraMetaData(id: number | string) {
    if (!id) return Promise.reject(new Error("illust_id required"));
    return this.requestUrl(
      `/v1/ugoira/metadata?${qs.stringify({ illust_id: id })}`,
    );
  }
}

export default PixivApi;
