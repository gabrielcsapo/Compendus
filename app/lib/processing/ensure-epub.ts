import { readFile } from "fs/promises";
import { writeFileSync, statSync, existsSync } from "fs";
import { resolve } from "path";
import { eq } from "drizzle-orm";
import { db, books } from "../db";
import { resolveStoragePath } from "../storage";

type BookRow = typeof books.$inferSelect;

/** Non-EPUB formats we can render into EPUB. Audiobooks and comics can't. */
export const CONVERTIBLE_FORMATS = ["pdf", "mobi", "azw3"];

export interface ConvertProgress {
  onProgress?: (percent: number, message: string) => void;
}

function parseAuthors(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

/**
 * Return an absolute path to a usable EPUB for this book, converting on demand:
 * EPUBs are returned as-is, a prior conversion is reused if still on disk, and
 * PDF/MOBI/AZW3 are converted now. Throws a clear reason for formats that can't
 * become EPUB (audiobooks, comics) so callers can surface it.
 */
export async function ensureEpub(book: BookRow, opts: ConvertProgress = {}): Promise<string> {
  if (book.format === "epub") return resolveStoragePath(book.filePath);

  if (book.convertedEpubPath) {
    const existing = resolveStoragePath(book.convertedEpubPath);
    if (existsSync(existing)) return existing;
  }

  if (!CONVERTIBLE_FORMATS.includes(book.format)) {
    throw new Error(
      `${book.format.toUpperCase()} books can't be analyzed — only EPUB, PDF, MOBI, and AZW3 are supported`,
    );
  }

  return convertBookToEpub(book, opts);
}

/**
 * Convert a PDF/MOBI/AZW3 book to EPUB, persist it next to the original as
 * `data/books/<id>.epub`, and record `convertedEpubPath`/`convertedEpubSize` on
 * the book. Returns the absolute path to the written EPUB.
 */
export async function convertBookToEpub(
  book: BookRow,
  opts: ConvertProgress = {},
): Promise<string> {
  const onProgress = opts.onProgress ?? (() => {});
  const sourcePath = resolveStoragePath(book.filePath);
  if (!existsSync(sourcePath)) {
    throw new Error("Source file not found on disk");
  }

  const buffer = await readFile(sourcePath);
  const metadata = {
    title: book.title,
    authors: parseAuthors(book.authors),
    language: book.language ?? undefined,
  };

  const epubRel = `data/books/${book.id}.epub`;
  const epubPath = resolve(process.cwd(), epubRel);

  if (book.format === "pdf") {
    // PDFs can produce GB-scale image-heavy EPUBs — stream the ZIP straight
    // to disk instead of materializing it (this OOM-killed the container).
    const { convertPdfToEpub } = await import("./pdf-to-epub");
    await convertPdfToEpub(buffer, metadata, { onProgress, streamToFile: epubPath });
  } else {
    const { convertMobiToEpub } = await import("./mobi-to-epub");
    const epubBuffer = await convertMobiToEpub(buffer, metadata, { onProgress });
    writeFileSync(epubPath, epubBuffer);
  }

  const epubSize = statSync(epubPath).size;

  await db
    .update(books)
    .set({ convertedEpubPath: epubRel, convertedEpubSize: epubSize })
    .where(eq(books.id, book.id));

  return epubPath;
}
