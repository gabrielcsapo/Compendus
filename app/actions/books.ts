"use server";

import { db, books, booksTags, booksCollections, tags } from "../lib/db";
import { eq, desc, asc, like, inArray, sql, and } from "drizzle-orm";
import { deleteBookFile, deleteCoverImage, getBookFilePath } from "../lib/storage";
import { removeBookIndex, indexBookMetadata } from "../lib/search/indexer";
import { findBestMetadata, searchAllSources, type MetadataSearchResult } from "../lib/metadata";
import { processAndStoreCover } from "../lib/processing/cover";
import { writeMetadataToFile } from "../lib/processing/metadata-writer";
import type { Book } from "../lib/db/schema";
import type { BookFormat } from "../lib/types";
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

      // Write metadata to the actual book file if title/authors changed
      if ("title" in data || "authors" in data) {
        try {
          const format = updatedBook.format as BookFormat;
          const filePath = getBookFilePath(id, format);
          const authors = updatedBook.authors ? JSON.parse(updatedBook.authors) : [];

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
          });
        } catch (error) {
          // Don't fail the operation if file metadata update fails
          console.error(`Error writing embedded metadata for book ${id}:`, error);
        }
      }
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
 * Will also lookup additional metadata from other sources to fill in gaps
 */
export async function applyMetadata(
  bookId: string,
  metadata: MetadataSearchResult,
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
          series: metadata.series || olResults[0].series,
          seriesNumber: metadata.seriesNumber || olResults[0].seriesNumber,
        };
      }
    }
  }

  // If we now have an ISBN but are missing other data, do a direct ISBN lookup
  const isbnToLookup = enrichedMetadata.isbn13 || enrichedMetadata.isbn10 || enrichedMetadata.isbn;
  if (isbnToLookup && (!enrichedMetadata.description || !enrichedMetadata.series)) {
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
        series: enrichedMetadata.series || olData?.series || googleData?.series || null,
        seriesNumber:
          enrichedMetadata.seriesNumber || olData?.seriesNumber || googleData?.seriesNumber || null,
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
    series: enrichedMetadata.series || book.series,
    seriesNumber: enrichedMetadata.seriesNumber || book.seriesNumber,
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

  // Write metadata to the actual book file (EPUB, PDF)
  // This makes the file the source of truth for backups/migrations
  try {
    const format = book.format as BookFormat;
    const filePath = getBookFilePath(bookId, format);

    const writeResult = await writeMetadataToFile(filePath, format, {
      title: newTitle,
      authors: newAuthors,
      publisher: enrichedMetadata.publisher,
      description: enrichedMetadata.description,
      isbn: enrichedMetadata.isbn13 || enrichedMetadata.isbn10 || enrichedMetadata.isbn,
      language: enrichedMetadata.language,
      series: enrichedMetadata.series,
      seriesNumber: enrichedMetadata.seriesNumber,
      publishedDate: enrichedMetadata.publishedDate,
    });

    if (
      !writeResult.success &&
      writeResult.error &&
      !writeResult.error.includes("does not support")
    ) {
      console.warn(`Failed to update embedded metadata for book ${bookId}:`, writeResult.error);
    }
  } catch (error) {
    // Don't fail the operation if file metadata update fails
    console.error(`Error writing embedded metadata for book ${bookId}:`, error);
  }

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
