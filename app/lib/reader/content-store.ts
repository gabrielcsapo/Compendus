import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { eq } from "drizzle-orm";

import { db, books } from "../db";
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
 * Get normalized content for a book, parsing if not cached
 */
export async function getContent(bookId: string): Promise<NormalizedContent | null> {
  // Check cache first
  if (contentCache.has(bookId)) {
    // Update LRU order
    updateCacheOrder(bookId);
    return contentCache.get(bookId)!;
  }

  // Get book info from database
  const book = await db.select().from(books).where(eq(books.id, bookId)).get();
  if (!book) {
    return null;
  }

  // Read book file using the stored filePath directly
  // (filePath is the actual path on disk, format is derived from original fileName which may differ)
  const format = book.format as BookFormat;
  const filePath = book.filePath;
  if (!existsSync(filePath)) {
    console.error(`[Content Store] Book file not found: ${filePath}`);
    return null;
  }

  const buffer = await readFile(filePath);

  // Parse based on format
  const content = await parseByFormat(buffer, format, bookId);

  // Cache the result
  cacheContent(bookId, content);

  return content;
}

/**
 * Parse book content based on format
 */
async function parseByFormat(
  buffer: Buffer,
  format: BookFormat,
  bookId: string,
): Promise<NormalizedContent> {
  switch (format) {
    case "epub": {
      const { parseEpub } = await import("./parsers/epub");
      return suppressConsole(() => parseEpub(buffer, bookId));
    }
    case "pdf": {
      const { parsePdf } = await import("./parsers/pdf");
      return parsePdf(buffer, bookId);
    }
    case "mobi":
    case "azw3": {
      const { parseMobi } = await import("./parsers/mobi");
      return parseMobi(buffer, bookId, format);
    }
    case "cbr":
    case "cbz": {
      const { parseComic } = await import("./parsers/comic");
      return parseComic(buffer, bookId, format);
    }
    case "m4b":
    case "m4a":
    case "mp3": {
      const { parseAudio } = await import("./parsers/audio");
      // Need to get duration and chapters from database
      const book = await db.select().from(books).where(eq(books.id, bookId)).get();
      return parseAudio(bookId, format, book?.duration || 0, book?.chapters);
    }
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
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

/**
 * Invalidate cached content for a book
 */
export function invalidateContent(bookId: string): void {
  contentCache.delete(bookId);
  const index = cacheOrder.indexOf(bookId);
  if (index > -1) {
    cacheOrder.splice(index, 1);
  }
}

/**
 * Clear entire cache
 */
export function clearContentCache(): void {
  contentCache.clear();
  cacheOrder.length = 0;
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { size: number; maxSize: number; keys: string[] } {
  return {
    size: contentCache.size,
    maxSize: MAX_CACHE_SIZE,
    keys: [...cacheOrder],
  };
}
