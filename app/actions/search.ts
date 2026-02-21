"use server";

import {
  searchBooks as searchBooksLib,
  type SearchOptions,
  type SearchResult,
} from "../lib/search";

export async function searchBooks(
  query: string,
  options: Omit<SearchOptions, "query"> = {},
): Promise<SearchResult[]> {
  if (!query || query.trim().length < 2) {
    return [];
  }

  return searchBooksLib({
    query,
    ...options,
  });
}

export interface QuickSearchResult {
  id: string;
  title: string;
  authors: string | null;
  format: string;
  coverPath: string | null;
  coverColor: string | null;
  updatedAt: Date | null;
}

export async function quickSearch(query: string): Promise<QuickSearchResult[]> {
  if (!query || query.trim().length < 2) {
    return [];
  }

  const results = await searchBooksLib({
    query,
    searchIn: ["title", "authors"],
    limit: 8,
  });

  return results.map((r) => ({
    id: r.book.id,
    title: r.book.title,
    authors: r.book.authors,
    format: r.book.format,
    coverPath: r.book.coverPath,
    coverColor: r.book.coverColor,
    updatedAt: r.book.updatedAt,
  }));
}
