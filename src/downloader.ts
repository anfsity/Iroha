/**
 * Adapted from Tsuk1ko/pxder (https://github.com/Tsuk1ko/pxder)
 * Original file: src/downloader.js
 */

import type { ProxyAgent } from "proxy-agent";
import type { DownloadConfig } from "./config.js";
import {
  downloadByBookmark as orchestrateBookmarks,
  downloadByIllusts as orchestrateIllusts,
  downloadByIllustrators as orchestrateIllustrators,
  downloadIllusts as orchestrateDownloads,
  type DownloadContext,
} from "./download-orchestrator.js";
import type Illust from "./illustration.js";
import type Illustrator from "./illustrator.js";
import { DEFAULT_ILLUST_POLICY } from "./illust-policy.js";

// Compatibility facade for integrations that still import the old module.
// New code should construct a DownloadContext and use download-orchestrator.
let legacyContext: DownloadContext = {
  config: {
    thread: 5,
    timeout: 30,
    ugoiraFormat: "zip",
  },
  policy: DEFAULT_ILLUST_POLICY,
  agent: null,
};

export function setConfig(config: Partial<DownloadConfig>): void {
  const nextConfig = { ...legacyContext.config, ...config };
  legacyContext = {
    ...legacyContext,
    config: nextConfig,
    policy: { ...legacyContext.policy, ugoiraFormat: nextConfig.ugoiraFormat },
  };
}

export function setAgent(agent: ProxyAgent | null): void {
  legacyContext = { ...legacyContext, agent };
}

export function getContext(): DownloadContext {
  return legacyContext;
}

export const downloadByIllustrators = (
  illustrators: Illustrator[],
  callback?: (index: string | number) => void,
) => orchestrateIllustrators(illustrators, legacyContext, callback);

export const downloadByBookmark = (
  me: Illustrator,
  isPrivate: boolean = false,
) => orchestrateBookmarks(me, legacyContext, isPrivate);

export const downloadIllusts = (
  illusts: Illust[],
  dldir: string,
  totalThread: number,
) => orchestrateDownloads(illusts, dldir, totalThread, legacyContext);

export const downloadByIllusts = (illustJSON: PixivIllustJSON[]) =>
  orchestrateIllusts(illustJSON, legacyContext);

export type { DownloadContext } from "./download-orchestrator.js";
