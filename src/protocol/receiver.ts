import Http from "node:http";
import type { AddressInfo } from "node:net";
import * as Config from "./config.js";

export default function receiveLoginCode(): Promise<string> {
  return new Promise<string>((resolve) => {
    const server = Http.createServer((req, res) => {
      res.writeHead(200, { Connection: "close" });
      res.end();

      const url = new URL(`http://localhost${req.url ?? "/"}`);
      const code = url.searchParams.get("code");
      if (!code) return;

      resolve(code);
      server.close(() => {
        Config.modify({ port: 0 });
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      Config.modify({ port });
    });
  });
}
