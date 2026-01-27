"use server";

import { db, books, booksTags, booksCollections, tags } from "../lib/db";
import { eq, desc, asc, like, inArray, sql, and } from "drizzle-orm";
import { deleteBookFile, deleteCoverImage } from "../lib/storage";
import { removeBookIndex, indexBookMetadata } from "../lib/search/indexer";
import { findBestMetadata, searchAllSources, type MetadataSearchResult } from "../lib/metadata";
import { processAndStoreCover } from "../lib/processing/cover";
import type { Book } from "../lib/db/schema";
import { v4 as uuid } from "uuid";

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

export interface GetBooksOptions {
  limit?: number;
  offset?: number;
  orderBy?: "title" | "createdAt" | "lastReadAt";
  order?: "asc" | "desc";
  format?: "pdf" | "epub" | "mobi";
  collectionId?: string;
  tagId?: string;
  search?: string;
}

export async function getBooks(options: GetBooksOptions = {}): Promise<Book[]> {
  const {
    limit = 50,
    offset = 0,
    orderBy = "createdAt",
    order = "desc",
    format,
    collectionId,
    tagId,
    search,
  } = options;

  let query = db.select().from(books).$dynamic();

  // Apply filters
  const conditions = [];

  if (format) {
    conditions.push(eq(books.format, format));
  }

  if (search) {
    conditions.push(like(books.title, `%${search}%`));
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
    for (const condition of conditions) {
      query = query.where(condition);
    }
  }

  // Apply ordering
  const orderColumn = {
    title: books.title,
    createdAt: books.createdAt,
    lastReadAt: books.lastReadAt,
  }[orderBy];

  const orderFn = order === "asc" ? asc : desc;
  query = query.orderBy(orderFn(orderColumn));

  // Apply pagination
  query = query.limit(limit).offset(offset);

  return query;
}

export async function getBook(id: string): Promise<Book | null> {
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
  }>,
): Promise<Book | null> {
  const book = await getBook(id);
  if (!book) return null;

  const updateData: Record<string, unknown> = { ...data };
  updateData.updatedAt = sql`(unixepoch())`;

  if ("readingProgress" in data || "lastPosition" in data) {
    updateData.lastReadAt = sql`(unixepoch())`;
  }

  // If title or authors changed, update the filename
  if ("title" in data || "authors" in data) {
    const newTitle = data.title || book.title;
    const newAuthors = data.authors
      ? JSON.parse(data.authors)
      : book.authors
        ? JSON.parse(book.authors)
        : [];
    updateData.fileName = generateFileName(newTitle, newAuthors, book.format);
  }

  await db.update(books).set(updateData).where(eq(books.id, id));

  // Re-index for search if metadata changed
  if ("title" in data || "authors" in data || "description" in data) {
    const updatedBook = await getBook(id);
    if (updatedBook) {
      await removeBookIndex(id);
      await indexBookMetadata(
        updatedBook.id,
        updatedBook.title,
        updatedBook.authors || "",
        updatedBook.description,
      );
    }
  }

  return getBook(id);
}

export async function deleteBook(id: string): Promise<boolean> {
  const book = await getBook(id);
  if (!book) return false;

  // Delete files
  deleteBookFile(book.filePath);
  if (book.coverPath) {
    deleteCoverImage(book.coverPath);
  }

  // Delete from search index
  await removeBookIndex(id);

  // Delete from database (cascades to junctions)
  await db.delete(books).where(eq(books.id, id));

  return true;
}

export async function getRecentBooks(limit: number = 10): Promise<Book[]> {
  return db
    .select()
    .from(books)
    .where(sql`${books.lastReadAt} IS NOT NULL`)
    .orderBy(desc(books.lastReadAt))
    .limit(limit);
}

export async function getBooksCount(): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(books)
    .get();
  return result?.count || 0;
}

/**
 * Get books that need metadata matching (no cover and not skipped)
 */
export async function getUnmatchedBooks(limit: number = 50): Promise<Book[]> {
  return db
    .select()
    .from(books)
    .where(
      sql`${books.coverPath} IS NULL AND (${books.matchSkipped} IS NULL OR ${books.matchSkipped} = 0)`,
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
      sql`${books.coverPath} IS NULL AND (${books.matchSkipped} IS NULL OR ${books.matchSkipped} = 0)`,
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

export async function getBooksByFormat(): Promise<Array<{ format: string; count: number }>> {
  return db
    .select({
      format: books.format,
      count: sql<number>`count(*)`,
    })
    .from(books)
    .groupBy(books.format);
}

/**
 * Search for metadata matches from external sources (Google Books + Open Library)
 */
export async function searchMetadata(
  title: string,
  author?: string,
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
  if (newMetadata.series && !book.series) {
    updateData.series = newMetadata.series;
  }
  if (newMetadata.seriesNumber && !book.seriesNumber) {
    updateData.seriesNumber = newMetadata.seriesNumber;
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

    // Re-index for search (remove old entry, add new one)
    const updatedBook = await getBook(bookId);
    if (updatedBook) {
      await removeBookIndex(bookId);
      await indexBookMetadata(
        updatedBook.id,
        updatedBook.title,
        updatedBook.authors || "",
        updatedBook.description,
      );
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
          name: subject,
        });
        tag = { id: tagId, name: subject, color: null, createdAt: new Date() };
      }

      // Check if book already has this tag
      const existing = await db
        .select()
        .from(booksTags)
        .where(and(eq(booksTags.bookId, bookId), eq(booksTags.tagId, tag.id)))
        .get();

      // Add tag to book if not already associated
      if (!existing) {
        await db.insert(booksTags).values({
          bookId,
          tagId: tag.id,
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
 */
export async function applyMetadata(
  bookId: string,
  metadata: MetadataSearchResult,
): Promise<{ success: boolean; message: string; book?: Book }> {
  const book = await getBook(bookId);
  if (!book) {
    return { success: false, message: "Book not found" };
  }

  // Generate new filename based on metadata
  const newTitle = metadata.title || book.title;
  const newAuthors =
    metadata.authors.length > 0 ? metadata.authors : book.authors ? JSON.parse(book.authors) : [];
  const newFileName = generateFileName(newTitle, newAuthors, book.format);

  const updateData: Record<string, unknown> = {
    title: newTitle,
    subtitle: metadata.subtitle || book.subtitle,
    authors: metadata.authors.length > 0 ? JSON.stringify(metadata.authors) : book.authors,
    publisher: metadata.publisher || book.publisher,
    description: metadata.description || book.description,
    pageCount: metadata.pageCount || book.pageCount,
    language: metadata.language || book.language,
    publishedDate: metadata.publishedDate || book.publishedDate,
    isbn: metadata.isbn || book.isbn,
    isbn13: metadata.isbn13 || book.isbn13,
    isbn10: metadata.isbn10 || book.isbn10,
    fileName: newFileName,
    series: metadata.series || book.series,
    seriesNumber: metadata.seriesNumber || book.seriesNumber,
    updatedAt: sql`(unixepoch())`,
  };

  // Download and save cover - try multiple URLs until one works
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

  await db.update(books).set(updateData).where(eq(books.id, bookId));

  // Auto-create tags from subjects
  if (metadata.subjects.length > 0) {
    await createTagsFromSubjects(bookId, metadata.subjects);
  }

  // Re-index for search (remove old entry, add new one)
  const updatedBook = await getBook(bookId);
  if (updatedBook) {
    await removeBookIndex(bookId);
    await indexBookMetadata(
      updatedBook.id,
      updatedBook.title,
      updatedBook.authors || "",
      updatedBook.description,
    );
  }

  return {
    success: true,
    message: "Metadata updated successfully",
    book: updatedBook || undefined,
  };
}
