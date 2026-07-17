import type { ProxyAgent } from "proxy-agent";

export interface AppState {
  debug: boolean;
  ugoiraMeta: boolean;
  proxyAgent: ProxyAgent | null;
}

const appState: AppState = {
  debug: false,
  ugoiraMeta: true,
  proxyAgent: null,
};

export default appState;
