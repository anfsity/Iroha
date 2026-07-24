import os from "node:os";
import path from "node:path";
import fse from "fs-extra";
import { afterEach, describe, expect, test, vi } from "vitest";
import appState from "../src/appState.js";

vi.mock("../src/utils.js", async () => {
  const actual = await vi.importActual<typeof import("../src/utils.js")>(
    "../src/utils.js",
  );

  return {
    ...actual,
    download: vi.fn(async (dirpath: string, filename: string) => {
      await fse.outputFile(path.join(dirpath, filename), "image");
      return {
        status: 200,
        headers: { "content-length": "5" },
      } as any;
    }),
    sleep: vi.fn(async () => undefined),
  };
});

const { download: mockedDownload } = await import("../src/utils.js");
const { downloadIllusts, setConfig } = await import("../src/downloader.js");
const Illust = (await import("../src/illustration.js")).default;

describe("download format handling", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    appState.ugoiraFormat = "zip";
    vi.clearAllMocks();
    if (tempDir) {
      await fse.remove(tempDir);
      tempDir = undefined;
    }
  });

  test("does not send regular JPG files through ugoira conversion", async () => {
    appState.ugoiraFormat = "gif";
    tempDir = await fse.mkdtemp(path.join(os.tmpdir(), "iroha-downloader-"));
    const outputDir = path.join(tempDir, "output");
    const filename = "(123)sample.jpg";

    setConfig({
      path: outputDir,
      thread: 1,
      timeout: 1,
      tmp: path.join(tempDir, "tmp"),
    });

    await downloadIllusts(
      [new Illust(123, "sample", "https://example.test/sample.jpg", filename)],
      outputDir,
      1,
    );

    expect(mockedDownload).toHaveBeenCalledTimes(1);
    await expect(fse.readFile(path.join(outputDir, filename), "utf8")).resolves.toBe(
      "image",
    );
    await expect(
      fse.pathExists(path.join(outputDir, "(123)sample.gif")),
    ).resolves.toBe(false);
  });
});
