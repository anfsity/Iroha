import type { ProxyAgent } from "proxy-agent";
import type { UgoiraFormat } from "./ugoira.js";
import type { ImageSource } from "./pixiv-image-url.js";

export interface AppState {
  debug: boolean;
  ugoiraMeta: boolean;
  ugoiraFormat: UgoiraFormat;
  imageSource: ImageSource;
  proxyAgent: ProxyAgent | null;
}

const appState: AppState = {
  debug: false,
  ugoiraMeta: true,
  ugoiraFormat: "zip",
  imageSource: "direct",
  proxyAgent: null,
};

export default appState;
