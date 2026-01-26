import { db, books } from "../db";
import { eq, or } from "drizzle-orm";
import { searchBooks as searchBooksLib } from "../search";
import type { Book } from "../db/schema";

/**
 * Public API response format for a book
 * Excludes internal fields like file paths
 */
export interface ApiBook {
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
}

export interface ApiSearchResult {
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

export interface ApiSearchResponse {
  success: true;
  query: string;
  total: number;
  limit: number;
  offset: number;
  results: ApiSearchResult[];
}

export interface ApiBookResponse {
  success: true;
  book: ApiBook;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
  code: string;
}

/**
 * Transform internal Book to public API format
 */
function toApiBook(book: Book, baseUrl: string): ApiBook {
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
    coverUrl: book.coverPath ? `${baseUrl}/covers/${book.id}.jpg` : null,
    addedAt: book.importedAt?.toISOString() || new Date().toISOString(),
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
    searchContent?: boolean;
  },
  baseUrl: string,
): Promise<ApiSearchResponse | ApiErrorResponse> {
  const { limit = 20, offset = 0, searchContent = false } = options;

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
    const searchIn: ("title" | "authors" | "description" | "content")[] = ["title", "authors", "description"];
    if (searchContent) {
      searchIn.push("content");
    }

    const results = await searchBooksLib({
      query,
      limit,
      offset,
      searchIn,
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
    const result = await db
      .select()
      .from(books)
      .where(eq(books.id, id))
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
    console.error("API get book error:", error);
    return {
      success: false,
      error: "Lookup failed",
      code: "LOOKUP_ERROR",
    };
  }
}

/**
 * List all books with pagination
 */
export async function apiListBooks(
  options: {
    limit?: number;
    offset?: number;
  },
  baseUrl: string,
): Promise<ApiSearchResponse | ApiErrorResponse> {
  const { limit = 20, offset = 0 } = options;

  if (limit > 100) {
    return {
      success: false,
      error: "Limit cannot exceed 100",
      code: "INVALID_LIMIT",
    };
  }

  try {
    const results = await db
      .select()
      .from(books)
      .limit(limit)
      .offset(offset);

    return {
      success: true,
      query: "",
      total: results.length,
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
