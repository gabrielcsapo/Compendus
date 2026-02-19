"use server";

import { db, books, bookmarks, highlights } from "../lib/db";
import { eq, sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { getContent, paginationEngine } from "../lib/reader";
import type {
  ViewportConfig,
  TocEntry,
  PageContent,
  ReaderInfoResponse,
  ReaderPageResponse,
  ReaderBookmark,
  ReaderHighlight,
} from "../lib/reader/types";
import type { BookFormat } from "../lib/types";

// ============================================
// BOOKMARKS
// ============================================

export async function getBookmarks(bookId: string): Promise<ReaderBookmark[]> {
  const bookmarksList = await db.select().from(bookmarks).where(eq(bookmarks.bookId, bookId)).all();

  return bookmarksList.map((b) => ({
    id: b.id,
    bookId: b.bookId,
    position: parseFloat(b.position),
    title: b.title ?? undefined,
    note: b.note ?? undefined,
    color: b.color ?? undefined,
    createdAt: b.createdAt ?? new Date(),
  }));
}

export async function addBookmark(
  bookId: string,
  position: number,
  title?: string,
  note?: string,
  color?: string,
): Promise<ReaderBookmark> {
  const id = uuid();
  const createdAt = new Date();
  await db.insert(bookmarks).values({
    id,
    bookId,
    position: position.toString(),
    title: title || null,
    note: note || null,
    color: color || null,
  });

  return { id, bookId, position, title, note, color, createdAt };
}

export async function deleteBookmark(bookmarkId: string): Promise<void> {
  await db.delete(bookmarks).where(eq(bookmarks.id, bookmarkId));
}

// ============================================
// HIGHLIGHTS
// ============================================

export async function getHighlights(bookId: string): Promise<ReaderHighlight[]> {
  const highlightsList = await db
    .select()
    .from(highlights)
    .where(eq(highlights.bookId, bookId))
    .all();

  return highlightsList.map((h) => ({
    id: h.id,
    bookId: h.bookId,
    startPosition: parseFloat(h.startPosition),
    endPosition: parseFloat(h.endPosition),
    text: h.text,
    note: h.note ?? undefined,
    color: h.color ?? "#ffff00",
    createdAt: h.createdAt ?? new Date(),
  }));
}

export async function addHighlight(
  bookId: string,
  startPosition: number,
  endPosition: number,
  text: string,
  note?: string,
  color?: string,
): Promise<ReaderHighlight> {
  const id = uuid();
  const highlightColor = color || "#ffff00";
  const createdAt = new Date();

  await db.insert(highlights).values({
    id,
    bookId,
    startPosition: startPosition.toString(),
    endPosition: endPosition.toString(),
    text,
    note: note || null,
    color: highlightColor,
  });

  return {
    id,
    bookId,
    startPosition,
    endPosition,
    text,
    note,
    color: highlightColor,
    createdAt,
  };
}

export async function deleteHighlight(highlightId: string): Promise<void> {
  await db.delete(highlights).where(eq(highlights.id, highlightId));
}

export async function updateHighlightNote(
  highlightId: string,
  note: string | null,
): Promise<void> {
  await db
    .update(highlights)
    .set({ note: note || null })
    .where(eq(highlights.id, highlightId));
}

export async function updateHighlightColor(
  highlightId: string,
  color: string,
): Promise<void> {
  await db
    .update(highlights)
    .set({ color })
    .where(eq(highlights.id, highlightId));
}

export async function getAllHighlights(): Promise<
  {
    id: string;
    bookId: string;
    startPosition: number;
    endPosition: number;
    text: string;
    note?: string;
    color: string;
    createdAt: Date;
    bookTitle: string;
    bookAuthors: string[];
    bookCoverPath?: string;
    bookFormat: string;
  }[]
> {
  const rows = await db
    .select({
      id: highlights.id,
      bookId: highlights.bookId,
      startPosition: highlights.startPosition,
      endPosition: highlights.endPosition,
      text: highlights.text,
      note: highlights.note,
      color: highlights.color,
      createdAt: highlights.createdAt,
      bookTitle: books.title,
      bookAuthors: books.authors,
      bookCoverPath: books.coverPath,
      bookFormat: books.format,
    })
    .from(highlights)
    .innerJoin(books, eq(highlights.bookId, books.id))
    .orderBy(sql`${highlights.createdAt} DESC`)
    .all();

  return rows.map((h) => ({
    id: h.id,
    bookId: h.bookId,
    startPosition: parseFloat(h.startPosition),
    endPosition: parseFloat(h.endPosition),
    text: h.text,
    note: h.note ?? undefined,
    color: h.color ?? "#ffff00",
    createdAt: h.createdAt ?? new Date(),
    bookTitle: h.bookTitle,
    bookAuthors: h.bookAuthors ? JSON.parse(h.bookAuthors) : [],
    bookCoverPath: h.bookCoverPath ?? undefined,
    bookFormat: h.bookFormat,
  }));
}

// ============================================
// READING PROGRESS
// ============================================

export async function saveReadingProgress(
  bookId: string,
  position: number,
  pageNum?: number,
): Promise<{ position: number; pageNum?: number }> {
  await db
    .update(books)
    .set({
      readingProgress: position,
      lastPosition: JSON.stringify({ position, pageNum }),
      lastReadAt: sql`(unixepoch())`,
      updatedAt: sql`(unixepoch())`,
    })
    .where(eq(books.id, bookId));

  return { position, pageNum };
}

// ============================================
// READER CONTENT
// ============================================

export async function getReaderInfo(
  bookId: string,
  viewport: ViewportConfig,
  formatOverride?: string,
): Promise<ReaderInfoResponse | null> {
  // Get book from database
  const book = await db.select().from(books).where(eq(books.id, bookId)).get();
  if (!book) return null;

  // Get normalized content
  console.log(`[getReaderInfo] Getting content for book ${bookId} (format: ${book.format}${formatOverride ? `, override: ${formatOverride}` : ''})`);
  const content = await getContent(bookId, formatOverride);
  if (!content) {
    console.log(`[getReaderInfo] No content returned for book ${bookId}`);
    return null;
  }
  console.log(`[getReaderInfo] Content type: ${content.type}, pageCount: ${'pageCount' in content ? content.pageCount : 'N/A'}`);

  // Check for empty content (indicates parsing failure)
  // For text content, check both totalCharacters and chapters length (image-based books have chapters but 0 chars)
  if (content.type === "text" && content.totalCharacters === 0 && content.chapters.length === 0) {
    console.error(`[Reader] Empty content for book ${bookId} (format: ${book.format})`);
    // If there's a specific error message from the parser, return it
    if (content.error) {
      return {
        id: book.id,
        title: book.title,
        format: book.format as BookFormat,
        totalPages: 0,
        toc: [],
        error: content.error,
      };
    }
    return null;
  }

  // Calculate total pages for viewport
  const totalPages = paginationEngine.calculateTotalPages(content, viewport);

  // Get TOC with page numbers
  let toc: TocEntry[] = [];
  if (content.type === "text" || content.type === "pdf") {
    toc = paginationEngine.calculateTocPageNumbers(content, content.toc, viewport);
  }

  const response: ReaderInfoResponse = {
    id: book.id,
    title: book.title,
    format: book.format as BookFormat,
    totalPages,
    toc,
    coverPath: book.coverPath || undefined,
  };

  // Add audio-specific fields
  if (content.type === "audio") {
    response.duration = content.duration;
    response.chapters = content.chapters;
  }

  return response;
}

export async function getReaderPage(
  bookId: string,
  pageNum: number,
  viewport: ViewportConfig,
  formatOverride?: string,
): Promise<ReaderPageResponse | null> {
  // Get normalized content
  const content = await getContent(bookId, formatOverride);
  if (!content) return null;

  const totalPages = paginationEngine.calculateTotalPages(content, viewport);
  const pageContent = paginationEngine.getPage(content, pageNum, viewport, bookId);

  return {
    pageNum: Math.max(1, Math.min(pageNum, totalPages)),
    totalPages,
    position: pageContent.position,
    content: pageContent,
    nextPage: pageNum < totalPages ? pageNum + 1 : null,
    prevPage: pageNum > 1 ? pageNum - 1 : null,
  };
}

export async function getReaderPageForPosition(
  bookId: string,
  position: number,
  viewport: ViewportConfig,
  formatOverride?: string,
): Promise<{ pageNum: number; content: PageContent; position: number } | null> {
  // Get normalized content
  const content = await getContent(bookId, formatOverride);
  if (!content) return null;

  const pageNum = paginationEngine.getPageForPosition(content, position, viewport);
  const pageContent = paginationEngine.getPage(content, pageNum, viewport, bookId);

  return {
    pageNum,
    content: pageContent,
    position: pageContent.position,
  };
}

