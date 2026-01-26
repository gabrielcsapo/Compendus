import { mkdirSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { resolve, dirname } from "path";
import type { BookFormat } from "../types";

const DATA_DIR = resolve(process.cwd(), "data");
const BOOKS_DIR = resolve(DATA_DIR, "books");
const COVERS_DIR = resolve(DATA_DIR, "covers");

// Ensure directories exist
mkdirSync(BOOKS_DIR, { recursive: true });
mkdirSync(COVERS_DIR, { recursive: true });

const FORMAT_EXTENSIONS: Record<BookFormat, string> = {
  pdf: ".pdf",
  epub: ".epub",
  mobi: ".mobi",
  cbr: ".cbr",
  cbz: ".cbz",
};

export function storeBookFile(buffer: Buffer, bookId: string, format: BookFormat): string {
  const ext = FORMAT_EXTENSIONS[format];
  const fileName = `${bookId}${ext}`;
  const filePath = resolve(BOOKS_DIR, fileName);

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, buffer);

  return filePath;
}

export function storeCoverImage(buffer: Buffer, bookId: string): string {
  const fileName = `${bookId}.jpg`;
  const filePath = resolve(COVERS_DIR, fileName);

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, buffer);

  return filePath;
}

export function deleteBookFile(filePath: string): boolean {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function deleteCoverImage(coverPath: string): boolean {
  try {
    if (existsSync(coverPath)) {
      unlinkSync(coverPath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function getBookFilePath(bookId: string, format: BookFormat): string {
  const ext = FORMAT_EXTENSIONS[format];
  return resolve(BOOKS_DIR, `${bookId}${ext}`);
}

export function getCoverPath(bookId: string): string {
  return resolve(COVERS_DIR, `${bookId}.jpg`);
}

export function bookFileExists(bookId: string, format: BookFormat): boolean {
  return existsSync(getBookFilePath(bookId, format));
}

export function coverExists(bookId: string): boolean {
  return existsSync(getCoverPath(bookId));
}

export { BOOKS_DIR, COVERS_DIR, DATA_DIR };
