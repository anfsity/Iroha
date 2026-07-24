import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import axios from "axios";
import fse from "fs-extra";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { download } from "../src/utils.js";

vi.mock("axios");

const mockedAxios = vi.mocked(axios);

describe("resumable downloads", () => {
  let tempDir: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (tempDir) {
      await fse.remove(tempDir);
      tempDir = undefined;
    }
  });

  test("continues an interrupted file with a Range request", async () => {
    const payload = Buffer.from("iroha-resumable-download-".repeat(256));
    tempDir = await fse.mkdtemp(path.join(os.tmpdir(), "iroha-test-"));
    const url = "https://example.test/file.bin";
    const splitAt = Math.floor(payload.length / 2);

    mockedAxios.get
      .mockResolvedValueOnce({
        status: 200,
        headers: { "content-length": payload.length },
        data: Readable.from([payload.subarray(0, splitAt)]),
      } as any)
      .mockResolvedValueOnce({
        status: 206,
        headers: {
          "content-length": payload.length - splitAt,
          "content-range": `bytes ${splitAt}-${payload.length - 1}/${payload.length}`,
        },
        data: Readable.from([payload.subarray(splitAt)]),
      } as any);

    await download(tempDir, "file.bin", url, { timeout: 1000 });

    const partial = await fse.readFile(path.join(tempDir, "file.bin"));
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(payload.length);

    await download(tempDir, "file.bin", url, { timeout: 1000 });

    const secondRequest = mockedAxios.get.mock.calls[1]?.[1] as any;
    expect(secondRequest.headers.Range).toBe(`bytes=${splitAt}-`);
    await expect(fse.readFile(path.join(tempDir, "file.bin"))).resolves.toEqual(
      payload,
    );
  });
});
