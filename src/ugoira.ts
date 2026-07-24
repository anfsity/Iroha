import fse from "fs-extra";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_TOOL_OUTPUT = 2 * 1024 * 1024;

export type UgoiraFormat = "zip" | "gif" | "both";

export function isUgoiraFormat(value: unknown): value is UgoiraFormat {
  return value === "zip" || value === "gif" || value === "both";
}

export function getUgoiraGifFilename(zipFilename: string): string {
  if (!/\.zip$/i.test(zipFilename)) {
    throw new Error(`Expected an ugoira ZIP filename, got ${zipFilename}`);
  }
  return zipFilename.replace(/\.zip$/i, ".gif");
}

function isMissingExecutable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function runTool(command: string, args: string[]): Promise<void> {
  await execFileAsync(command, args, {
    maxBuffer: MAX_TOOL_OUTPUT,
    windowsHide: true,
  });
}

async function extractArchive(zipPath: string, outputDir: string): Promise<void> {
  const candidates: [string, string[]][] =
    process.platform === "win32"
      ? [
          ["tar", ["-xf", zipPath, "-C", outputDir]],
          ["unzip", ["-q", "-o", zipPath, "-d", outputDir]],
        ]
      : [
          ["unzip", ["-q", "-o", zipPath, "-d", outputDir]],
          ["tar", ["-xf", zipPath, "-C", outputDir]],
        ];

  let lastError: unknown;
  for (const [command, args] of candidates) {
    try {
      await runTool(command, args);
      return;
    } catch (error) {
      lastError = error;
      if (!isMissingExecutable(error)) {
        throw new Error(
          `Unable to extract ugoira ZIP with ${command}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  throw new Error(
    "Ugoira GIF conversion requires unzip or tar to extract the downloaded ZIP",
    { cause: lastError },
  );
}

async function findImageConverter(): Promise<string> {
  const candidates =
    process.platform === "win32" ? ["magick"] : ["magick", "convert"];
  for (const command of candidates) {
    try {
      await execFileAsync(command, ["-version"], {
        maxBuffer: MAX_TOOL_OUTPUT,
        windowsHide: true,
      });
      return command;
    } catch {
      // Try the next supported ImageMagick command.
    }
  }

  throw new Error(
    "Ugoira GIF conversion requires ImageMagick (magick or convert) to be installed",
  );
}

async function collectFrameFiles(
  directory: string,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const entries = await fse.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const [name, filePath] of await collectFrameFiles(entryPath)) {
        files.set(name, filePath);
      }
    } else if (/\.(?:jpe?g|png|webp)$/i.test(entry.name)) {
      files.set(entry.name, entryPath);
    }
  }

  return files;
}

async function getFrames(
  directory: string,
  metadata?: UgoiraFrame[],
): Promise<{ filePath: string; delay: number }[]> {
  const files = await collectFrameFiles(directory);
  const frames = metadata?.length
    ? metadata.map((frame) => ({
        filePath: files.get(path.basename(frame.file)),
        delay: frame.delay,
      }))
    : [...files.keys()]
        .sort((left, right) =>
          left.localeCompare(right, undefined, { numeric: true }),
        )
        .map((name) => ({ filePath: files.get(name), delay: 100 }));

  if (frames.some((frame) => !frame.filePath)) {
    throw new Error("Ugoira ZIP is missing one or more metadata frames");
  }

  return frames as { filePath: string; delay: number }[];
}

export async function convertUgoiraToGif(
  zipPath: string,
  gifPath: string,
  metadata?: UgoiraFrame[],
): Promise<void> {
  const workDir = await fse.mkdtemp(path.join(os.tmpdir(), "iroha-ugoira-"));
  const temporaryGif = `${gifPath}.part`;

  try {
    await extractArchive(zipPath, workDir);
    const frames = await getFrames(workDir, metadata);
    const converter = await findImageConverter();
    const args: string[] = ["-dispose", "previous"];

    for (const frame of frames) {
      args.push(
        "-delay",
        String(Math.max(1, Math.round(frame.delay / 10))),
        frame.filePath!,
      );
    }

    args.push("-loop", "0", "-layers", "Optimize", `GIF:${temporaryGif}`);
    await runTool(converter, args);

    if (!(await fse.pathExists(temporaryGif))) {
      throw new Error("ImageMagick did not create the GIF output");
    }

    await fse.ensureDir(path.dirname(gifPath));
    await fse.move(temporaryGif, gifPath, { overwrite: true });
  } finally {
    await fse.remove(temporaryGif);
    await fse.remove(workDir);
  }
}
