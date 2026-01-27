"use server";

import { db, books, wantedBooks } from "../lib/db";
import { sql, isNotNull, eq } from "drizzle-orm";
import { searchAllSources, type MetadataSearchResult } from "../lib/metadata";

export interface SeriesInfo {
  name: string;
  ownedBooks: Array<{
    id: string;
    title: string;
    seriesNumber: string | null;
    coverPath: string | null;
  }>;
  wantedBooks: Array<{
    id: string;
    title: string;
    seriesNumber: string | null;
    coverUrl: string | null;
  }>;
  totalOwned: number;
  totalWanted: number;
}

export interface SeriesWithCounts {
  name: string;
  ownedCount: number;
  wantedCount: number;
}

/**
 * Get all unique series names from owned books
 */
export async function getOwnedSeries(): Promise<string[]> {
  const result = await db
    .selectDistinct({ series: books.series })
    .from(books)
    .where(isNotNull(books.series));

  return result
    .map((r) => r.series!)
    .filter(Boolean)
    .sort();
}

/**
 * Get all series with counts of owned and wanted books
 */
export async function getAllSeriesWithCounts(): Promise<SeriesWithCounts[]> {
  const ownedSeries = await db
    .select({
      series: books.series,
      count: sql<number>`count(*)`,
    })
    .from(books)
    .where(isNotNull(books.series))
    .groupBy(books.series);

  const wantedSeries = await db
    .select({
      series: wantedBooks.series,
      count: sql<number>`count(*)`,
    })
    .from(wantedBooks)
    .where(isNotNull(wantedBooks.series))
    .groupBy(wantedBooks.series);

  // Combine owned and wanted
  const seriesMap = new Map<string, { ownedCount: number; wantedCount: number }>();

  for (const s of ownedSeries) {
    if (s.series) {
      seriesMap.set(s.series, { ownedCount: s.count, wantedCount: 0 });
    }
  }

  for (const s of wantedSeries) {
    if (s.series) {
      const existing = seriesMap.get(s.series);
      if (existing) {
        existing.wantedCount = s.count;
      } else {
        seriesMap.set(s.series, { ownedCount: 0, wantedCount: s.count });
      }
    }
  }

  return Array.from(seriesMap.entries())
    .map(([name, counts]) => ({ name, ...counts }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get series details with owned and wanted books
 */
export async function getSeriesDetails(seriesName: string): Promise<SeriesInfo> {
  const owned = await db
    .select({
      id: books.id,
      title: books.title,
      seriesNumber: books.seriesNumber,
      coverPath: books.coverPath,
    })
    .from(books)
    .where(eq(books.series, seriesName));

  const wanted = await db
    .select({
      id: wantedBooks.id,
      title: wantedBooks.title,
      seriesNumber: wantedBooks.seriesNumber,
      coverUrl: wantedBooks.coverUrl,
    })
    .from(wantedBooks)
    .where(eq(wantedBooks.series, seriesName));

  return {
    name: seriesName,
    ownedBooks: owned,
    wantedBooks: wanted,
    totalOwned: owned.length,
    totalWanted: wanted.length,
  };
}

/**
 * Search for books in a series from external APIs
 */
export async function searchSeriesBooks(seriesName: string): Promise<MetadataSearchResult[]> {
  // Search external APIs for the series
  const results = await searchAllSources(seriesName);

  // Filter to books that likely belong to this series
  return results.filter(
    (r) =>
      r.series?.toLowerCase().includes(seriesName.toLowerCase()) ||
      r.title.toLowerCase().includes(seriesName.toLowerCase()),
  );
}

/**
 * Find missing books in a series (not owned, not already wanted)
 */
export async function findMissingSeriesBooks(seriesName: string): Promise<MetadataSearchResult[]> {
  const searchResults = await searchSeriesBooks(seriesName);

  // Get ISBNs of owned books in this series
  const owned = await db
    .select({ isbn: books.isbn, isbn13: books.isbn13, isbn10: books.isbn10, title: books.title })
    .from(books)
    .where(eq(books.series, seriesName));

  // Get ISBNs of wanted books in this series
  const wanted = await db
    .select({
      isbn: wantedBooks.isbn,
      isbn13: wantedBooks.isbn13,
      isbn10: wantedBooks.isbn10,
      title: wantedBooks.title,
    })
    .from(wantedBooks)
    .where(eq(wantedBooks.series, seriesName));

  const ownedIsbns = new Set(
    [
      ...owned.map((b) => b.isbn),
      ...owned.map((b) => b.isbn13),
      ...owned.map((b) => b.isbn10),
    ].filter(Boolean),
  );

  const wantedIsbns = new Set(
    [
      ...wanted.map((b) => b.isbn),
      ...wanted.map((b) => b.isbn13),
      ...wanted.map((b) => b.isbn10),
    ].filter(Boolean),
  );

  // Also track titles to avoid duplicates when ISBN isn't available
  const ownedTitles = new Set(owned.map((b) => b.title.toLowerCase()));
  const wantedTitles = new Set(wanted.map((b) => b.title.toLowerCase()));

  // Filter out owned and wanted books
  return searchResults.filter((r) => {
    const isbns = [r.isbn, r.isbn13, r.isbn10].filter(Boolean);

    // Check ISBN match
    if (isbns.some((isbn) => ownedIsbns.has(isbn!) || wantedIsbns.has(isbn!))) {
      return false;
    }

    // Check title match (fuzzy)
    const titleLower = r.title.toLowerCase();
    if (ownedTitles.has(titleLower) || wantedTitles.has(titleLower)) {
      return false;
    }

    return true;
  });
}
