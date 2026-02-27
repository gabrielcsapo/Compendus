import { mkdirSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { resolve, dirname, isAbsolute } from "path";
import type { BookFormat } from "../types";

const DATA_DIR = resolve(process.cwd(), "data");
const BOOKS_DIR = resolve(DATA_DIR, "books");
const COVERS_DIR = resolve(DATA_DIR, "covers");

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
  return resolve(process.cwd(), relativePath);
}

// Ensure directories exist
mkdirSync(BOOKS_DIR, { recursive: true });
mkdirSync(COVERS_DIR, { recursive: true });

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

export { BOOKS_DIR };
