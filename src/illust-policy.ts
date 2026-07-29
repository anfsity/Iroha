import type { ImageSource } from "./pixiv-image-url.js";
import type { UgoiraFormat } from "./ugoira.js";

export interface IllustPolicy {
  imageSource: ImageSource;
  filterNsfw: boolean;
  ugoiraMeta: boolean;
  ugoiraFormat: UgoiraFormat;
}

export const DEFAULT_ILLUST_POLICY: IllustPolicy = {
  imageSource: "direct",
  filterNsfw: false,
  ugoiraMeta: true,
  ugoiraFormat: "zip",
};
