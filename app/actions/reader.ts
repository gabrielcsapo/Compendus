"use server";

import { db, books, bookmarks, highlights, userBookState, readingSessions } from "../lib/db";
import { eq, and, isNull, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { resolveProfileId } from "../lib/profile";
import { getContent, paginationEngine } from "../lib/reader";
import type {
  ViewportConfig,
  TocEntry,
  PageContent,
  ReaderInfoResponse,
  ReaderPageResponse,
  ReaderBookmark,
  ReaderHighlight,
  FullTextContentResponse,
} from "../lib/reader/types";
import type { BookFormat } from "../lib/types";

// ============================================
// BOOKMARKS
// ============================================

export async function getBookmarks(bookId: string, profileId?: string): Promise<ReaderBookmark[]> {
  const conditions = [eq(bookmarks.bookId, bookId), isNull(bookmarks.deletedAt)];
  if (profileId) conditions.push(eq(bookmarks.profileId, profileId));

  const bookmarksList = await db
    .select()
    .from(bookmarks)
    .where(and(...conditions))
    .all();

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
  profileId?: string,
): Promise<ReaderBookmark> {
  const resolvedProfileId = profileId ?? resolveProfileId();
  if (!resolvedProfileId) throw new Error("profileId is required");
  profileId = resolvedProfileId;
  const id = randomUUID();
  const createdAt = new Date();
  const updatedAt = new Date();
  await db.insert(bookmarks).values({
    id,
    bookId,
    profileId,
    position: position.toString(),
    title: title || null,
    note: note || null,
    color: color || null,
    updatedAt,
  });

  return { id, bookId, position, title, note, color, createdAt };
}

export async function deleteBookmark(bookmarkId: string, profileId?: string): Promise<void> {
  // Verify ownership before soft-deleting (if profileId provided)
  const bookmark = await db.select().from(bookmarks).where(eq(bookmarks.id, bookmarkId)).get();
  if (!bookmark) return;
  if (profileId && bookmark.profileId !== profileId) return;

  const now = new Date();
  await db
    .update(bookmarks)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(bookmarks.id, bookmarkId));
}

// ============================================
// HIGHLIGHTS
// ============================================

export async function getHighlights(
  bookId: string,
  profileId?: string,
): Promise<ReaderHighlight[]> {
  const conditions = [eq(highlights.bookId, bookId), isNull(highlights.deletedAt)];
  if (profileId) conditions.push(eq(highlights.profileId, profileId));

  const highlightsList = await db
    .select()
    .from(highlights)
    .where(and(...conditions))
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
  profileId?: string,
): Promise<ReaderHighlight> {
  const resolvedProfileId = profileId ?? resolveProfileId();
  if (!resolvedProfileId) throw new Error("profileId is required");
  profileId = resolvedProfileId;
  const id = randomUUID();
  const highlightColor = color || "#ffff00";
  const createdAt = new Date();
  const updatedAt = new Date();

  await db.insert(highlights).values({
    id,
    bookId,
    profileId,
    startPosition: startPosition.toString(),
    endPosition: endPosition.toString(),
    text,
    note: note || null,
    color: highlightColor,
    updatedAt,
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

export async function deleteHighlight(highlightId: string, profileId?: string): Promise<void> {
  // Verify ownership before soft-deleting (if profileId provided)
  const highlight = await db.select().from(highlights).where(eq(highlights.id, highlightId)).get();
  if (!highlight) return;
  if (profileId && highlight.profileId !== profileId) return;

  const now = new Date();
  await db
    .update(highlights)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(highlights.id, highlightId));
}

export async function updateHighlightNote(
  highlightId: string,
  note: string | null,
  profileId?: string,
): Promise<void> {
  const resolvedProfileId = profileId ?? resolveProfileId();
  if (!resolvedProfileId) throw new Error("profileId is required");
  profileId = resolvedProfileId;
  await db
    .update(highlights)
    .set({ note: note || null, updatedAt: new Date() })
    .where(and(eq(highlights.id, highlightId), eq(highlights.profileId, profileId)));
}

export async function updateHighlightColor(
  highlightId: string,
  color: string,
  profileId?: string,
): Promise<void> {
  const resolvedProfileId = profileId ?? resolveProfileId();
  if (!resolvedProfileId) throw new Error("profileId is required");
  profileId = resolvedProfileId;
  await db
    .update(highlights)
    .set({ color, updatedAt: new Date() })
    .where(and(eq(highlights.id, highlightId), eq(highlights.profileId, profileId)));
}

export async function getAllHighlights(
  profileId?: string,
  limit = 200,
  offset = 0,
): Promise<
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
    bookUpdatedAt?: Date;
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
      bookUpdatedAt: books.updatedAt,
      bookFormat: books.format,
    })
    .from(highlights)
    .innerJoin(books, eq(highlights.bookId, books.id))
    .where(
      profileId
        ? and(eq(highlights.profileId, profileId), isNull(highlights.deletedAt))
        : isNull(highlights.deletedAt),
    )
    .orderBy(sql`${highlights.createdAt} DESC`)
    .limit(limit)
    .offset(offset)
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
    bookUpdatedAt: h.bookUpdatedAt ?? undefined,
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
  profileId?: string,
  positionJSON?: string,
): Promise<{ position: number; pageNum?: number }> {
  const resolvedProfileId = profileId ?? resolveProfileId();
  if (!resolvedProfileId) throw new Error("profileId is required");
  profileId = resolvedProfileId;

  const now = new Date();
  // Use universal position format if provided, otherwise legacy format
  const lastPosition = positionJSON ?? JSON.stringify({ position, pageNum });

  // Check if a record already exists for this profile + book
  const existing = await db
    .select()
    .from(userBookState)
    .where(and(eq(userBookState.profileId, profileId), eq(userBookState.bookId, bookId)))
    .get();

  if (existing) {
    await db
      .update(userBookState)
      .set({
        readingProgress: position,
        lastPosition,
        lastReadAt: now,
        updatedAt: now,
      })
      .where(eq(userBookState.id, existing.id));
  } else {
    await db.insert(userBookState).values({
      id: randomUUID(),
      profileId,
      bookId,
      readingProgress: position,
      lastPosition,
      lastReadAt: now,
      updatedAt: now,
    });
  }

  return { position, pageNum };
}

export async function getBookProgress(
  bookId: string,
  profileId?: string,
): Promise<{
  readingProgress: number;
  lastPosition: string | null;
  lastReadAt: Date | null;
} | null> {
  const conditions = [eq(userBookState.bookId, bookId)];
  if (profileId) conditions.push(eq(userBookState.profileId, profileId));

  const state = await db
    .select()
    .from(userBookState)
    .where(and(...conditions))
    .get();

  if (!state) return null;

  return {
    readingProgress: state.readingProgress ?? 0,
    lastPosition: state.lastPosition,
    lastReadAt: state.lastReadAt,
  };
}

// ============================================
// PROFILE RESOLUTION
// ============================================

// resolveProfileId is imported from ../lib/profile

// ============================================
// READING SESSIONS
// ============================================

export async function createReadingSession(
  bookId: string,
  startPosition?: string,
): Promise<string> {
  const profileId = resolveProfileId();
  if (!profileId) throw new Error("profileId is required");

  const id = randomUUID();
  const now = new Date();

  await db.insert(readingSessions).values({
    id,
    profileId,
    bookId,
    startedAt: now,
    startPosition: startPosition ?? null,
  });

  return id;
}

export async function endReadingSession(
  sessionId: string,
  endPosition?: string,
  pagesRead?: number,
): Promise<void> {
  const profileId = resolveProfileId();
  if (!profileId) return;

  // Verify ownership before updating
  const session = await db
    .select()
    .from(readingSessions)
    .where(eq(readingSessions.id, sessionId))
    .get();
  if (!session || session.profileId !== profileId) return;

  const now = new Date();
  await db
    .update(readingSessions)
    .set({
      endedAt: now,
      endPosition: endPosition ?? null,
      pagesRead: pagesRead ?? null,
    })
    .where(eq(readingSessions.id, sessionId));
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
  console.log(
    `[getReaderInfo] Getting content for book ${bookId} (format: ${book.format}${formatOverride ? `, override: ${formatOverride}` : ""})`,
  );
  const content = await getContent(bookId, formatOverride);
  if (!content) {
    console.log(`[getReaderInfo] No content returned for book ${bookId}`);
    return null;
  }
  console.log(
    `[getReaderInfo] Content type: ${content.type}, pageCount: ${"pageCount" in content ? content.pageCount : "N/A"}`,
  );

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
    response.hasTranscript = !!book.transcriptPath;
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

export async function searchContent(
  bookId: string,
  query: string,
  viewport: ViewportConfig,
  formatOverride?: string,
  maxResults = 50,
): Promise<
  Array<{
    text: string;
    context: string;
    position: number;
    pageNum: number;
    chapterTitle?: string;
  }>
> {
  if (!query.trim()) return [];

  const content = await getContent(bookId, formatOverride);
  if (!content) return [];

  return paginationEngine.searchContent(content, query, viewport, maxResults);
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

// ============================================
// FULL TEXT CONTENT (for client-side CSS column pagination)
// ============================================

/**
 * Get full text content for client-side pagination.
 * Returns all chapter HTML concatenated with chapter boundary markers.
 * The client uses CSS multi-column layout to paginate based on actual rendered text.
 */
export async function getFullTextContent(
  bookId: string,
  formatOverride?: string,
): Promise<FullTextContentResponse | null> {
  const content = await getContent(bookId, formatOverride);
  if (!content || content.type !== "text") return null;

  // FXL EPUBs use per-page server rendering, not column pagination
  if (content.isFixedLayout) return null;

  const htmlParts: string[] = [];
  const chapters: FullTextContentResponse["chapters"] = [];
  const cssUrlSet = new Set<string>();

  for (const chapter of content.chapters) {
    // Wrap each chapter with data attributes for position tracking
    htmlParts.push(
      `<div data-chapter-id="${chapter.id}" data-char-start="${chapter.characterStart}" data-char-end="${chapter.characterEnd}">${chapter.html}</div>`,
    );
    chapters.push({
      title: chapter.title,
      characterStart: chapter.characterStart,
      characterEnd: chapter.characterEnd,
    });
    if (chapter.cssFiles) {
      for (const f of chapter.cssFiles) {
        cssUrlSet.add(`/api/reader/${bookId}/resource/${encodeURIComponent(f)}`);
      }
    }
  }

  return {
    html: htmlParts.join("\n"),
    cssUrls: Array.from(cssUrlSet),
    chapters,
    totalCharacters: content.totalCharacters,
    isFixedLayout: content.isFixedLayout,
    chapterHrefMap: content.chapterHrefMap,
  };
}

// ============================================
// INTERNAL LINK RESOLUTION
// ============================================

/**
 * Resolve an internal EPUB link (cross-chapter or same-chapter fragment)
 * to a normalized 0-1 position within the book.
 */
export async function resolveInternalLink(
  bookId: string,
  href: string,
  formatOverride?: string,
): Promise<{ position: number } | null> {
  const content = await getContent(bookId, formatOverride);
  if (!content || content.type !== "text") return null;

  const textContent = content;
  if (!textContent.chapterHrefMap) return null;

  // Extract the file part and fragment from the href
  const [filePart, fragment] = href.split("#");

  // Try direct match in the href map
  if (filePart && textContent.chapterHrefMap[filePart] !== undefined) {
    return { position: textContent.chapterHrefMap[filePart] };
  }

  // Try matching by filename only
  const filename = filePart?.split("/").pop();
  if (filename && textContent.chapterHrefMap[filename] !== undefined) {
    return { position: textContent.chapterHrefMap[filename] };
  }

  // Try partial matching against chapter hrefs
  for (const chapter of textContent.chapters) {
    if (
      chapter.href &&
      filePart &&
      (chapter.href.includes(filePart) || filePart.includes(chapter.href))
    ) {
      const position = chapter.characterStart / Math.max(1, textContent.totalCharacters);
      return { position };
    }
  }

  // If only a fragment (same-chapter anchor), we can't resolve without knowing the current chapter
  if (!filePart && fragment) {
    return null;
  }

  return null;
}

// ============================================
// FOOTNOTE CONTENT
// ============================================

/**
 * Fetch the text content of a footnote by resolving the href fragment.
 */
export async function getFootnoteContent(
  bookId: string,
  href: string,
  formatOverride?: string,
): Promise<string | null> {
  const content = await getContent(bookId, formatOverride);
  if (!content || content.type !== "text") return null;

  const [filePart, fragment] = href.split("#");
  if (!fragment) return null;

  // Find the chapter containing the footnote target
  const textContent = content;
  let targetChapter = null;

  if (filePart) {
    targetChapter = textContent.chapters.find(
      (ch) =>
        ch.id === filePart ||
        ch.href === filePart ||
        (ch.href && filePart.includes(ch.href)) ||
        (ch.href && ch.href.includes(filePart)),
    );
  }

  // If no file part, search all chapters
  const chaptersToSearch = targetChapter ? [targetChapter] : textContent.chapters;

  for (const chapter of chaptersToSearch) {
    // Look for element with matching id attribute
    const escapedFragment = fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const idPattern = new RegExp(
      `id\\s*=\\s*["']${escapedFragment}["'][^>]*>([\\s\\S]*?)(?=<\\/(?:aside|div|p|section|li|dd|td|span|note))`,
      "i",
    );
    const match = chapter.html.match(idPattern);
    if (match) {
      // Strip HTML tags to get plain text
      const text = match[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) return text;
    }
  }

  return null;
}
