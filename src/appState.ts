import type { ProxyAgent } from "proxy-agent";
import type { UgoiraFormat } from "./ugoira.js";

export interface AppState {
  debug: boolean;
  ugoiraMeta: boolean;
  ugoiraFormat: UgoiraFormat;
  proxyAgent: ProxyAgent | null;
}

const appState: AppState = {
  debug: false,
  ugoiraMeta: true,
  ugoiraFormat: "zip",
  proxyAgent: null,
};

export default appState;
