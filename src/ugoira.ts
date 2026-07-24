import fse from "fs-extra";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { inflateRaw } from "node:zlib";
import { promisify } from "node:util";
import logger from "./logger.js";

const execFileAsync = promisify(execFile);
const inflateRawAsync = promisify(inflateRaw);
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

async function runTool(command: string, args: string[]): Promise<void> {
  await execFileAsync(command, args, {
    maxBuffer: MAX_TOOL_OUTPUT,
    windowsHide: true,
  });
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

interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

interface FrameFile {
  filePath: string;
  delay: number;
}

const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;

function readUInt16(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 2 > buffer.length) {
    throw new Error("Invalid ugoira ZIP metadata");
  }
  return buffer.readUInt16LE(offset);
}

function readUInt32(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 4 > buffer.length) {
    throw new Error("Invalid ugoira ZIP metadata");
  }
  return buffer.readUInt32LE(offset);
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimumOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset--) {
    if (readUInt32(buffer, offset) === ZIP_END_OF_CENTRAL_DIRECTORY) {
      return offset;
    }
  }

  throw new Error("Invalid ugoira ZIP: central directory is missing");
}

function readZipEntries(buffer: Buffer): ZipEntry[] {
  const endOffset = findEndOfCentralDirectory(buffer);
  const entryCount = readUInt16(buffer, endOffset + 10);
  const centralDirectorySize = readUInt32(buffer, endOffset + 12);
  const centralDirectoryOffset = readUInt32(buffer, endOffset + 16);

  if (entryCount === 0xffff || centralDirectoryOffset === 0xffffffff) {
    throw new Error("Ugoira ZIP64 archives are not supported");
  }

  if (
    centralDirectoryOffset + centralDirectorySize > buffer.length ||
    centralDirectoryOffset < 0
  ) {
    throw new Error("Invalid ugoira ZIP: central directory is out of bounds");
  }

  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index++) {
    if (readUInt32(buffer, offset) !== ZIP_CENTRAL_DIRECTORY_ENTRY) {
      throw new Error("Invalid ugoira ZIP: malformed central directory");
    }

    const nameLength = readUInt16(buffer, offset + 28);
    const extraLength = readUInt16(buffer, offset + 30);
    const commentLength = readUInt16(buffer, offset + 32);
    const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > buffer.length) {
      throw new Error("Invalid ugoira ZIP: malformed central directory entry");
    }

    entries.push({
      name: buffer
        .subarray(offset + 46, offset + 46 + nameLength)
        .toString("utf8"),
      compressionMethod: readUInt16(buffer, offset + 10),
      compressedSize: readUInt32(buffer, offset + 20),
      uncompressedSize: readUInt32(buffer, offset + 24),
      localHeaderOffset: readUInt32(buffer, offset + 42),
    });

    offset = entryEnd;
  }

  return entries;
}

function findFrameEntry(
  entries: ZipEntry[],
  frameName: string,
): ZipEntry | undefined {
  const normalizedName = frameName.replaceAll("\\", "/");
  const exact = entries.find((entry) => entry.name === normalizedName);
  if (exact) return exact;

  const basename = path.posix.basename(normalizedName);
  const matches = entries.filter(
    (entry) => path.posix.basename(entry.name) === basename,
  );
  if (matches.length > 1) {
    throw new Error(`Ugoira ZIP contains duplicate frame ${frameName}`);
  }
  return matches[0];
}

async function readZipEntry(buffer: Buffer, entry: ZipEntry): Promise<Buffer> {
  const localOffset = entry.localHeaderOffset;
  if (readUInt32(buffer, localOffset) !== ZIP_LOCAL_FILE_HEADER) {
    throw new Error(`Invalid ugoira ZIP local header for ${entry.name}`);
  }

  const nameLength = readUInt16(buffer, localOffset + 26);
  const extraLength = readUInt16(buffer, localOffset + 28);
  const dataStart = localOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) {
    throw new Error(`Ugoira ZIP frame is out of bounds: ${entry.name}`);
  }

  const compressed = buffer.subarray(dataStart, dataEnd);
  let data: Buffer;
  if (entry.compressionMethod === 0) {
    data = compressed;
  } else if (entry.compressionMethod === 8) {
    data = await inflateRawAsync(compressed);
  } else {
    throw new Error(
      `Unsupported ugoira ZIP compression method ${entry.compressionMethod}`,
    );
  }

  if (
    entry.uncompressedSize !== 0xffffffff &&
    data.length !== entry.uncompressedSize
  ) {
    throw new Error(`Ugoira ZIP frame is incomplete: ${entry.name}`);
  }
  return data;
}

async function prepareFrames(
  zipPath: string,
  workDir: string,
  metadata?: UgoiraFrame[],
): Promise<FrameFile[]> {
  const archive = await fse.readFile(zipPath);
  const entries = readZipEntries(archive).filter((entry) =>
    /\.(?:jpe?g|png|webp)$/i.test(entry.name),
  );
  const frameMetadata = metadata?.length
    ? metadata.map((frame) => ({ name: frame.file, delay: frame.delay }))
    : [...entries]
        .sort((left, right) =>
          left.name.localeCompare(right.name, undefined, { numeric: true }),
        )
        .map((entry) => ({ name: entry.name, delay: 100 }));

  const frames: FrameFile[] = [];
  for (const [index, frame] of frameMetadata.entries()) {
    const entry = findFrameEntry(entries, frame.name);
    if (!entry) {
      throw new Error(`Ugoira ZIP is missing frame ${frame.name}`);
    }

    const extension = path.extname(path.posix.basename(entry.name)) || ".img";
    const framePath = path.join(
      workDir,
      `${String(index).padStart(6, "0")}${extension}`,
    );
    await fse.writeFile(framePath, await readZipEntry(archive, entry));
    frames.push({ filePath: framePath, delay: frame.delay });
  }

  if (frames.length === 0) {
    throw new Error("Ugoira ZIP does not contain any image frames");
  }
  return frames;
}

export async function convertUgoiraToGif(
  zipPath: string,
  gifPath: string,
  metadata?: UgoiraFrame[],
): Promise<void> {
  const workDir = await fse.mkdtemp(path.join(os.tmpdir(), "iroha-ugoira-"));
  const temporaryGif = `${gifPath}.part`;
  const operationId = logger.createOperationId("ugoira");
  const startedAt = Date.now();

  logger.debug("ugoira", "converter.started", "ImageMagick conversion started", {
    context: { zipPath, gifPath, metadataFrames: metadata?.length ?? null },
    async: { operationId, phase: "running" },
  });

  try {
    const frames = await prepareFrames(zipPath, workDir, metadata);
    const converter = await findImageConverter();
    const args: string[] = ["-dispose", "previous"];

    for (const frame of frames) {
      args.push(
        "-delay",
        String(Math.max(1, Math.round(frame.delay / 10))),
        frame.filePath,
      );
    }

    args.push("-loop", "0", "-layers", "Optimize", `GIF:${temporaryGif}`);
    await runTool(converter, args);

    if (!(await fse.pathExists(temporaryGif))) {
      throw new Error("ImageMagick did not create the GIF output");
    }

    await fse.ensureDir(path.dirname(gifPath));
    await fse.move(temporaryGif, gifPath, { overwrite: true });
    logger.debug("ugoira", "converter.succeeded", "ImageMagick conversion completed", {
      context: { zipPath, gifPath, durationMs: Date.now() - startedAt },
      async: {
        operationId,
        phase: "success",
        durationMs: Date.now() - startedAt,
      },
    });
  } catch (error) {
    logger.debug("ugoira", "converter.failed", "ImageMagick conversion failed", {
      context: { zipPath, gifPath, durationMs: Date.now() - startedAt },
      async: {
        operationId,
        phase: "failed",
        durationMs: Date.now() - startedAt,
      },
      error,
    });
    throw error;
  } finally {
    await fse.remove(temporaryGif);
    await fse.remove(workDir);
  }
}
