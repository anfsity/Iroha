import { ProxyAgent } from "proxy-agent";

const envNames: string[] = ["all_proxy", "https_proxy", "http_proxy"].flatMap(
  (name) => [name, name.toUpperCase()],
);

export function checkProxy(proxy: unknown): proxy is string {
  if (typeof proxy !== "string") {
    return false;
  }

  const proxyRegex =
    /(^$)|(^disable$)|(^(https?|socks(4a?|5h?)?):\/\/.)|(^pac\+(file|ftp|https?):\/\/.)/;
  return proxyRegex.test(proxy);
}

export function getProxyAgent(proxy?: string | null): ProxyAgent | null {
  if (proxy && checkProxy(proxy) && proxy !== "disable") {
    return new ProxyAgent({ getProxyForUrl: () => proxy });
  } else if (proxy === "" || proxy === undefined || proxy === null) {
    return new ProxyAgent();
  }
  return null;
}

export function getSysProxy(): string | null {
  const proxyEnv = envNames.find((name) => process.env[name]);
  if (proxyEnv) {
    const value = process.env[proxyEnv];
    return value ? value.trim() : null;
  }
  return null;
}

export function delSysProxy(): void {
  envNames.forEach((name) => {
    delete process.env[name];
  });
}
