import { createHash, randomUUID } from "crypto";
import { createReadStream } from "fs";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "fs/promises";
import { dirname, extname } from "path";
import { eq } from "drizzle-orm";
import { db, books } from "../../app/lib/db";
import { convertCbrToCbz } from "../../app/lib/processing/comic";
import { buildCcdPack } from "../../app/lib/processing/ccd-pack";
import { CCD_VERSION, type ContentBundle } from "../../app/lib/content-ast/types";
import { readCcdBundle, resolveStoragePath } from "../../app/lib/storage";

export const OFFLINE_ARTIFACT_VERSION = 1;

export interface DownloadArtifact {
  bookId: string;
  path: string;
  format: string;
  originalFormat: string;
  byteLength: number;
  sha256: string;
  artifactVersion: number;
  ccdVersion: string | null;
  peakDiskBytes: number;
}

const buildLocks = new Map<string, Promise<DownloadArtifact>>();

async function sha256File(path: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function sha256Buffer(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

interface ArtifactPointer {
  inputKey: string;
  sha256: string;
}

async function readPointer(path: string, inputKey: string): Promise<string | null> {
  try {
    const pointer = JSON.parse(await readFile(path, "utf8")) as ArtifactPointer;
    if (pointer.inputKey !== inputKey || !/^[a-f0-9]{64}$/.test(pointer.sha256)) return null;
    return pointer.sha256;
  } catch {
    return null;
  }
}

async function persistContentAddressed(
  directory: string,
  extension: string,
  data: Buffer,
): Promise<{ path: string; sha256: string }> {
  const sha256 = sha256Buffer(data);
  const path = resolveStoragePath(`${directory}/${sha256}.${extension}`);
  if (!(await stat(path).catch(() => null))) await atomicWrite(path, data);
  return { path, sha256 };
}

async function snapshotFileArtifact(
  bookId: string,
  sourcePath: string,
  format: string,
  originalFormat: string,
): Promise<DownloadArtifact> {
  const cacheDirectory = `data/resource-cache/${bookId}/offline-artifacts-v${OFFLINE_ARTIFACT_VERSION}`;
  const pointerPath = resolveStoragePath(`${cacheDirectory}/${format}-current.json`);
  const sourceStat = await stat(sourcePath);
  const inputKey = `${sourceStat.size}:${sourceStat.mtimeMs}`;
  const existingHash = await readPointer(pointerPath, inputKey);
  if (existingHash) {
    const existingPath = resolveStoragePath(`${cacheDirectory}/${existingHash}.${format}`);
    if (await stat(existingPath).catch(() => null)) {
      return describe(bookId, existingPath, format, originalFormat, null, 2);
    }
  }

  const directory = resolveStoragePath(cacheDirectory);
  await mkdir(directory, { recursive: true });
  const temporary = resolveStoragePath(`${cacheDirectory}/snapshot-${randomUUID()}.tmp`);
  try {
    await copyFile(sourcePath, temporary);
    const sha256 = await sha256File(temporary);
    const immutablePath = resolveStoragePath(`${cacheDirectory}/${sha256}.${format}`);
    if (await stat(immutablePath).catch(() => null)) await rm(temporary, { force: true });
    else await rename(temporary, immutablePath);
    await atomicWrite(pointerPath, Buffer.from(JSON.stringify({ inputKey, sha256 })));
    return describe(bookId, immutablePath, format, originalFormat, null, 2);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function atomicWrite(path: string, data: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, data, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function describe(
  bookId: string,
  path: string,
  format: string,
  originalFormat: string,
  ccdVersion: string | null,
  extractionMultiplier = 1,
): Promise<DownloadArtifact> {
  const fileStat = await stat(path);
  return {
    bookId,
    path,
    format,
    originalFormat,
    byteLength: fileStat.size,
    sha256: await sha256File(path),
    artifactVersion: OFFLINE_ARTIFACT_VERSION,
    ccdVersion,
    // URLSession's temporary file + staging install + final contents. CCD packs
    // need more headroom because their stored ZIP resources expand on install.
    peakDiskBytes: Math.ceil(fileStat.size * extractionMultiplier) + 128 * 1024 * 1024,
  };
}

async function buildCcdArtifact(book: typeof books.$inferSelect): Promise<DownloadArtifact> {
  if (!book.ccdPath || book.ccdVersion !== CCD_VERSION) {
    throw new Error("ccd_not_ready");
  }
  const sourcePath = book.convertedEpubPath
    ? resolveStoragePath(book.convertedEpubPath)
    : resolveStoragePath(book.filePath);
  const ccdPath = resolveStoragePath(book.ccdPath);
  const cacheDirectory = `data/resource-cache/${book.id}/offline-artifacts-v${OFFLINE_ARTIFACT_VERSION}`;
  const pointerPath = resolveStoragePath(`${cacheDirectory}/ccd-current.json`);
  const [sourceStat, ccdStat] = await Promise.all([stat(sourcePath), stat(ccdPath)]);
  const inputKey = `${sourceStat.size}:${sourceStat.mtimeMs}:${ccdStat.size}:${ccdStat.mtimeMs}:${CCD_VERSION}`;
  const existingHash = await readPointer(pointerPath, inputKey);
  if (existingHash) {
    const existingPath = resolveStoragePath(`${cacheDirectory}/${existingHash}.zip`);
    if (await stat(existingPath).catch(() => null)) {
      return describe(book.id, existingPath, "ccdpack", book.format, CCD_VERSION, 4);
    }
  }
  const bundle = readCcdBundle<ContentBundle>(book.ccdPath);
  if (!bundle) throw new Error("ccd_not_found");
  const pack = await buildCcdPack(bundle, await readFile(sourcePath));
  const artifact = await persistContentAddressed(cacheDirectory, "zip", pack);
  await atomicWrite(
    pointerPath,
    Buffer.from(JSON.stringify({ inputKey, sha256: artifact.sha256 })),
  );
  return describe(book.id, artifact.path, "ccdpack", book.format, CCD_VERSION, 4);
}

async function buildCbzArtifact(book: typeof books.$inferSelect): Promise<DownloadArtifact> {
  const sourcePath = resolveStoragePath(book.filePath);
  const cacheDirectory = `data/resource-cache/${book.id}/offline-artifacts-v${OFFLINE_ARTIFACT_VERSION}`;
  const pointerPath = resolveStoragePath(`${cacheDirectory}/cbz-current.json`);
  const sourceStat = await stat(sourcePath);
  const inputKey = `${sourceStat.size}:${sourceStat.mtimeMs}`;
  const existingHash = await readPointer(pointerPath, inputKey);
  if (existingHash) {
    const existingPath = resolveStoragePath(`${cacheDirectory}/${existingHash}.cbz`);
    if (await stat(existingPath).catch(() => null)) {
      return describe(book.id, existingPath, "cbz", book.format, null, 2);
    }
  }
  const converted = Buffer.from(await convertCbrToCbz(await readFile(sourcePath)));
  const artifact = await persistContentAddressed(cacheDirectory, "cbz", converted);
  await atomicWrite(
    pointerPath,
    Buffer.from(JSON.stringify({ inputKey, sha256: artifact.sha256 })),
  );
  return describe(book.id, artifact.path, "cbz", book.format, null, 2);
}

async function resolveArtifactUncached(
  bookId: string,
  variant?: string,
): Promise<DownloadArtifact> {
  if (variant && variant !== "epub") throw new Error("invalid_variant");
  const book = await db.query.books.findFirst({ where: eq(books.id, bookId) });
  if (!book) throw new Error("book_not_found");
  if (variant === "epub") {
    if (!book.convertedEpubPath) throw new Error("converted_epub_not_ready");
    return snapshotFileArtifact(
      book.id,
      resolveStoragePath(book.convertedEpubPath),
      "epub",
      book.format,
    );
  }
  if (["epub", "mobi", "azw", "azw3"].includes(book.format)) {
    return buildCcdArtifact(book);
  }
  if (book.format === "cbr") return buildCbzArtifact(book);
  return snapshotFileArtifact(book.id, resolveStoragePath(book.filePath), book.format, book.format);
}

/** Resolve/build exactly one immutable artifact per book at a time. */
export async function resolveDownloadArtifact(
  bookId: string,
  variant?: string,
): Promise<DownloadArtifact> {
  const lockKey = `${bookId}:${variant || "default"}`;
  const existing = buildLocks.get(lockKey);
  if (existing) return existing;
  const task = resolveArtifactUncached(bookId, variant).finally(() => buildLocks.delete(lockKey));
  buildLocks.set(lockKey, task);
  return task;
}

/** Resolve the immutable revision named by a previously-issued manifest.
 * Historical files remain addressable so an in-flight range request or iOS
 * background resume cannot be invalidated by a source replacement.
 */
export async function resolveDownloadArtifactByHash(
  bookId: string,
  sha256: string,
  variant?: string,
): Promise<DownloadArtifact> {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("invalid_artifact");
  if (variant && variant !== "epub") throw new Error("invalid_variant");
  const book = await db.query.books.findFirst({ where: eq(books.id, bookId) });
  if (!book) throw new Error("book_not_found");

  const cacheDirectory = resolveStoragePath(
    `data/resource-cache/${bookId}/offline-artifacts-v${OFFLINE_ARTIFACT_VERSION}`,
  );
  const entries = await readdir(cacheDirectory).catch(() => [] as string[]);
  const candidates = entries.filter((entry) => entry.startsWith(`${sha256}.`));
  for (const entry of candidates) {
    const extension = extname(entry).slice(1).toLowerCase();
    if (variant === "epub" && extension !== "epub") continue;
    if (!variant && extension === "epub" && book.format !== "epub") continue;
    const format = extension === "zip" ? "ccdpack" : extension;
    const path = resolveStoragePath(
      `data/resource-cache/${bookId}/offline-artifacts-v${OFFLINE_ARTIFACT_VERSION}/${entry}`,
    );
    const artifact = await describe(
      bookId,
      path,
      format,
      book.format,
      format === "ccdpack" ? CCD_VERSION : null,
      format === "ccdpack" ? 4 : 2,
    );
    if (artifact.sha256 === sha256) return artifact;
  }
  throw new Error("artifact_not_found");
}
