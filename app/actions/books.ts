"use server";

import { db, books, booksTags, booksCollections, tags, bookEdits, userBookState } from "../lib/db";
import { eq, desc, asc, like, inArray, sql, and, or } from "drizzle-orm";
import {
  deleteBookFile,
  deleteCoverImage,
  getBookFilePath,
  resolveStoragePath,
} from "../lib/storage";
import { findBestMetadata, searchAllSources, type MetadataSearchResult } from "../lib/metadata";
import { processAndStoreCover } from "../lib/processing/cover";
import { writeMetadataToFile } from "../lib/processing/metadata-writer";
import type { Book, NewBookEdit } from "../lib/db/schema";
import type { BookFormat } from "../lib/types";
import { v4 as uuid } from "uuid";
import { randomUUID } from "crypto";
import { getFormatsByType, type BookType } from "../lib/book-types";
import { resolveProfileId } from "../lib/profile";

/**
 * Book with per-profile reading state overlaid from userBookState.
 * When profileId is provided, the reading state fields come from userBookState
 * instead of the deprecated columns on books.
 */
export type BookWithState = Book;

/**
 * Generate a clean filename from title and authors
 */
function generateFileName(title: string, authors: string[], format: string): string {
  // Sanitize: remove characters not allowed in filenames
  const sanitize = (str: string) =>
    str
      .replace(/[<>:"/\\|?*]/g, "") // Remove illegal chars
      .replace(/\s+/g, " ") // Collapse whitespace
      .trim()
      .slice(0, 100); // Limit length

  const cleanTitle = sanitize(title);
  const cleanAuthors = authors.length > 0 ? sanitize(authors.join(", ")) : "";

  // Format: "Author - Title.ext" or just "Title.ext" if no author
  const baseName = cleanAuthors ? `${cleanAuthors} - ${cleanTitle}` : cleanTitle;

  return `${baseName}.${format}`;
}

interface GetBooksOptions {
  limit?: number;
  offset?: number;
  orderBy?: "title" | "createdAt" | "lastReadAt";
  order?: "asc" | "desc";
  format?: string | string[];
  type?: BookType;
  collectionId?: string;
  tagId?: string;
  search?: string;
  series?: string;
  profileId?: string;
}

export async function getBooks(options: GetBooksOptions = {}): Promise<BookWithState[]> {
  const {
    limit = 50,
    offset = 0,
    orderBy = "createdAt",
    order = "desc",
    format,
    type,
    collectionId,
    tagId,
    search,
    series,
    profileId: explicitProfileId,
  } = options;
  const profileId = explicitProfileId ?? resolveProfileId();

  // When profileId is provided, LEFT JOIN userBookState to overlay per-profile reading state
  if (profileId) {
    let query = db
      .select({
        book: books,
        ubsReadingProgress: userBookState.readingProgress,
        ubsLastReadAt: userBookState.lastReadAt,
        ubsLastPosition: userBookState.lastPosition,
        ubsIsRead: userBookState.isRead,
        ubsRating: userBookState.rating,
        ubsReview: userBookState.review,
      })
      .from(books)
      .leftJoin(
        userBookState,
        and(eq(userBookState.bookId, books.id), eq(userBookState.profileId, profileId)),
      )
      .$dynamic();

    // Apply filters
    const conditions = [];

    if (format) {
      const fmts = Array.isArray(format) ? format : [format];
      conditions.push(inArray(books.format, fmts));
    }

    if (type) {
      const formats = getFormatsByType(type);
      conditions.push(
        sql`(
          (${books.format} IN (${sql.join(
            formats.map((f) => sql`${f}`),
            sql`, `,
          )}) AND ${books.bookTypeOverride} IS NULL)
          OR ${books.bookTypeOverride} = ${type}
        )`,
      );
    }

    if (search) {
      conditions.push(like(books.title, `%${search}%`));
    }

    if (series) {
      conditions.push(eq(books.series, series));
    }

    if (collectionId) {
      const bookIdsInCollection = db
        .select({ bookId: booksCollections.bookId })
        .from(booksCollections)
        .where(eq(booksCollections.collectionId, collectionId));
      conditions.push(inArray(books.id, bookIdsInCollection));
    }

    if (tagId) {
      const bookIdsWithTag = db
        .select({ bookId: booksTags.bookId })
        .from(booksTags)
        .where(eq(booksTags.tagId, tagId));
      conditions.push(inArray(books.id, bookIdsWithTag));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    // Apply ordering
    if (series) {
      query = query.orderBy(asc(sql`CAST(${books.seriesNumber} AS REAL)`), asc(books.title));
    } else {
      if (orderBy === "lastReadAt") {
        // Sort by userBookState.lastReadAt when profile is provided
        const orderFn = order === "asc" ? asc : desc;
        query = query.orderBy(orderFn(userBookState.lastReadAt));
      } else {
        const orderColumn =
          {
            title: books.title,
            createdAt: books.createdAt,
          }[orderBy] || books.createdAt;
        const orderFn = order === "asc" ? asc : desc;
        query = query.orderBy(orderFn(orderColumn));
      }
    }

    query = query.limit(limit).offset(offset);

    const rows = await query;

    // Overlay userBookState fields onto the book objects
    return rows.map((row) => ({
      ...row.book,
      readingProgress: row.ubsReadingProgress ?? row.book.readingProgress,
      lastReadAt: row.ubsLastReadAt ?? row.book.lastReadAt,
      lastPosition: row.ubsLastPosition ?? row.book.lastPosition,
      isRead: row.ubsIsRead ?? row.book.isRead,
      rating: row.ubsRating ?? row.book.rating,
      review: row.ubsReview ?? row.book.review,
    }));
  }

  // No profileId — legacy path, read from books table directly
  let query = db.select().from(books).$dynamic();

  // Apply filters
  const conditions = [];

  if (format) {
    const fmts = Array.isArray(format) ? format : [format];
    conditions.push(inArray(books.format, fmts));
  }

  if (type) {
    const formats = getFormatsByType(type);
    // Include books that either:
    // 1. Have the matching format AND no override, OR
    // 2. Have the bookTypeOverride set to this type
    conditions.push(
      sql`(
        (${books.format} IN (${sql.join(
          formats.map((f) => sql`${f}`),
          sql`, `,
        )}) AND ${books.bookTypeOverride} IS NULL)
        OR ${books.bookTypeOverride} = ${type}
      )`,
    );
  }

  if (search) {
    conditions.push(like(books.title, `%${search}%`));
  }

  if (series) {
    conditions.push(eq(books.series, series));
  }

  if (collectionId) {
    const bookIdsInCollection = db
      .select({ bookId: booksCollections.bookId })
      .from(booksCollections)
      .where(eq(booksCollections.collectionId, collectionId));
    conditions.push(inArray(books.id, bookIdsInCollection));
  }

  if (tagId) {
    const bookIdsWithTag = db
      .select({ bookId: booksTags.bookId })
      .from(booksTags)
      .where(eq(booksTags.tagId, tagId));
    conditions.push(inArray(books.id, bookIdsWithTag));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  // Apply ordering — when filtering by series, sort by series number first
  if (series) {
    query = query.orderBy(asc(sql`CAST(${books.seriesNumber} AS REAL)`), asc(books.title));
  } else {
    const orderColumn = {
      title: books.title,
      createdAt: books.createdAt,
      lastReadAt: books.lastReadAt,
    }[orderBy];

    const orderFn = order === "asc" ? asc : desc;
    query = query.orderBy(orderFn(orderColumn));
  }

  // Apply pagination
  query = query.limit(limit).offset(offset);

  return query;
}

export async function getBook(
  id: string,
  explicitProfileId?: string,
): Promise<BookWithState | null> {
  const profileId = explicitProfileId ?? resolveProfileId();
  if (profileId) {
    const row = await db
      .select({
        book: books,
        ubsReadingProgress: userBookState.readingProgress,
        ubsLastReadAt: userBookState.lastReadAt,
        ubsLastPosition: userBookState.lastPosition,
        ubsIsRead: userBookState.isRead,
        ubsRating: userBookState.rating,
        ubsReview: userBookState.review,
      })
      .from(books)
      .leftJoin(
        userBookState,
        and(eq(userBookState.bookId, books.id), eq(userBookState.profileId, profileId)),
      )
      .where(eq(books.id, id))
      .get();

    if (!row) return null;

    return {
      ...row.book,
      readingProgress: row.ubsReadingProgress ?? row.book.readingProgress,
      lastReadAt: row.ubsLastReadAt ?? row.book.lastReadAt,
      lastPosition: row.ubsLastPosition ?? row.book.lastPosition,
      isRead: row.ubsIsRead ?? row.book.isRead,
      rating: row.ubsRating ?? row.book.rating,
      review: row.ubsReview ?? row.book.review,
    };
  }

  const result = await db.select().from(books).where(eq(books.id, id)).get();
  return result || null;
}

export async function updateBook(
  id: string,
  data: Partial<{
    title: string;
    subtitle: string;
    authors: string;
    publisher: string;
    publishedDate: string;
    description: string;
    isbn: string;
    isbn13: string;
    isbn10: string;
    language: string;
    pageCount: number;
    series: string;
    seriesNumber: string;
    readingProgress: number;
    lastPosition: string;
    bookTypeOverride: string | null;
    isRead: boolean;
    rating: number | null;
    review: string | null;
  }>,
  source: "web" | "ios" | "api" | "metadata" = "web",
  explicitProfileId?: string,
): Promise<BookWithState | null> {
  const profileId = explicitProfileId ?? resolveProfileId();
  const book = await getBook(id);
  if (!book) return null;

  // Separate reading state fields from metadata fields
  const readingStateFields = [
    "readingProgress",
    "lastPosition",
    "isRead",
    "rating",
    "review",
  ] as const;
  const readingStateData: Record<string, unknown> = {};
  const metadataData: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if ((readingStateFields as readonly string[]).includes(key)) {
      readingStateData[key] = value;
    } else {
      metadataData[key] = value;
    }
  }

  // Record audit trail for metadata field changes
  const auditableFields = [
    "title",
    "subtitle",
    "authors",
    "publisher",
    "publishedDate",
    "description",
    "isbn",
    "isbn13",
    "isbn10",
    "language",
    "pageCount",
    "series",
    "seriesNumber",
    "bookTypeOverride",
  ] as const;

  const editGroupId = uuid();
  const auditEntries: NewBookEdit[] = [];

  for (const field of auditableFields) {
    if (field in metadataData) {
      const oldVal = book[field as keyof Book];
      const newVal = metadataData[field as keyof typeof metadataData];
      const oldStr = oldVal != null ? JSON.stringify(oldVal) : null;
      const newStr = newVal != null ? JSON.stringify(newVal) : null;
      if (oldStr !== newStr) {
        auditEntries.push({
          id: uuid(),
          bookId: id,
          editGroupId,
          field,
          oldValue: oldStr,
          newValue: newStr,
          source,
        });
      }
    }
  }

  if (auditEntries.length > 0) {
    await db.insert(bookEdits).values(auditEntries);
  }

  // Write reading state to userBookState when profileId is provided
  if (profileId && Object.keys(readingStateData).length > 0) {
    await upsertUserBookState(profileId, id, readingStateData);
  }

  // Update metadata fields on books table (if any metadata fields changed)
  if (
    Object.keys(metadataData).length > 0 ||
    (!profileId && Object.keys(readingStateData).length > 0)
  ) {
    const updateData: Record<string, unknown> = { ...metadataData };

    // When no profileId, also write reading state to books table (legacy compat)
    if (!profileId) {
      Object.assign(updateData, readingStateData);
      if ("readingProgress" in readingStateData || "lastPosition" in readingStateData) {
        updateData.lastReadAt = sql`(unixepoch())`;
      }
    }

    updateData.updatedAt = sql`(unixepoch())`;

    // If title or authors changed, update the filename
    if ("title" in metadataData || "authors" in metadataData) {
      const newTitle = (metadataData.title as string) || book.title;
      const newAuthors = metadataData.authors
        ? JSON.parse(metadataData.authors as string)
        : book.authors
          ? JSON.parse(book.authors)
          : [];
      updateData.fileName = generateFileName(newTitle, newAuthors, book.format);
    }

    await db.update(books).set(updateData).where(eq(books.id, id));
  }

  // Write metadata to the actual book file if title/authors changed (fire-and-forget)
  // This runs in the background so the response returns immediately.
  // Large audio files can take a long time to rewrite.
  if ("title" in metadataData || "authors" in metadataData) {
    const updatedBook = await getBook(id);
    if (updatedBook) {
      const format = updatedBook.format as BookFormat;
      const filePath = getBookFilePath(id, format);
      const authors = updatedBook.authors ? JSON.parse(updatedBook.authors) : [];

      (async () => {
        try {
          let coverImage: Buffer | null = null;
          if (updatedBook.coverPath) {
            try {
              const { readFile } = await import("fs/promises");
              coverImage = await readFile(resolveStoragePath(updatedBook.coverPath));
            } catch {
              // Cover file not found, proceed without embedding
            }
          }

          await writeMetadataToFile(filePath, format, {
            title: updatedBook.title,
            authors,
            publisher: updatedBook.publisher,
            description: updatedBook.description,
            isbn: updatedBook.isbn13 || updatedBook.isbn10 || updatedBook.isbn,
            language: updatedBook.language,
            series: updatedBook.series,
            seriesNumber: updatedBook.seriesNumber,
            publishedDate: updatedBook.publishedDate,
            coverImage,
            coverMimeType: "image/jpeg",
          });
        } catch (error) {
          console.error(`Error writing embedded metadata for book ${id}:`, error);
        }
      })();
    }
  }

  return getBook(id, profileId);
}

/**
 * Upsert a userBookState record for a given profile and book.
 * If a record exists, updates the provided fields. Otherwise, inserts a new record.
 */
async function upsertUserBookState(
  profileId: string,
  bookId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const existing = await db
    .select()
    .from(userBookState)
    .where(and(eq(userBookState.profileId, profileId), eq(userBookState.bookId, bookId)))
    .get();

  const updateFields: Record<string, unknown> = { ...data };
  if ("readingProgress" in data || "lastPosition" in data) {
    updateFields.lastReadAt = sql`(unixepoch())`;
  }
  updateFields.updatedAt = sql`(unixepoch())`;

  if (existing) {
    await db.update(userBookState).set(updateFields).where(eq(userBookState.id, existing.id));
  } else {
    await db.insert(userBookState).values({
      id: randomUUID(),
      profileId,
      bookId,
      ...updateFields,
    });
  }
}

export async function deleteBook(id: string): Promise<boolean> {
  const book = await getBook(id);
  if (!book) return false;

  // Delete files
  deleteBookFile(book.filePath);
  if (book.coverPath) {
    deleteCoverImage(book.coverPath);
  }

  // Delete from database (cascades to junctions)
  await db.delete(books).where(eq(books.id, id));

  return true;
}

/**
 * Delete an orphaned file from disk (file that has no database entry)
 * Used by admin data page to clean up files without matching records
 */
export async function deleteOrphanedFile(
  filePath: string,
): Promise<{ success: boolean; message: string }> {
  // Security: ensure the file is in the expected books directory
  const { BOOKS_DIR } = await import("../lib/storage");
  const { resolve } = await import("path");

  const normalizedPath = resolve(filePath);
  const normalizedBooksDir = resolve(BOOKS_DIR);

  if (!normalizedPath.startsWith(normalizedBooksDir)) {
    return { success: false, message: "Invalid file path - must be in books directory" };
  }

  const deleted = deleteBookFile(filePath);
  if (deleted) {
    return { success: true, message: "File deleted successfully" };
  }
  return { success: false, message: "Failed to delete file - file may not exist" };
}

/**
 * Delete a database record that has no corresponding file on disk
 * Used by admin data page to clean up orphaned database entries
 */
export async function deleteMissingFileRecord(
  bookId: string,
): Promise<{ success: boolean; message: string }> {
  const book = await getBook(bookId);
  if (!book) {
    return { success: false, message: "Book not found in database" };
  }

  // Delete from database (cascades to junctions)
  await db.delete(books).where(eq(books.id, bookId));

  // Also try to delete cover if it exists
  if (book.coverPath) {
    deleteCoverImage(book.coverPath);
  }

  return { success: true, message: "Database record deleted successfully" };
}

/**
 * Cancel or clear a background job.
 * - Pending jobs: removed from queue
 * - Running jobs: signalled to abort
 * - Completed/error jobs: cleared from history
 */
export async function cancelBackgroundJob(
  jobId: string,
): Promise<{ success: boolean; message: string }> {
  const { cancelJob } = await import("../lib/queue");
  return cancelJob(jobId);
}

export async function getRecentBooks(
  limit: number = 10,
  explicitProfileId?: string,
): Promise<BookWithState[]> {
  const profileId = explicitProfileId ?? resolveProfileId();
  if (profileId) {
    const rows = await db
      .select({
        book: books,
        ubsReadingProgress: userBookState.readingProgress,
        ubsLastReadAt: userBookState.lastReadAt,
        ubsLastPosition: userBookState.lastPosition,
        ubsIsRead: userBookState.isRead,
        ubsRating: userBookState.rating,
        ubsReview: userBookState.review,
      })
      .from(books)
      .innerJoin(
        userBookState,
        and(eq(userBookState.bookId, books.id), eq(userBookState.profileId, profileId)),
      )
      .where(sql`${userBookState.lastReadAt} IS NOT NULL`)
      .orderBy(desc(userBookState.lastReadAt))
      .limit(limit);

    return rows.map((row) => ({
      ...row.book,
      readingProgress: row.ubsReadingProgress ?? row.book.readingProgress,
      lastReadAt: row.ubsLastReadAt ?? row.book.lastReadAt,
      lastPosition: row.ubsLastPosition ?? row.book.lastPosition,
      isRead: row.ubsIsRead ?? row.book.isRead,
      rating: row.ubsRating ?? row.book.rating,
      review: row.ubsReview ?? row.book.review,
    }));
  }

  // Legacy path: read from books table directly
  return db
    .select()
    .from(books)
    .where(sql`${books.lastReadAt} IS NOT NULL`)
    .orderBy(desc(books.lastReadAt))
    .limit(limit);
}

export async function getBooksCount(
  type?: BookType,
  format?: string | string[],
  series?: string,
): Promise<number> {
  const conditions = [];

  if (type) {
    const formats = getFormatsByType(type);
    conditions.push(
      sql`(
        (${books.format} IN (${sql.join(
          formats.map((f) => sql`${f}`),
          sql`, `,
        )}) AND ${books.bookTypeOverride} IS NULL)
        OR ${books.bookTypeOverride} = ${type}
      )`,
    );
  }

  if (format) {
    const fmts = Array.isArray(format) ? format : [format];
    conditions.push(inArray(books.format, fmts));
  }

  if (series) {
    conditions.push(eq(books.series, series));
  }

  if (conditions.length > 0) {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(books)
      .where(and(...conditions))
      .get();
    return result?.count || 0;
  }

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(books)
    .get();
  return result?.count || 0;
}

/**
 * Get counts of books grouped by format, optionally filtered by type
 */
export async function getFormatCounts(
  type?: BookType,
): Promise<{ format: string; count: number }[]> {
  let query = db
    .select({
      format: books.format,
      count: sql<number>`count(*)`,
    })
    .from(books)
    .$dynamic();

  if (type) {
    const formats = getFormatsByType(type);
    query = query.where(
      sql`(
        (${books.format} IN (${sql.join(
          formats.map((f) => sql`${f}`),
          sql`, `,
        )}) AND ${books.bookTypeOverride} IS NULL)
        OR ${books.bookTypeOverride} = ${type}
      )`,
    );
  }

  const results = await query.groupBy(books.format);
  return results.map((r) => ({ format: r.format, count: r.count }));
}

/**
 * Get books that need metadata matching (no cover and not skipped)
 */
export async function getUnmatchedBooks(limit: number = 50): Promise<Book[]> {
  return db
    .select()
    .from(books)
    .where(
      sql`(${books.coverPath} IS NULL OR (${books.isbn} IS NULL AND ${books.isbn13} IS NULL AND ${books.isbn10} IS NULL)) AND (${books.matchSkipped} IS NULL OR ${books.matchSkipped} = 0)`,
    )
    .orderBy(desc(books.createdAt))
    .limit(limit);
}

/**
 * Get count of books that need metadata matching
 */
export async function getUnmatchedBooksCount(): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(books)
    .where(
      sql`(${books.coverPath} IS NULL OR (${books.isbn} IS NULL AND ${books.isbn13} IS NULL AND ${books.isbn10} IS NULL)) AND (${books.matchSkipped} IS NULL OR ${books.matchSkipped} = 0)`,
    )
    .get();
  return result?.count || 0;
}

/**
 * Skip metadata matching for a book
 */
export async function skipBookMatch(bookId: string): Promise<boolean> {
  await db
    .update(books)
    .set({ matchSkipped: true, updatedAt: sql`(unixepoch())` })
    .where(eq(books.id, bookId));
  return true;
}

/**
 * Get all books by a specific author
 * Searches for exact author name within the JSON array
 */
export async function getBooksByAuthor(authorName: string): Promise<Book[]> {
  // Escape special characters for LIKE pattern and JSON string matching
  const escapedName = authorName.replace(/["\\%_]/g, (char) => "\\" + char);
  return db
    .select()
    .from(books)
    .where(like(books.authors, `%"${escapedName}"%`))
    .orderBy(asc(books.title));
}

/**
 * Get books with the same ISBN but different format (linked formats)
 * Returns other formats of the same book (e.g., audiobook version of an ebook)
 */
export async function getLinkedFormats(bookId: string): Promise<Book[]> {
  const book = await getBook(bookId);
  if (!book) return [];

  // Get all ISBNs for this book
  const isbns = [book.isbn, book.isbn13, book.isbn10].filter(Boolean) as string[];
  if (isbns.length === 0) return [];

  // Find books with matching ISBN but different ID
  const linkedBooks = await db
    .select()
    .from(books)
    .where(
      and(
        sql`${books.id} != ${bookId}`,
        sql`(${books.isbn} IN (${sql.join(
          isbns.map((i) => sql`${i}`),
          sql`, `,
        )}) OR ${books.isbn13} IN (${sql.join(
          isbns.map((i) => sql`${i}`),
          sql`, `,
        )}) OR ${books.isbn10} IN (${sql.join(
          isbns.map((i) => sql`${i}`),
          sql`, `,
        )}))`,
      ),
    );

  return linkedBooks;
}

/**
 * Get related books based on series, shared tags, and same author.
 * Returns up to `limit` books, prioritizing: series > tags > author.
 */
export async function getRelatedBooks(book: Book, limit = 10): Promise<Book[]> {
  const seen = new Set<string>([book.id]);
  const related: Book[] = [];

  // 1. Same series (highest priority)
  if (book.series) {
    const seriesBooks = await db
      .select()
      .from(books)
      .where(and(eq(books.series, book.series), sql`${books.id} != ${book.id}`))
      .orderBy(asc(books.seriesNumber));

    for (const b of seriesBooks) {
      if (!seen.has(b.id)) {
        seen.add(b.id);
        related.push(b);
      }
    }
  }

  // 2. Shared tags
  if (related.length < limit) {
    const bookTagIds = await db
      .select({ tagId: booksTags.tagId })
      .from(booksTags)
      .where(eq(booksTags.bookId, book.id));

    if (bookTagIds.length > 0) {
      const tagIdList = bookTagIds.map((t) => t.tagId);
      // Find books sharing these tags, ranked by overlap count
      const tagMatches = await db
        .select({
          bookId: booksTags.bookId,
          overlapCount: sql<number>`count(*)`,
        })
        .from(booksTags)
        .where(and(inArray(booksTags.tagId, tagIdList), sql`${booksTags.bookId} != ${book.id}`))
        .groupBy(booksTags.bookId)
        .orderBy(desc(sql`count(*)`))
        .limit(limit);

      if (tagMatches.length > 0) {
        const matchedIds = tagMatches.map((m) => m.bookId).filter((id) => !seen.has(id));

        if (matchedIds.length > 0) {
          const tagBooks = await db.select().from(books).where(inArray(books.id, matchedIds));

          // Preserve overlap-count ordering
          const bookMap = new Map(tagBooks.map((b) => [b.id, b]));
          for (const id of matchedIds) {
            const b = bookMap.get(id);
            if (b && !seen.has(b.id)) {
              seen.add(b.id);
              related.push(b);
            }
          }
        }
      }
    }
  }

  // 3. Same author (lowest priority) — single query for all authors
  if (related.length < limit && book.authors) {
    try {
      const authors: string[] = JSON.parse(book.authors);
      const authorsToSearch = authors.slice(0, 2);
      if (authorsToSearch.length > 0) {
        const conditions = authorsToSearch.map((author) => {
          const escaped = author.replace(/["\\%_]/g, (char) => "\\" + char);
          return like(books.authors, `%"${escaped}"%`);
        });

        const authorBooks = await db
          .select()
          .from(books)
          .where(and(or(...conditions), sql`${books.id} != ${book.id}`))
          .orderBy(asc(books.title))
          .limit(limit);

        for (const b of authorBooks) {
          if (!seen.has(b.id)) {
            seen.add(b.id);
            related.push(b);
            if (related.length >= limit) break;
          }
        }
      }
    } catch {
      // authors field not valid JSON
    }
  }

  return related.slice(0, limit);
}

/**
 * Search for metadata matches from external sources (Google Books, Open Library)
 */
export async function searchMetadata(
  title: string,
  author?: string,
  _format?: BookFormat,
): Promise<MetadataSearchResult[]> {
  return searchAllSources(title, author);
}

/**
 * Refresh book metadata from external sources (Google Books + Open Library)
 */
export async function refreshMetadata(
  bookId: string,
): Promise<{ success: boolean; message: string; book?: Book }> {
  const book = await getBook(bookId);
  if (!book) {
    return { success: false, message: "Book not found" };
  }

  // Get current metadata
  const currentMetadata = {
    title: book.title,
    authors: book.authors ? JSON.parse(book.authors) : [],
    publisher: book.publisher,
    description: book.description,
    pageCount: book.pageCount,
    language: book.language,
    publishedDate: book.publishedDate,
    isbn: book.isbn,
  };

  // Find best metadata match from multiple sources
  const newMetadata = await findBestMetadata(currentMetadata);

  if (!newMetadata) {
    return {
      success: false,
      message: "No matching metadata found. Try searching manually.",
    };
  }

  // Prepare update data - only update fields that are empty
  const updateData: Record<string, unknown> = {};

  if (newMetadata.title && !book.title) {
    updateData.title = newMetadata.title;
  }
  if (newMetadata.subtitle && !book.subtitle) {
    updateData.subtitle = newMetadata.subtitle;
  }
  if (newMetadata.authors.length > 0 && !book.authors) {
    updateData.authors = JSON.stringify(newMetadata.authors);
  }
  if (newMetadata.publisher && !book.publisher) {
    updateData.publisher = newMetadata.publisher;
  }
  if (newMetadata.description && !book.description) {
    updateData.description = newMetadata.description;
  }
  if (newMetadata.pageCount && !book.pageCount) {
    updateData.pageCount = newMetadata.pageCount;
  }
  if (newMetadata.language && !book.language) {
    updateData.language = newMetadata.language;
  }
  if (newMetadata.publishedDate && !book.publishedDate) {
    updateData.publishedDate = newMetadata.publishedDate;
  }
  if (newMetadata.isbn && !book.isbn) {
    updateData.isbn = newMetadata.isbn;
  }
  if (newMetadata.isbn13 && !book.isbn13) {
    updateData.isbn13 = newMetadata.isbn13;
  }
  if (newMetadata.isbn10 && !book.isbn10) {
    updateData.isbn10 = newMetadata.isbn10;
  }

  // Download and save cover if available and book doesn't have one
  // Try multiple URLs until one provides a valid cover image
  const coverUrls = newMetadata.coverUrls || [];
  if (coverUrls.length > 0 && !book.coverPath) {
    for (const coverUrl of coverUrls) {
      try {
        const coverResponse = await fetch(coverUrl);
        if (coverResponse.ok) {
          const coverBuffer = Buffer.from(await coverResponse.arrayBuffer());
          // Process with sharp for optimization (validates dimensions)
          const result = await processAndStoreCover(coverBuffer, bookId);
          if (result.path) {
            updateData.coverPath = result.path;
            if (result.dominantColor) {
              updateData.coverColor = result.dominantColor;
            }
            break; // Successfully saved, stop trying more URLs
          }
          // Cover was rejected (placeholder), try next URL
        }
      } catch (error) {
        console.error("Failed to download cover from", coverUrl, error);
      }
    }
  }

  // Auto-create tags from subjects
  if (newMetadata.subjects.length > 0) {
    await createTagsFromSubjects(bookId, newMetadata.subjects);
  }

  // Update the book if we have new data
  if (Object.keys(updateData).length > 0) {
    updateData.updatedAt = sql`(unixepoch())`;
    await db.update(books).set(updateData).where(eq(books.id, bookId));

    const updatedBook = await getBook(bookId);
    if (updatedBook) {
      // Write metadata to the actual book file in the background (fire-and-forget).
      // Large audio files can take a long time to rewrite.
      const format = updatedBook.format as BookFormat;
      const filePath = getBookFilePath(bookId, format);
      const authors = updatedBook.authors ? JSON.parse(updatedBook.authors) : [];

      (async () => {
        try {
          let coverImage: Buffer | null = null;
          if (updatedBook.coverPath) {
            try {
              const { readFile } = await import("fs/promises");
              coverImage = await readFile(resolveStoragePath(updatedBook.coverPath));
            } catch {
              // Cover file not found, proceed without embedding
            }
          }

          await writeMetadataToFile(filePath, format, {
            title: updatedBook.title,
            authors,
            publisher: updatedBook.publisher,
            description: updatedBook.description,
            isbn: updatedBook.isbn13 || updatedBook.isbn10 || updatedBook.isbn,
            language: updatedBook.language,
            series: updatedBook.series,
            seriesNumber: updatedBook.seriesNumber,
            publishedDate: updatedBook.publishedDate,
            coverImage,
            coverMimeType: "image/jpeg",
          });
        } catch (error) {
          console.error(`Error writing embedded metadata for book ${bookId}:`, error);
        }
      })();

      return {
        success: true,
        message: `Updated ${Object.keys(updateData).length - 1} field(s) from external sources`,
        book: updatedBook,
      };
    }
  }

  return {
    success: true,
    message: "Book metadata is already complete",
    book,
  };
}

/**
 * Create tags from subject strings and associate them with a book
 */
async function createTagsFromSubjects(bookId: string, subjects: string[]): Promise<void> {
  // Limit to first 10 subjects and normalize them
  const normalizedSubjects = subjects
    .slice(0, 10)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 50); // Skip very long subjects

  for (const subject of normalizedSubjects) {
    try {
      // Check if tag exists
      let tag = await db.select().from(tags).where(eq(tags.name, subject)).get();

      // Create tag if it doesn't exist
      if (!tag) {
        const tagId = uuid();
        await db.insert(tags).values({
          id: tagId,
          profileId: "default",
          name: subject,
        });
        tag = {
          id: tagId,
          profileId: "default",
          name: subject,
          color: null,
          createdAt: new Date(),
        };
      }

      // Check if book already has this tag
      const existing = await db
        .select()
        .from(booksTags)
        .where(and(eq(booksTags.bookId, bookId), eq(booksTags.tagId, tag!.id)))
        .get();

      // Add tag to book if not already associated
      if (!existing) {
        await db.insert(booksTags).values({
          bookId,
          tagId: tag!.id,
        });
      }
    } catch (error) {
      // Skip this subject if there's an error (e.g., duplicate)
      console.error(`Failed to create tag for subject "${subject}":`, error);
    }
  }
}

/**
 * Apply specific metadata from search results to a book
 * Will also lookup additional metadata from other sources to fill in gaps
 */
export async function applyMetadata(
  bookId: string,
  metadata: MetadataSearchResult,
  options?: { skipCover?: boolean },
): Promise<{ success: boolean; message: string; book?: Book }> {
  const book = await getBook(bookId);
  if (!book) {
    return { success: false, message: "Book not found" };
  }

  // If the selected metadata is missing ISBN, try to look it up from other sources
  let enrichedMetadata = metadata;
  if (!metadata.isbn13 && !metadata.isbn10) {
    // Try to find ISBN using the title/author from the selected result
    const { searchGoogleBooks, searchBookMetadata } = await import("../lib/metadata");

    // Search the other source for additional metadata
    if (metadata.source === "openlibrary") {
      // Selected Open Library, try Google Books for ISBN
      const googleResults = await searchGoogleBooks(
        metadata.authors.length > 0 ? `${metadata.title} ${metadata.authors[0]}` : metadata.title,
      );
      if (googleResults.length > 0 && (googleResults[0].isbn13 || googleResults[0].isbn10)) {
        enrichedMetadata = {
          ...metadata,
          isbn: metadata.isbn || googleResults[0].isbn,
          isbn13: metadata.isbn13 || googleResults[0].isbn13,
          isbn10: metadata.isbn10 || googleResults[0].isbn10,
        };
      }
    } else {
      // Selected Google Books, try Open Library for ISBN
      const olResults = await searchBookMetadata(metadata.title, metadata.authors[0]);
      if (olResults.length > 0 && (olResults[0].isbn13 || olResults[0].isbn10)) {
        enrichedMetadata = {
          ...metadata,
          isbn: metadata.isbn || olResults[0].isbn,
          isbn13: metadata.isbn13 || olResults[0].isbn13,
          isbn10: metadata.isbn10 || olResults[0].isbn10,
          // Also grab other fields if missing
          description: metadata.description || olResults[0].description,
        };
      }
    }
  }

  // If we now have an ISBN but are missing other data, do a direct ISBN lookup
  const isbnToLookup = enrichedMetadata.isbn13 || enrichedMetadata.isbn10 || enrichedMetadata.isbn;
  if (isbnToLookup && !enrichedMetadata.description) {
    const { lookupByISBN, lookupGoogleBooksByISBN } = await import("../lib/metadata");

    // Try both sources for the most complete data
    const [olData, googleData] = await Promise.all([
      lookupByISBN(isbnToLookup),
      lookupGoogleBooksByISBN(isbnToLookup),
    ]);

    if (olData || googleData) {
      enrichedMetadata = {
        ...enrichedMetadata,
        description:
          enrichedMetadata.description || olData?.description || googleData?.description || null,
        series: enrichedMetadata.series || null,
        seriesNumber: enrichedMetadata.seriesNumber || null,
        publisher: enrichedMetadata.publisher || olData?.publisher || googleData?.publisher || null,
        pageCount: enrichedMetadata.pageCount || olData?.pageCount || googleData?.pageCount || null,
        language: enrichedMetadata.language || olData?.language || googleData?.language || null,
        subjects:
          enrichedMetadata.subjects.length > 0
            ? enrichedMetadata.subjects
            : olData?.subjects || googleData?.subjects || [],
      };
    }
  }

  // Generate new filename based on metadata
  const newTitle = enrichedMetadata.title || book.title;
  const newAuthors =
    enrichedMetadata.authors.length > 0
      ? enrichedMetadata.authors
      : book.authors
        ? JSON.parse(book.authors)
        : [];
  const newFileName = generateFileName(newTitle, newAuthors, book.format);

  const updateData: Record<string, unknown> = {
    title: newTitle,
    subtitle: enrichedMetadata.subtitle || book.subtitle,
    authors:
      enrichedMetadata.authors.length > 0 ? JSON.stringify(enrichedMetadata.authors) : book.authors,
    publisher: enrichedMetadata.publisher || book.publisher,
    description: enrichedMetadata.description || book.description,
    pageCount: enrichedMetadata.pageCount || book.pageCount,
    language: enrichedMetadata.language || book.language,
    publishedDate: enrichedMetadata.publishedDate || book.publishedDate,
    isbn: enrichedMetadata.isbn || book.isbn,
    isbn13: enrichedMetadata.isbn13 || book.isbn13,
    isbn10: enrichedMetadata.isbn10 || book.isbn10,
    fileName: newFileName,
    series: book.series,
    seriesNumber: book.seriesNumber,
    updatedAt: sql`(unixepoch())`,
  };

  // Download and save cover - try multiple URLs until one works
  if (!options?.skipCover) {
    const coverUrls = metadata.coverUrls || [];

    for (const coverUrl of coverUrls) {
      try {
        const coverResponse = await fetch(coverUrl);

        if (coverResponse.ok) {
          const coverBuffer = Buffer.from(await coverResponse.arrayBuffer());

          // Process with sharp for optimization (validates dimensions)
          const result = await processAndStoreCover(coverBuffer, bookId);
          if (result.path) {
            updateData.coverPath = result.path;
            if (result.dominantColor) {
              updateData.coverColor = result.dominantColor;
            }
            break; // Successfully saved, stop trying more URLs
          }
          // If result.path is null, the cover was rejected (placeholder), try next URL
        }
      } catch {
        // Failed to download cover, try next URL
      }
    }
  }

  await db.update(books).set(updateData).where(eq(books.id, bookId));

  // Write metadata to the actual book file in the background (fire-and-forget).
  // Large audio files can take a long time to rewrite with ffmpeg/node-id3.
  {
    const format = book.format as BookFormat;
    const filePath = getBookFilePath(bookId, format);
    const coverPath = updateData.coverPath as string | undefined;
    const skipCover = options?.skipCover;

    (async () => {
      try {
        let coverImage: Buffer | null = null;
        if (coverPath && !skipCover) {
          try {
            const { readFile } = await import("fs/promises");
            coverImage = await readFile(resolveStoragePath(coverPath));
          } catch {
            // Cover file not found, proceed without embedding
          }
        }

        const writeResult = await writeMetadataToFile(filePath, format, {
          title: newTitle,
          authors: newAuthors,
          publisher: enrichedMetadata.publisher,
          description: enrichedMetadata.description,
          isbn: enrichedMetadata.isbn13 || enrichedMetadata.isbn10 || enrichedMetadata.isbn,
          language: enrichedMetadata.language,
          series: book.series,
          seriesNumber: book.seriesNumber,
          publishedDate: enrichedMetadata.publishedDate,
          coverImage,
          coverMimeType: "image/jpeg",
        });

        if (
          !writeResult.success &&
          writeResult.error &&
          !writeResult.error.includes("does not support")
        ) {
          console.warn(`Failed to update embedded metadata for book ${bookId}:`, writeResult.error);
        }
      } catch (error) {
        console.error(`Error writing embedded metadata for book ${bookId}:`, error);
      }
    })();
  }

  // Auto-create tags from subjects
  if (metadata.subjects.length > 0) {
    await createTagsFromSubjects(bookId, metadata.subjects);
  }

  const updatedBook = await getBook(bookId);

  return {
    success: true,
    message: "Metadata updated successfully",
    book: updatedBook || undefined,
  };
}

/**
 * Re-extract cover from the book file itself (EPUB, PDF, etc.)
 * Useful for books that were uploaded before cover extraction was working
 */
export async function extractCoverFromBook(
  bookId: string,
): Promise<{ success: boolean; message: string; book?: Book }> {
  const book = await getBook(bookId);
  if (!book) {
    return { success: false, message: "Book not found" };
  }

  // Already has a cover
  if (book.coverPath) {
    return { success: false, message: "Book already has a cover" };
  }

  try {
    const { readFile } = await import("fs/promises");
    const { getBookFilePath } = await import("../lib/storage");
    const { extractCover } = await import("../lib/processing/cover");
    const { storeCoverImage } = await import("../lib/storage");

    // Read the book file
    const format = book.format as BookFormat;
    const filePath = getBookFilePath(bookId, format);
    const buffer = await readFile(filePath);

    // Extract cover from the file
    const coverResult = await extractCover(buffer, format);

    if (!coverResult) {
      return { success: false, message: "No cover found in book file" };
    }

    // Store the cover
    const coverPath = storeCoverImage(coverResult.buffer, bookId);

    // Update the book record
    await db
      .update(books)
      .set({
        coverPath,
        coverColor: coverResult.dominantColor,
        updatedAt: sql`(unixepoch())`,
      })
      .where(eq(books.id, bookId));

    const updatedBook = await getBook(bookId);
    return {
      success: true,
      message: "Cover extracted from book file",
      book: updatedBook || undefined,
    };
  } catch (error) {
    console.error("Failed to extract cover:", error);
    return { success: false, message: "Failed to extract cover from book file" };
  }
}

export async function toggleBookReadStatus(
  bookId: string,
  isRead: boolean,
  explicitProfileId?: string,
): Promise<{ isRead: boolean } | null> {
  const profileId = explicitProfileId ?? resolveProfileId();
  const book = await getBook(bookId);
  if (!book) return null;

  if (profileId) {
    await upsertUserBookState(profileId, bookId, { isRead });
  } else {
    // Legacy path: write directly to books table
    await db
      .update(books)
      .set({
        isRead,
        updatedAt: sql`(unixepoch())`,
      })
      .where(eq(books.id, bookId));
  }

  return { isRead };
}

export async function rateBook(
  bookId: string,
  rating: number | null,
  review?: string | null,
  explicitProfileId?: string,
): Promise<{ rating: number | null; review: string | null } | null> {
  const profileId = explicitProfileId ?? resolveProfileId();
  const book = await getBook(bookId);
  if (!book) return null;

  if (profileId) {
    const stateData: Record<string, unknown> = { rating };
    if (review !== undefined) {
      stateData.review = review;
    }
    await upsertUserBookState(profileId, bookId, stateData);
  } else {
    // Legacy path: write directly to books table
    const updateData: Record<string, unknown> = {
      rating,
      updatedAt: sql`(unixepoch())`,
    };
    if (review !== undefined) {
      updateData.review = review;
    }

    await db.update(books).set(updateData).where(eq(books.id, bookId));
  }

  return { rating, review: review !== undefined ? (review ?? null) : (book.review ?? null) };
}
