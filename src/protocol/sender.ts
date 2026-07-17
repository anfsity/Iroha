import http from "node:http";
import { data } from "./config.js";

try {
  const arg = process.argv[process.argv.length - 1];
  if (arg) {
    const url = new URL(arg);
    const code = url.searchParams.get("code");
    const port = data.port;
    if (code && port) {
      http.get(`http://127.0.0.1:${port}/?code=${encodeURIComponent(code)}`);
    }
  }
} catch {
  // Silently ignore errors — this is a fire-and-forget helper.
}
