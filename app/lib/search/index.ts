import { rawDb, db, books } from "../db";
import { inArray } from "drizzle-orm";
import type { Book } from "../db/schema";

export interface SearchOptions {
  query: string;
  limit?: number;
  offset?: number;
  searchIn?: ("title" | "subtitle" | "authors" | "description" | "content")[];
}

export interface SearchResult {
  book: Book;
  relevance: number;
  highlights: {
    title?: string;
    subtitle?: string;
    authors?: string;
    description?: string;
    content?: string;
    chapterTitle?: string;
  };
}

export async function searchBooks(options: SearchOptions): Promise<SearchResult[]> {
  const { query, limit = 20, offset = 0, searchIn = ["title", "subtitle", "authors", "description"] } = options;

  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return [];

  // Search metadata FTS
  // Column indices: 1=title, 2=subtitle, 3=authors, 4=description
  const metadataResults = rawDb
    .prepare(
      `SELECT
        book_id,
        bm25(books_fts) as relevance,
        highlight(books_fts, 1, '<mark>', '</mark>') as title_highlight,
        highlight(books_fts, 2, '<mark>', '</mark>') as subtitle_highlight,
        highlight(books_fts, 3, '<mark>', '</mark>') as authors_highlight,
        snippet(books_fts, 4, '<mark>', '</mark>', '...', 32) as description_snippet
      FROM books_fts
      WHERE books_fts MATCH ?
      ORDER BY relevance
      LIMIT ? OFFSET ?`,
    )
    .all(ftsQuery, limit, offset) as Array<{
    book_id: string;
    relevance: number;
    title_highlight: string;
    subtitle_highlight: string;
    authors_highlight: string;
    description_snippet: string;
  }>;

  // Search content FTS if requested
  let contentResults: Array<{
    book_id: string;
    relevance: number;
    chapter_title: string;
    content_snippet: string;
  }> = [];

  if (searchIn.includes("content")) {
    contentResults = rawDb
      .prepare(
        `SELECT DISTINCT
          book_id,
          bm25(book_content_fts) as relevance,
          chapter_title,
          snippet(book_content_fts, 3, '<mark>', '</mark>', '...', 64) as content_snippet
        FROM book_content_fts
        WHERE book_content_fts MATCH ?
        ORDER BY relevance
        LIMIT ? OFFSET ?`,
      )
      .all(ftsQuery, limit, offset) as Array<{
      book_id: string;
      relevance: number;
      chapter_title: string;
      content_snippet: string;
    }>;
  }

  // Merge results
  const bookIds = new Set<string>();
  const resultsMap = new Map<
    string,
    {
      relevance: number;
      highlights: SearchResult["highlights"];
    }
  >();

  for (const r of metadataResults) {
    bookIds.add(r.book_id);
    resultsMap.set(r.book_id, {
      relevance: r.relevance,
      highlights: {
        title: r.title_highlight,
        subtitle: r.subtitle_highlight,
        authors: r.authors_highlight,
        description: r.description_snippet,
      },
    });
  }

  for (const r of contentResults) {
    bookIds.add(r.book_id);
    const existing = resultsMap.get(r.book_id);
    if (existing) {
      existing.highlights.content = r.content_snippet;
      existing.highlights.chapterTitle = r.chapter_title;
      // Boost relevance if found in both
      existing.relevance = Math.min(existing.relevance, r.relevance);
    } else {
      resultsMap.set(r.book_id, {
        relevance: r.relevance,
        highlights: {
          content: r.content_snippet,
          chapterTitle: r.chapter_title,
        },
      });
    }
  }

  if (bookIds.size === 0) return [];

  // Fetch full book records
  const bookRecords = await db
    .select()
    .from(books)
    .where(inArray(books.id, Array.from(bookIds)));

  const bookMap = new Map(bookRecords.map((b) => [b.id, b]));

  // Build final results
  const results: SearchResult[] = [];
  for (const [bookId, data] of resultsMap) {
    const book = bookMap.get(bookId);
    if (book) {
      results.push({
        book,
        relevance: data.relevance,
        highlights: data.highlights,
      });
    }
  }

  // Sort by relevance
  results.sort((a, b) => a.relevance - b.relevance);

  return results;
}

export async function getSearchSuggestions(prefix: string, limit: number = 10): Promise<string[]> {
  if (!prefix || prefix.length < 2) return [];

  const results = rawDb
    .prepare(
      `SELECT DISTINCT title
       FROM books_fts
       WHERE title MATCH ?
       LIMIT ?`,
    )
    .all(prefix + "*", limit) as Array<{ title: string }>;

  return results.map((r) => r.title);
}

function buildFtsQuery(query: string): string {
  // Escape special FTS5 characters
  const escaped = query.replace(/['"(){}[\]^~*?:\\-]/g, " ");

  // Split into terms
  const terms = escaped.trim().split(/\s+/).filter(Boolean);

  if (terms.length === 0) return "";

  // Create prefix search for each term
  return terms.map((term) => `${term}*`).join(" ");
}

export { buildFtsQuery };
