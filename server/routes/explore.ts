import { Hono } from "hono";
import { getExploreData } from "../../app/actions/explore";
import type { BookWithState } from "../../app/actions/books";
import { toApiBook } from "../../app/lib/api/search";
import { refreshCuratedDiscovery } from "../../app/lib/discovery/curation";
import { requireAdmin } from "../middleware/profile";

export const exploreRoutes = new Hono();

// GET /api/explore - server-driven explore view model for iOS
exploreRoutes.get("/api/explore", async (c) => {
  const profileId = c.get("profileId") ?? undefined;
  const baseUrl = new URL(c.req.url).origin;
  const data = await getExploreData(profileId);

  const sections: Array<{
    id: string;
    title: string;
    subtitle?: string;
    books: ReturnType<typeof toApiBook>[];
    reasons?: Record<string, string>;
    action: { label: string } | null;
  }> = [];

  if (data.curated) {
    const curatedBooks = new Map(data.curatedBooks.map((book) => [book.id, book]));
    for (const shelf of data.curated.shelves) {
      const shelfBooks = shelf.bookIds
        .map((id) => curatedBooks.get(id))
        .filter((book): book is BookWithState => book != null);
      if (shelfBooks.length < 2) continue;
      sections.push({
        id: `curated_${shelf.id}`,
        title: shelf.title,
        subtitle: shelf.subtitle,
        books: shelfBooks.map((book) => toApiBook(book, baseUrl, book)),
        reasons: shelf.reasons,
        action: null,
      });
    }
  }

  if (data.inProgress.length > 0) {
    sections.push({
      id: "continue_reading",
      title: "Continue Reading",
      books: data.inProgress.map((b) => toApiBook(b, baseUrl, b)),
      action: null,
    });
  }

  if (data.readNextInSeries.length > 0) {
    sections.push({
      id: "read_next_in_series",
      title: "Read Next in Series",
      books: data.readNextInSeries.map((r) => toApiBook(r.book, baseUrl, r.book)),
      action: null,
    });
  }

  if (data.staleReads.length > 0) {
    sections.push({
      id: "stale_reads",
      title: "From Your Open Books",
      books: data.staleReads.map((b) => toApiBook(b, baseUrl, b)),
      action: null,
    });
  }

  if (data.recentlyAdded.length > 0) {
    sections.push({
      id: "recently_added",
      title: "Recently Added",
      books: data.recentlyAdded.map((b) => toApiBook(b, baseUrl, b)),
      action: { label: "See All" },
    });
  }

  for (const authorGroup of data.moreByAuthor) {
    sections.push({
      id: `author_${authorGroup.author.replace(/\s+/g, "_").toLowerCase()}`,
      title: `More by ${authorGroup.author}`,
      books: authorGroup.books.map((b) => toApiBook(b, baseUrl, b)),
      action: null,
    });
  }

  for (const genre of data.genreSections) {
    const displayName = genre.subject.replace(/\b\w/g, (c) => c.toUpperCase());
    sections.push({
      id: `genre_${genre.subject.replace(/\s+/g, "_")}`,
      title: displayName,
      books: genre.books.map((b) => toApiBook(b, baseUrl, b)),
      action: null,
    });
  }

  for (const series of data.topSeries) {
    sections.push({
      id: `series_${series.name}`,
      title: series.name,
      books: series.books.map((b) => toApiBook(b, baseUrl, b)),
      action: { label: "See All" },
    });
  }

  for (const tag of data.topTags) {
    sections.push({
      id: `tag_${tag.id}`,
      title: tag.name.charAt(0).toUpperCase() + tag.name.slice(1),
      books: tag.books.map((b) => toApiBook(b, baseUrl, b)),
      action: null,
    });
  }

  // The curated shelf is read-heavy and safe to reuse briefly. This lets iOS
  // and browsers return to it instantly while ETag revalidation keeps the
  // window small enough for new progress and imports to appear promptly.
  c.header("Cache-Control", "private, max-age=30, stale-while-revalidate=120");
  return c.json({
    sections,
    purchases: data.curated?.purchases ?? [],
    curatedAt: data.curated?.generatedAt ?? null,
    curationSource: data.curated?.source ?? null,
  });
});

// Explicit refresh is useful before a trip or after a large import. It waits
// for Lemonade and persists the result; normal GETs never block on inference.
exploreRoutes.post("/api/explore/refresh", requireAdmin, async (c) => {
  const profileId = c.get("profileId");
  if (!profileId) {
    return c.json({ success: false, error: "Profile required", code: "NO_PROFILE" }, 401);
  }
  const discovery = await refreshCuratedDiscovery(profileId);
  return c.json({ success: true, discovery });
});
