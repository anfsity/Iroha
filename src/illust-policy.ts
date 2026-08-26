/**
 * Copyright (C) 2026 Anfsity
 */

import type { ImageSource } from "./pixiv-image-url.js";
import type { UgoiraFormat } from "./ugoira.js";
import {
  DEFAULT_ILLUST_FILTER,
  type IllustFilterConfig,
} from "./illust-filter.js";

export interface IllustPolicy {
  imageSource: ImageSource;
  filterNsfw: boolean;
  ugoiraMeta: boolean;
  ugoiraFormat: UgoiraFormat;
  filter: IllustFilterConfig;
}

export const DEFAULT_ILLUST_POLICY: IllustPolicy = {
  imageSource: "direct",
  filterNsfw: false,
  ugoiraMeta: true,
  ugoiraFormat: "zip",
  filter: { ...DEFAULT_ILLUST_FILTER },
};
