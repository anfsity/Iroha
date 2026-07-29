/**
 * Copyright (C) 2026 Anfsity
 */

import os from "node:os";
import path from "node:path";
import fse from "fs-extra";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_ILLUST_POLICY } from "../src/illust-policy.js";

vi.mock("../src/download-transport.js", () => ({
  download: vi.fn(async (dirpath: string, filename: string) => {
    await fse.outputFile(path.join(dirpath, filename), "image");
    return {
      status: 200,
      headers: { "content-length": "5" },
    } as any;
  }),
}));

const { download: mockedDownload } =
  await import("../src/download-transport.js");
const { downloadIllusts } = await import("../src/download-orchestrator.js");
const Illust = (await import("../src/illustration.js")).default;

describe("download format handling", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    vi.clearAllMocks();
    if (tempDir) {
      await fse.remove(tempDir);
      tempDir = undefined;
    }
  });

  test("does not send regular JPG files through ugoira conversion", async () => {
    tempDir = await fse.mkdtemp(path.join(os.tmpdir(), "iroha-downloader-"));
    const outputDir = path.join(tempDir, "output");
    const filename = "(123)sample.jpg";
    const context = {
      config: {
        path: outputDir,
        thread: 1,
        timeout: 1,
        tmp: path.join(tempDir, "tmp"),
        ugoiraFormat: "gif" as const,
      },
      policy: { ...DEFAULT_ILLUST_POLICY, ugoiraFormat: "gif" as const },
      agent: null,
    };

    await downloadIllusts(
      [new Illust(123, "sample", "https://example.test/sample.jpg", filename)],
      outputDir,
      1,
      context,
    );

    expect(mockedDownload).toHaveBeenCalledTimes(1);
    await expect(
      fse.readFile(path.join(outputDir, filename), "utf8"),
    ).resolves.toBe("image");
    await expect(
      fse.pathExists(path.join(outputDir, "(123)sample.gif")),
    ).resolves.toBe(false);
  });
});
