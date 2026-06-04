import { mkdirSync, writeFileSync, existsSync, unlinkSync, readFileSync, rmSync } from "fs";
import { gzipSync, gunzipSync } from "zlib";
import { resolve, dirname, isAbsolute } from "path";
import type { BookFormat } from "../types";

// COMPENDUS_DATA_DIR overrides the data root (tests point it at a throwaway dir);
// defaults to <cwd>/data. Must match db/index.ts so DB + files share one root.
const DATA_DIR = process.env.COMPENDUS_DATA_DIR || resolve(process.cwd(), "data");
const BOOKS_DIR = resolve(DATA_DIR, "books");
const COVERS_DIR = resolve(DATA_DIR, "covers");
const AVATARS_DIR = resolve(DATA_DIR, "avatars");

/**
 * Resolve a relative path (stored in DB) to an absolute path.
 * Handles both new relative paths (e.g., "data/books/uuid.pdf") and
 * legacy absolute paths for backwards compatibility.
 */
export function resolveStoragePath(relativePath: string): string {
  if (isAbsolute(relativePath)) {
    // Legacy absolute path - return as-is for backwards compatibility
    return relativePath;
  }
  // Stored paths are "data/<...>"; when COMPENDUS_DATA_DIR overrides the data root
  // (tests), remap that prefix to it so writes (BOOKS_DIR) and reads line up. In
  // dev/prod (no override) this is identical to resolve(cwd, "data/<...>").
  if (process.env.COMPENDUS_DATA_DIR) {
    const m = relativePath.match(/^data[\\/](.*)$/);
    if (m) return resolve(DATA_DIR, m[1]);
  }
  return resolve(process.cwd(), relativePath);
}

// Ensure directories exist
mkdirSync(BOOKS_DIR, { recursive: true });
mkdirSync(COVERS_DIR, { recursive: true });
mkdirSync(AVATARS_DIR, { recursive: true });

const FORMAT_EXTENSIONS: Record<BookFormat, string> = {
  pdf: ".pdf",
  epub: ".epub",
  mobi: ".mobi",
  azw3: ".azw3",
  cbr: ".cbr",
  cbz: ".cbz",
  m4b: ".m4b",
  mp3: ".mp3",
  m4a: ".m4a",
};

export function storeBookFile(buffer: Buffer, bookId: string, format: BookFormat): string {
  const ext = FORMAT_EXTENSIONS[format];
  const fileName = `${bookId}${ext}`;
  const absolutePath = resolve(BOOKS_DIR, fileName);

  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, buffer);

  // Return relative path for database storage
  return `data/books/${fileName}`;
}

export function storeCoverImage(buffer: Buffer, bookId: string): string {
  const fileName = `${bookId}.jpg`;
  const absolutePath = resolve(COVERS_DIR, fileName);

  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, buffer);

  // Return relative path for database storage
  return `data/covers/${fileName}`;
}

export function storeCoverThumbnail(buffer: Buffer, bookId: string): void {
  const fileName = `${bookId}.thumb.jpg`;
  const absolutePath = resolve(COVERS_DIR, fileName);

  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, buffer);
}

export function deleteBookFile(filePath: string): boolean {
  try {
    const absolutePath = resolveStoragePath(filePath);
    if (existsSync(absolutePath)) {
      unlinkSync(absolutePath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function deleteCoverImage(coverPath: string): boolean {
  try {
    const absolutePath = resolveStoragePath(coverPath);
    if (existsSync(absolutePath)) {
      unlinkSync(absolutePath);
    }
    // Also delete thumbnail if it exists
    const thumbPath = absolutePath.replace(/\.jpg$/, ".thumb.jpg");
    if (existsSync(thumbPath)) {
      unlinkSync(thumbPath);
    }
    return true;
  } catch {
    return false;
  }
}

export function getBookFilePath(bookId: string, format: BookFormat): string {
  const ext = FORMAT_EXTENSIONS[format];
  // Return absolute path for file operations
  return resolve(BOOKS_DIR, `${bookId}${ext}`);
}

export function getBookFileRelativePath(bookId: string, format: BookFormat): string {
  const ext = FORMAT_EXTENSIONS[format];
  // Return relative path for database storage
  return `data/books/${bookId}${ext}`;
}

export function storeAvatarImage(buffer: Buffer, profileId: string): string {
  const fileName = `${profileId}.jpg`;
  const absolutePath = resolve(AVATARS_DIR, fileName);

  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, buffer);

  return `data/avatars/${fileName}`;
}

export function deleteAvatarImage(profileId: string): boolean {
  try {
    const absolutePath = resolve(AVATARS_DIR, `${profileId}.jpg`);
    if (existsSync(absolutePath)) {
      unlinkSync(absolutePath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ── CCD bundle (canonical content document) ──
// One gzipped JSON bundle per book at data/books/{id}.ccd.json.gz.

export function storeCcdBundle(bookId: string, bundleJson: string): string {
  const fileName = `${bookId}.ccd.json.gz`;
  const absolutePath = resolve(BOOKS_DIR, fileName);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, gzipSync(Buffer.from(bundleJson, "utf8")));
  return `data/books/${fileName}`;
}

/** Read + parse a CCD bundle by its stored relative path. Returns null if absent. */
export function readCcdBundle<T = unknown>(ccdPath: string): T | null {
  const absolutePath = resolveStoragePath(ccdPath);
  if (!existsSync(absolutePath)) return null;
  return JSON.parse(gunzipSync(readFileSync(absolutePath)).toString("utf8")) as T;
}

export function deleteCcdBundle(ccdPath: string): void {
  try {
    const absolutePath = resolveStoragePath(ccdPath);
    if (existsSync(absolutePath)) unlinkSync(absolutePath);
  } catch {
    /* ignore */
  }
}

/** Remove a book's cached resources + CCD pack (data/resource-cache/{id}/).
 *  Mirrors server/lib/file-serving RESOURCE_CACHE_DIR; safe if absent. */
export function deleteResourceCache(bookId: string): void {
  try {
    const dir = resolve(DATA_DIR, "resource-cache", bookId);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export { BOOKS_DIR };
