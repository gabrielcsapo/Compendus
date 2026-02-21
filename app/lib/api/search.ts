import { db, books } from "../db";
import { eq, or, inArray, sql, asc, desc } from "drizzle-orm";
import { searchBooks as searchBooksLib } from "../search";
import type { Book } from "../db/schema";

/**
 * Public API response format for a book
 * Excludes internal fields like file paths
 */
interface ApiBook {
  id: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  publisher: string | null;
  publishedDate: string | null;
  description: string | null;
  isbn: string | null;
  isbn13: string | null;
  isbn10: string | null;
  language: string | null;
  pageCount: number | null;
  series: string | null;
  seriesNumber: string | null;
  format: string;
  coverUrl: string | null;
  addedAt: string;
  fileSize: number;
  // Audiobook-specific fields
  duration: number | null;
  narrator: string | null;
  chapters: ApiChapter[] | null;
}

interface ApiChapter {
  title: string;
  startTime: number;
  endTime: number | null;
}

interface ApiSearchResult {
  book: ApiBook;
  relevance: number;
  highlights: {
    title?: string;
    authors?: string;
    description?: string;
    content?: string;
    chapterTitle?: string;
  };
}

interface ApiSearchResponse {
  success: true;
  query: string;
  total: number;
  totalCount?: number;  // Total items in database (for pagination)
  limit: number;
  offset: number;
  results: ApiSearchResult[];
}

interface ApiBookResponse {
  success: true;
  book: ApiBook;
}

interface ApiErrorResponse {
  success: false;
  error: string;
  code: string;
}

/**
 * Transform internal Book to public API format
 */
function toApiBook(book: Book, baseUrl: string): ApiBook {
  // Parse chapters JSON if present
  let chapters: ApiChapter[] | null = null;
  if (book.chapters) {
    try {
      chapters = JSON.parse(book.chapters);
    } catch {
      chapters = null;
    }
  }

  return {
    id: book.id,
    title: book.title,
    subtitle: book.subtitle,
    authors: book.authors ? JSON.parse(book.authors) : [],
    publisher: book.publisher,
    publishedDate: book.publishedDate,
    description: book.description,
    isbn: book.isbn,
    isbn13: book.isbn13,
    isbn10: book.isbn10,
    language: book.language,
    pageCount: book.pageCount,
    series: book.series,
    seriesNumber: book.seriesNumber,
    format: book.format,
    coverUrl: book.coverPath ? `${baseUrl}/covers/${book.id}.jpg?v=${book.updatedAt?.getTime() || ""}` : null,
    addedAt: book.importedAt?.toISOString() || new Date().toISOString(),
    fileSize: book.fileSize,
    duration: book.duration,
    narrator: book.narrator,
    chapters,
  };
}

/**
 * Search books via full-text search
 */
export async function apiSearchBooks(
  query: string,
  options: {
    limit?: number;
    offset?: number;
  },
  baseUrl: string,
): Promise<ApiSearchResponse | ApiErrorResponse> {
  const { limit = 20, offset = 0 } = options;

  if (!query || query.trim().length < 2) {
    return {
      success: false,
      error: "Query must be at least 2 characters",
      code: "INVALID_QUERY",
    };
  }

  if (limit > 100) {
    return {
      success: false,
      error: "Limit cannot exceed 100",
      code: "INVALID_LIMIT",
    };
  }

  try {
    const results = await searchBooksLib({
      query,
      limit,
      offset,
    });

    return {
      success: true,
      query,
      total: results.length,
      limit,
      offset,
      results: results.map((r) => ({
        book: toApiBook(r.book, baseUrl),
        relevance: r.relevance,
        highlights: r.highlights,
      })),
    };
  } catch (error) {
    console.error("API search error:", error);
    return {
      success: false,
      error: "Search failed",
      code: "SEARCH_ERROR",
    };
  }
}

/**
 * Look up a book by ISBN (supports ISBN-10 and ISBN-13)
 */
export async function apiLookupByIsbn(
  isbn: string,
  baseUrl: string,
): Promise<ApiBookResponse | ApiErrorResponse> {
  // Normalize ISBN - remove hyphens and spaces
  const normalizedIsbn = isbn.replace(/[-\s]/g, "");

  if (!/^(\d{10}|\d{13})$/.test(normalizedIsbn)) {
    return {
      success: false,
      error: "Invalid ISBN format. Must be ISBN-10 or ISBN-13",
      code: "INVALID_ISBN",
    };
  }

  try {
    const result = await db
      .select()
      .from(books)
      .where(
        or(
          eq(books.isbn, normalizedIsbn),
          eq(books.isbn10, normalizedIsbn),
          eq(books.isbn13, normalizedIsbn),
        ),
      )
      .get();

    if (!result) {
      return {
        success: false,
        error: "Book not found",
        code: "NOT_FOUND",
      };
    }

    return {
      success: true,
      book: toApiBook(result, baseUrl),
    };
  } catch (error) {
    console.error("API ISBN lookup error:", error);
    return {
      success: false,
      error: "Lookup failed",
      code: "LOOKUP_ERROR",
    };
  }
}

/**
 * Get a book by ID
 */
export async function apiGetBook(
  id: string,
  baseUrl: string,
): Promise<ApiBookResponse | ApiErrorResponse> {
  try {
    const result = await db.select().from(books).where(eq(books.id, id)).get();

    if (!result) {
      return {
        success: false,
        error: "Book not found",
        code: "NOT_FOUND",
      };
    }

    return {
      success: true,
      book: toApiBook(result, baseUrl),
    };
  } catch (error) {
    console.error("API get book error:", error);
    return {
      success: false,
      error: "Lookup failed",
      code: "LOOKUP_ERROR",
    };
  }
}

/**
 * List all books with pagination and optional type filtering
 */
export async function apiListBooks(
  options: {
    limit?: number;
    offset?: number;
    type?: "ebook" | "audiobook" | "comic";
    orderBy?: "title" | "createdAt";
    order?: "asc" | "desc";
  },
  baseUrl: string,
): Promise<ApiSearchResponse | ApiErrorResponse> {
  const { limit = 20, offset = 0, type, orderBy = "createdAt", order = "desc" } = options;

  if (limit > 100) {
    return {
      success: false,
      error: "Limit cannot exceed 100",
      code: "INVALID_LIMIT",
    };
  }

  try {
    let query = db.select().from(books).$dynamic();
    let countQuery = db.select({ count: sql<number>`count(*)` }).from(books).$dynamic();

    // Filter by type if specified
    if (type) {
      const formatMap: Record<string, string[]> = {
        ebook: ["pdf", "epub", "mobi", "azw3"],
        audiobook: ["m4b", "mp3", "m4a"],
        comic: ["cbr", "cbz"],
      };
      const formats = formatMap[type];
      if (formats) {
        query = query.where(inArray(books.format, formats));
        countQuery = countQuery.where(inArray(books.format, formats));
      }
    }

    // Apply ordering
    const orderColumn = orderBy === "title" ? books.title : books.createdAt;
    const orderFn = order === "asc" ? asc : desc;
    query = query.orderBy(orderFn(orderColumn));

    // Run both queries in parallel
    const [results, countResult] = await Promise.all([
      query.limit(limit).offset(offset),
      countQuery.get(),
    ]);

    const totalCount = countResult?.count ?? 0;

    return {
      success: true,
      query: "",
      total: results.length,
      totalCount,
      limit,
      offset,
      results: results.map((book) => ({
        book: toApiBook(book, baseUrl),
        relevance: 0,
        highlights: {},
      })),
    };
  } catch (error) {
    console.error("API list books error:", error);
    return {
      success: false,
      error: "Failed to list books",
      code: "LIST_ERROR",
    };
  }
}
