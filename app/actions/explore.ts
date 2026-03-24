"use server";

import { getBooks, getBooksCount, getUnmatchedBooksCount, type BookWithState } from "./books";
import { getSeriesWithCovers } from "./series";
import { getTagsWithCounts } from "./tags";

export type ExploreData = {
  inProgress: BookWithState[];
  recentlyAdded: BookWithState[];
  topSeries: Array<{ name: string; bookCount: number; books: BookWithState[] }>;
  topTags: Array<{ id: string; name: string; color: string | null; books: BookWithState[] }>;
  totalCount: number;
  unmatchedCount: number;
};

export async function getExploreData(profileId?: string): Promise<ExploreData> {
  const [lastReadBooks, recentlyAdded, totalCount, unmatchedCount, rawSeriesList, rawTags] =
    await Promise.all([
      getBooks({ orderBy: "lastReadAt", order: "desc", limit: 30, profileId }),
      getBooks({ orderBy: "createdAt", order: "desc", limit: 16, profileId }),
      getBooksCount(),
      getUnmatchedBooksCount(),
      getSeriesWithCovers(),
      getTagsWithCounts(),
    ]);

  const inProgress = lastReadBooks.filter((b) => (b.readingProgress || 0) > 0);

  // Top series with 3+ books (up to 5)
  const topSeriesInfo = rawSeriesList.filter((s) => s.bookCount >= 3).slice(0, 5);

  // Top tags with 3+ books by count (up to 5)
  const topTagsInfo = rawTags
    .filter((t) => t.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const [seriesBooksArrays, tagsBooksArrays] = await Promise.all([
    Promise.all(topSeriesInfo.map((s) => getBooks({ series: s.name, limit: 12, profileId }))),
    Promise.all(topTagsInfo.map((t) => getBooks({ tagId: t.id, limit: 12, profileId }))),
  ]);

  const topSeries = topSeriesInfo.map((s, i) => ({
    name: s.name,
    bookCount: s.bookCount,
    books: seriesBooksArrays[i],
  }));

  const topTags = topTagsInfo.map((t, i) => ({
    id: t.id,
    name: t.name,
    color: t.color ?? null,
    books: tagsBooksArrays[i],
  }));

  return { inProgress, recentlyAdded, topSeries, topTags, totalCount, unmatchedCount };
}
