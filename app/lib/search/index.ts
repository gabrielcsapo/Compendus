import { db, books } from "../db";
import { or, like, and, inArray } from "drizzle-orm";
import type { Book } from "../db/schema";
import type { BookType } from "../book-types";
import { getFormatsByType } from "../book-types";

export interface SearchOptions {
  query: string;
  limit?: number;
  offset?: number;
  searchIn?: ("title" | "subtitle" | "authors" | "description")[];
  type?: BookType;
}

export interface SearchResult {
  book: Book;
  relevance: number;
  highlights: {
    title?: string;
    subtitle?: string;
    authors?: string;
    description?: string;
  };
}

export async function searchBooks(options: SearchOptions): Promise<SearchResult[]> {
  const { query, limit = 20, offset = 0, searchIn = ["title", "subtitle", "authors", "description"], type } = options;

  if (!query || query.trim().length < 2) return [];

  const searchTerm = `%${query}%`;

  const searchConditions = [];
  if (searchIn.includes("title")) {
    searchConditions.push(like(books.title, searchTerm));
  }
  if (searchIn.includes("subtitle")) {
    searchConditions.push(like(books.subtitle, searchTerm));
  }
  if (searchIn.includes("authors")) {
    searchConditions.push(like(books.authors, searchTerm));
  }
  if (searchIn.includes("description")) {
    searchConditions.push(like(books.description, searchTerm));
  }

  if (searchConditions.length === 0) return [];

  const whereConditions = [or(...searchConditions)!];
  if (type) {
    whereConditions.push(inArray(books.format, getFormatsByType(type)));
  }

  const results = await db
    .select()
    .from(books)
    .where(and(...whereConditions))
    .limit(limit)
    .offset(offset);

  return results.map((book) => ({
    book,
    relevance: 0,
    highlights: {
      title: book.title,
      subtitle: book.subtitle ?? undefined,
      authors: book.authors ?? undefined,
      description: book.description ?? undefined,
    },
  }));
}
