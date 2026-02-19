import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { eq } from "drizzle-orm";
import { Worker } from "worker_threads";
import { join } from "path";

import { db, books } from "../db";
import { resolveStoragePath } from "../storage";
import { suppressConsole } from "../processing/utils";
import type { NormalizedContent } from "./types";
import type { BookFormat } from "../types";

// In-memory cache for parsed content
// Key is bookId, value is the normalized content
const contentCache = new Map<string, NormalizedContent>();

// Maximum number of books to keep in cache
const MAX_CACHE_SIZE = 10;

// LRU tracking - most recently used at the end
const cacheOrder: string[] = [];

/**
 * Get the path to the built worker file
 */
function getWorkerPath(): string | null {
  // Look for the built worker in dist/worker/
  const distWorkerPath = join(process.cwd(), "dist/worker/parser-worker.mjs");
  if (existsSync(distWorkerPath)) {
    return distWorkerPath;
  }
  return null;
}

/**
 * Parse book content in a worker thread to avoid blocking the main event loop
 */
async function parseInWorker(
  buffer: Buffer,
  format: BookFormat,
  bookId: string,
): Promise<NormalizedContent> {
  return new Promise((resolve, reject) => {
    const workerPath = getWorkerPath();
    if (!workerPath) {
      reject(new Error("Worker not built. Run 'npm run build:worker' first."));
      return;
    }

    const worker = new Worker(workerPath, {
      workerData: { buffer, format, bookId },
    });

    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("Parser worker timed out after 60 seconds"));
    }, 60000);

    worker.on(
      "message",
      (result: {
        success: boolean;
        content?: NormalizedContent;
        error?: string;
      }) => {
        clearTimeout(timeout);
        worker.terminate();
        if (result.success && result.content) {
          resolve(result.content);
        } else {
          reject(new Error(result.error || "Unknown worker error"));
        }
      },
    );

    worker.on("error", (error) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(error);
    });

    worker.on("exit", (code) => {
      if (code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Worker exited with code ${code}`));
      }
    });
  });
}

/**
 * Get normalized content for a book, parsing if not cached.
 * When formatOverride is "epub" and the book has a convertedEpubPath,
 * the converted EPUB is loaded instead of the original file.
 */
export async function getContent(
  bookId: string,
  formatOverride?: string,
): Promise<NormalizedContent | null> {
  // Cache key includes format override
  const cacheKey = formatOverride ? `${bookId}:${formatOverride}` : bookId;

  // Check cache first
  if (contentCache.has(cacheKey)) {
    // Update LRU order
    updateCacheOrder(cacheKey);
    return contentCache.get(cacheKey)!;
  }

  // Get book info from database
  const book = await db.select().from(books).where(eq(books.id, bookId)).get();
  if (!book) {
    return null;
  }

  // Determine which file and format to use
  let format = book.format as BookFormat;
  let filePath = resolveStoragePath(book.filePath);

  // If requesting EPUB format and book has a converted EPUB, use it
  if (formatOverride === "epub" && book.convertedEpubPath) {
    format = "epub";
    filePath = resolveStoragePath(book.convertedEpubPath);
  }

  if (!existsSync(filePath)) {
    console.error(`[Content Store] Book file not found: ${filePath}`);
    return null;
  }

  const buffer = await readFile(filePath);

  // Parse based on format
  const content = await parseByFormat(buffer, format, bookId);

  // Cache the result
  cacheContent(cacheKey, content);

  return content;
}

// Audio formats don't need buffer parsing - they use metadata from DB
const AUDIO_FORMATS: BookFormat[] = ["m4b", "m4a", "mp3"];

/**
 * Parse book content based on format
 * Uses worker thread for CPU-intensive formats on large files
 */
async function parseByFormat(
  buffer: Buffer,
  format: BookFormat,
  bookId: string,
): Promise<NormalizedContent> {
  // Skip worker for audio formats - they don't parse the buffer, just use DB metadata
  const useWorker = !AUDIO_FORMATS.includes(format);

  if (useWorker) {
    try {
      console.log(
        `[Content Store] Using worker thread for ${format} file (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`,
      );
      const result = await parseInWorker(buffer, format, bookId);
      console.log(
        `[Content Store] Worker returned content type: ${result.type}, pageCount: ${'pageCount' in result ? result.pageCount : 'N/A'}`,
      );
      return result;
    } catch (error) {
      // Fall back to main thread parsing if worker fails
      console.error(
        `[Content Store] Worker parsing failed, falling back to main thread:`,
        error,
      );
    }
  }

  // Parse on main thread (for small files, non-heavy formats, or worker fallback)
  const startTime = performance.now();
  const fileSizeMB = (buffer.length / 1024 / 1024).toFixed(1);
  console.log(
    `[Content Store] Starting main thread ${format} parse (${fileSizeMB}MB)`,
  );

  let result: NormalizedContent;

  switch (format) {
    case "epub": {
      const { parseEpub } = await import("./parsers/epub");
      result = await suppressConsole(() => parseEpub(buffer, bookId));
      break;
    }
    case "pdf": {
      const { parsePdf } = await import("./parsers/pdf");
      result = await parsePdf(buffer, bookId);
      break;
    }
    case "mobi":
    case "azw3": {
      const { parseMobi } = await import("./parsers/mobi");
      result = await parseMobi(buffer, bookId, format);
      break;
    }
    case "cbr":
    case "cbz": {
      const { parseComic } = await import("./parsers/comic");
      result = await parseComic(buffer, bookId, format);
      break;
    }
    case "m4b":
    case "m4a":
    case "mp3": {
      const { parseAudio } = await import("./parsers/audio");
      // Need to get duration and chapters from database
      const book = await db
        .select()
        .from(books)
        .where(eq(books.id, bookId))
        .get();
      result = await parseAudio(
        bookId,
        format,
        book?.duration || 0,
        book?.chapters,
      );
      break;
    }
    default:
      throw new Error(`Unsupported format: ${format}`);
  }

  const duration = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(
    `[Content Store] Completed main thread ${format} parse in ${duration}s`,
  );

  return result;
}

/**
 * Cache content with LRU eviction
 */
function cacheContent(bookId: string, content: NormalizedContent): void {
  // Evict oldest if at capacity
  while (contentCache.size >= MAX_CACHE_SIZE && cacheOrder.length > 0) {
    const oldestId = cacheOrder.shift();
    if (oldestId) {
      contentCache.delete(oldestId);
    }
  }

  contentCache.set(bookId, content);
  cacheOrder.push(bookId);
}

/**
 * Update LRU order when accessing cached content
 */
function updateCacheOrder(bookId: string): void {
  const index = cacheOrder.indexOf(bookId);
  if (index > -1) {
    cacheOrder.splice(index, 1);
    cacheOrder.push(bookId);
  }
}
