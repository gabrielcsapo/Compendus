import { getRequest } from "react-flight-router/server";
import { getBooks, getBooksCount, getUnmatchedBooksCount, getFormatCounts } from "../actions/books";
import { getSeriesWithCovers, getSeriesBooksOtherFormats } from "../actions/series";
import { ExploreSections } from "../components/ExploreSections";
import { EmptyLibrary } from "../components/EmptyLibrary";
import { getCoverUrl } from "../lib/cover";
import type { BookType } from "../lib/book-types";
import type { SortOption } from "../components/SortDropdown";
import type { TypeFilter } from "../components/TypeTabs";
import LibraryClient from "./library.client";

const BOOKS_PER_PAGE = 24;

function getSortParams(sort: SortOption): {
  orderBy: "title" | "createdAt";
  order: "asc" | "desc";
} {
  switch (sort) {
    case "title-asc":
      return { orderBy: "title", order: "asc" };
    case "title-desc":
      return { orderBy: "title", order: "desc" };
    case "oldest":
      return { orderBy: "createdAt", order: "asc" };
    case "recent":
    default:
      return { orderBy: "createdAt", order: "desc" };
  }
}

export default async function Library() {
  // Await route data before handing a new segment to the client. During
  // filter/sort navigations the router can keep the useful current grid on
  // screen instead of replacing it with a full-page fallback.
  return LibraryData();
}

async function LibraryData() {
  const request = getRequest()!;
  const url = new URL(request.url);
  const searchParams = url.searchParams;
  const isHomePath = url.pathname === "/";

  const view = searchParams.get("view");
  const seriesFilter = searchParams.get("series");
  const sort = (searchParams.get("sort") as SortOption) || "recent";
  const typeParam = searchParams.get("type") as BookType | null;
  const type: TypeFilter =
    typeParam && ["audiobook", "ebook", "comic"].includes(typeParam) ? typeParam : "all";
  const formatParam = searchParams.get("format");
  const format = formatParam ? formatParam.split(",").filter(Boolean) : undefined;

  const { orderBy, order } = getSortParams(sort);
  const typeFilter = type !== "all" ? type : undefined;

  // The root route is the calm, curated Home surface. `/library` is the
  // complete catalog, even when it has no explicit `view` query parameter.
  // Only the two cheap counts are awaited here so the header paints immediately;
  // each curated section streams in via its own Suspense boundary in the slot.
  if (isHomePath && !view && !seriesFilter) {
    const [totalCount, unmatchedCount] = await Promise.all([
      getBooksCount(typeFilter),
      getUnmatchedBooksCount(),
    ]);
    return (
      <LibraryClient
        initialData={{
          view: "explore",
          exploreData: undefined,
          seriesList: [],
          seriesFilter: null,
          books: [],
          totalCount,
          unmatchedCount,
          currentSort: sort,
          currentType: type,
          currentFormats: format ?? [],
          formatCounts: [],
          otherFormatBooks: [],
        }}
        exploreSlot={
          totalCount === 0 ? <EmptyLibrary /> : <ExploreSections typeFilter={typeFilter} />
        }
      />
    );
  }

  if (view === "series") {
    const rawSeriesList = await getSeriesWithCovers(typeFilter);
    const seriesList = rawSeriesList.map((s) => ({
      ...s,
      coverBooks: s.coverBooks.map((b) => ({
        id: b.id,
        coverUrl: getCoverUrl(b),
      })),
    }));
    return (
      <LibraryClient
        initialData={{
          view: "series",
          seriesList,
          seriesFilter: null,
          books: [],
          totalCount: 0,
          unmatchedCount: 0,
          currentSort: sort,
          currentType: type,
          currentFormats: format ?? [],
          formatCounts: [],
          otherFormatBooks: [],
        }}
      />
    );
  }

  const [books, totalCount, unmatchedCount, formatCounts, otherFormatBooks] = await Promise.all([
    getBooks({
      limit: BOOKS_PER_PAGE,
      offset: 0,
      orderBy,
      order,
      type: typeFilter,
      format,
      series: seriesFilter || undefined,
    }),
    getBooksCount(typeFilter, format, seriesFilter || undefined),
    getUnmatchedBooksCount(),
    getFormatCounts(typeFilter),
    seriesFilter && typeFilter
      ? getSeriesBooksOtherFormats(seriesFilter, typeFilter)
      : Promise.resolve([]),
  ]);

  return (
    <LibraryClient
      initialData={{
        view: "books",
        seriesList: [],
        seriesFilter,
        books,
        totalCount,
        unmatchedCount,
        currentSort: sort,
        currentType: type,
        currentFormats: format ?? [],
        formatCounts,
        otherFormatBooks,
      }}
    />
  );
}
