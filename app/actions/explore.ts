"use server";

import { getBooks, getBooksCount, getUnmatchedBooksCount, type BookWithState } from "./books";
import { getSeriesWithCovers } from "./series";
import { getTagsWithCounts } from "./tags";
import { rawDb } from "../lib/db";
import { resolveProfileId } from "../lib/profile";
import { getCuratedDiscovery, type CuratedDiscovery } from "../lib/discovery/curation";

export type ExploreData = {
  inProgress: BookWithState[];
  readNextInSeries: Array<{ seriesName: string; book: BookWithState }>;
  staleReads: BookWithState[];
  recentlyAdded: BookWithState[];
  moreByAuthor: Array<{ author: string; books: BookWithState[] }>;
  genreSections: Array<{ subject: string; books: BookWithState[] }>;
  topSeries: Array<{ name: string; bookCount: number; books: BookWithState[] }>;
  topTags: Array<{ id: string; name: string; color: string | null; books: BookWithState[] }>;
  curated: CuratedDiscovery | null;
  curatedBooks: BookWithState[];
  totalCount: number;
  unmatchedCount: number;
};

/**
 * Find the next unread book in each in-progress series.
 * A series is "in-progress" if the profile has read at least one book but not all.
 */
export async function getReadNextInSeries(
  profileId?: string,
): Promise<Array<{ seriesName: string; book: BookWithState }>> {
  const pid = profileId ?? resolveProfileId();
  if (!pid) return [];

  // Use raw SQL for the complex grouping/window logic
  const rows = rawDb
    .prepare(
      `
    WITH series_status AS (
      SELECT
        b.series,
        b.id AS book_id,
        b.series_number,
        COALESCE(ubs.is_read, b.is_read, 0) AS is_read,
        COALESCE(ubs.reading_progress, b.reading_progress, 0) AS reading_progress
      FROM books b
      LEFT JOIN user_book_state ubs
        ON ubs.book_id = b.id AND ubs.profile_id = ?
      WHERE b.series IS NOT NULL
    ),
    in_progress_series AS (
      SELECT series
      FROM series_status
      GROUP BY series
      HAVING SUM(is_read) >= 1 AND SUM(is_read) < COUNT(*)
    ),
    next_book AS (
      SELECT
        ss.series,
        ss.book_id,
        ss.series_number,
        ROW_NUMBER() OVER (
          PARTITION BY ss.series
          ORDER BY CAST(ss.series_number AS REAL), ss.book_id
        ) AS rn
      FROM series_status ss
      JOIN in_progress_series ips ON ips.series = ss.series
      WHERE ss.is_read = 0 AND ss.reading_progress = 0
        AND NOT EXISTS (
          SELECT 1 FROM user_book_state aside
          WHERE aside.profile_id = ? AND aside.book_id = ss.book_id AND aside.is_set_aside = 1
        )
    )
    SELECT book_id, series, series_number
    FROM next_book
    WHERE rn = 1
    LIMIT 10
  `,
    )
    .all(pid, pid) as Array<{ book_id: string; series: string; series_number: string | null }>;

  if (rows.length === 0) return [];

  // Fetch full book objects with reading state by loading each series
  const seriesNames = [...new Set(rows.map((r) => r.series))];
  const seriesBooks = await Promise.all(
    seriesNames.map((s) => getBooks({ series: s, limit: 100, profileId })),
  );
  const booksById = new Map<string, BookWithState>();
  for (const seriesList of seriesBooks) {
    for (const b of seriesList) {
      booksById.set(b.id, b);
    }
  }

  return rows
    .map((r) => {
      const book = booksById.get(r.book_id);
      return book ? { seriesName: r.series, book } : null;
    })
    .filter((r): r is { seriesName: string; book: BookWithState } => r != null);
}

/**
 * Find books with 10%+ progress not touched in 30+ days.
 */
export async function getStaleReads(profileId?: string): Promise<BookWithState[]> {
  const pid = profileId ?? resolveProfileId();
  if (!pid) return [];

  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;

  const rows = rawDb
    .prepare(
      `
    SELECT b.id AS book_id
    FROM books b
    LEFT JOIN user_book_state ubs
      ON ubs.book_id = b.id AND ubs.profile_id = ?
    WHERE COALESCE(ubs.reading_progress, b.reading_progress, 0) > 0.1
      AND COALESCE(ubs.is_read, b.is_read, 0) = 0
      AND COALESCE(ubs.is_set_aside, 0) = 0
      AND COALESCE(ubs.last_read_at, b.last_read_at) IS NOT NULL
      AND COALESCE(ubs.last_read_at, b.last_read_at) < ?
    ORDER BY COALESCE(ubs.last_read_at, b.last_read_at) ASC
    LIMIT 10
  `,
    )
    .all(pid, thirtyDaysAgo) as Array<{ book_id: string }>;

  if (rows.length === 0) return [];

  // Fetch full book objects with reading state overlay
  const recentBooks = await getBooks({
    orderBy: "lastReadAt",
    order: "desc",
    limit: 200,
    profileId,
  });
  const result = rows
    .map((r) => recentBooks.find((b) => b.id === r.book_id))
    .filter((b): b is BookWithState => b != null);

  return result;
}

/**
 * Surface unread books by authors the user has read 2+ books from.
 */
export async function getMoreByAuthor(
  profileId?: string,
): Promise<Array<{ author: string; books: BookWithState[] }>> {
  const pid = profileId ?? resolveProfileId();
  if (!pid) return [];

  // Find all read books with their authors
  const readBooks = rawDb
    .prepare(
      `
    SELECT b.id AS book_id, b.authors
    FROM books b
    INNER JOIN user_book_state ubs
      ON ubs.book_id = b.id AND ubs.profile_id = ?
    WHERE ubs.is_read = 1 AND b.authors IS NOT NULL
  `,
    )
    .all(pid) as Array<{ book_id: string; authors: string | null }>;

  if (readBooks.length === 0) return [];

  // Count read books per author
  const authorReadCount = new Map<string, number>();
  for (const row of readBooks) {
    try {
      const authors: string[] = JSON.parse(row.authors || "[]");
      for (const author of authors) {
        authorReadCount.set(author, (authorReadCount.get(author) || 0) + 1);
      }
    } catch {
      // skip malformed JSON
    }
  }

  // Filter to authors with 2+ read books, sorted by count
  const qualifiedAuthors = [...authorReadCount.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([author]) => author);

  if (qualifiedAuthors.length === 0) return [];

  // For each author, find unread books in the library
  const readBookIds = new Set(readBooks.map((r) => r.book_id));
  const results: Array<{ author: string; books: BookWithState[] }> = [];

  for (const author of qualifiedAuthors) {
    // Search by author name in the JSON authors field
    const authorBooks = await getBooks({ search: author, limit: 20, profileId });
    const unread = authorBooks.filter((b) => {
      if (readBookIds.has(b.id)) return false;
      if (b.isRead) return false;
      // Verify this author is actually in the authors array
      try {
        const authors: string[] = JSON.parse(b.authors || "[]");
        return authors.some((a) => a.toLowerCase() === author.toLowerCase());
      } catch {
        return false;
      }
    });

    if (unread.length > 0) {
      results.push({ author, books: unread.slice(0, 10) });
    }
  }

  return results;
}

/**
 * Create genre-based sections from bookSubjects data.
 * Shows top subjects by book count, with unread books prioritized.
 */
export async function getGenreSections(
  profileId?: string,
): Promise<Array<{ subject: string; books: BookWithState[] }>> {
  const pid = profileId ?? resolveProfileId();

  // Find top subjects by book count
  const topSubjects = rawDb
    .prepare(
      `
    SELECT bs.subject, COUNT(DISTINCT bs.book_id) AS book_count
    FROM book_subjects bs
    GROUP BY bs.subject
    HAVING book_count >= 3
    ORDER BY book_count DESC
    LIMIT 5
  `,
    )
    .all() as Array<{ subject: string; book_count: number }>;

  if (topSubjects.length === 0) return [];

  // Collect up to 12 book ids per subject, then fetch every needed book in a
  // single query (previously this loaded 500 books per subject in a loop, which
  // also silently dropped any subject book outside the first 500 by date).
  const subjectBookIds = new Map<string, string[]>();
  const allIds = new Set<string>();
  for (const { subject } of topSubjects) {
    const rows = rawDb
      .prepare(`SELECT bs.book_id FROM book_subjects bs WHERE bs.subject = ? LIMIT 12`)
      .all(subject) as Array<{ book_id: string }>;
    if (rows.length === 0) continue;
    const ids = rows.map((r) => r.book_id);
    subjectBookIds.set(subject, ids);
    for (const id of ids) allIds.add(id);
  }

  if (allIds.size === 0) return [];

  const books = await getBooks({ ids: [...allIds], limit: allIds.size, profileId: pid });
  const booksById = new Map(books.map((b) => [b.id, b]));

  const results: Array<{ subject: string; books: BookWithState[] }> = [];
  for (const { subject } of topSubjects) {
    const ids = subjectBookIds.get(subject);
    if (!ids) continue;

    const genreBooks = ids
      .map((id) => booksById.get(id))
      .filter((b): b is BookWithState => b != null);

    // Sort: unread first, then by title
    genreBooks.sort((a, b) => {
      const aRead = a.isRead ? 1 : 0;
      const bRead = b.isRead ? 1 : 0;
      if (aRead !== bRead) return aRead - bRead;
      return a.title.localeCompare(b.title);
    });

    if (genreBooks.length > 0) {
      results.push({ subject, books: genreBooks.slice(0, 12) });
    }
  }

  return results;
}

/**
 * "Continue Reading" — recently-touched books with reading progress.
 */
export async function getInProgressBooks(
  profileId?: string,
  typeFilter?: import("../lib/book-types").BookType,
): Promise<BookWithState[]> {
  const lastReadBooks = await getBooks({
    orderBy: "lastReadAt",
    order: "desc",
    limit: 30,
    profileId,
    type: typeFilter,
  });
  return lastReadBooks.filter((b) => (b.readingProgress || 0) > 0 && !b.isSetAside);
}

/**
 * "Recently Added" — newest books by creation time.
 */
export async function getRecentlyAddedBooks(
  profileId?: string,
  typeFilter?: import("../lib/book-types").BookType,
): Promise<BookWithState[]> {
  const books = await getBooks({
    orderBy: "createdAt",
    order: "desc",
    limit: 24,
    profileId,
    type: typeFilter,
  });
  return books.filter((book) => !book.isRead && !book.isSetAside).slice(0, 16);
}

/**
 * Top series with 3+ books (up to 5), each with its first 12 books.
 */
export async function getTopSeriesSections(
  profileId?: string,
  typeFilter?: import("../lib/book-types").BookType,
): Promise<Array<{ name: string; bookCount: number; books: BookWithState[] }>> {
  const rawSeriesList = await getSeriesWithCovers(typeFilter);
  const topSeriesInfo = rawSeriesList.filter((s) => s.bookCount >= 3).slice(0, 5);
  const seriesBooksArrays = await Promise.all(
    topSeriesInfo.map((s) => getBooks({ series: s.name, limit: 12, profileId })),
  );
  return topSeriesInfo.map((s, i) => ({
    name: s.name,
    bookCount: s.bookCount,
    books: seriesBooksArrays[i],
  }));
}

/**
 * Top tags with 3+ books by count (up to 5), each with its first 12 books.
 */
export async function getTopTagsSections(
  profileId?: string,
): Promise<Array<{ id: string; name: string; color: string | null; books: BookWithState[] }>> {
  const rawTags = await getTagsWithCounts();
  const topTagsInfo = rawTags
    .filter((t) => t.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const tagsBooksArrays = await Promise.all(
    topTagsInfo.map((t) => getBooks({ tagId: t.id, limit: 12, profileId })),
  );
  return topTagsInfo.map((t, i) => ({
    id: t.id,
    name: t.name,
    color: t.color ?? null,
    books: tagsBooksArrays[i],
  }));
}

export async function getExploreData(
  profileId?: string,
  typeFilter?: import("../lib/book-types").BookType,
): Promise<ExploreData> {
  const pid = profileId ?? resolveProfileId();
  const [
    inProgress,
    recentlyAdded,
    totalCount,
    unmatchedCount,
    readNextInSeries,
    staleReads,
    curated,
  ] = await Promise.all([
    getInProgressBooks(profileId, typeFilter),
    getRecentlyAddedBooks(profileId, typeFilter),
    getBooksCount(typeFilter),
    getUnmatchedBooksCount(),
    getReadNextInSeries(profileId),
    getStaleReads(profileId),
    pid ? getCuratedDiscovery(pid) : Promise.resolve(null),
  ]);

  const curatedIds = curated ? [...new Set(curated.shelves.flatMap((shelf) => shelf.bookIds))] : [];
  const curatedBooks =
    curatedIds.length > 0
      ? await getBooks({ ids: curatedIds, limit: curatedIds.length, profileId: pid })
      : [];

  return {
    inProgress,
    readNextInSeries,
    staleReads,
    recentlyAdded,
    // Keep the wire shape stable for older clients while Home intentionally
    // limits itself to four useful modules. Deep browsing belongs in Library.
    moreByAuthor: [],
    genreSections: [],
    topSeries: [],
    topTags: [],
    curated,
    curatedBooks,
    totalCount,
    unmatchedCount,
  };
}
