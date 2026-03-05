import { Suspense } from "react";
import { getRequest } from "react-flight-router/server";
import { getBooks, getBooksCount, getUnmatchedBooksCount, getFormatCounts } from "../actions/books";
import { getSeriesWithCovers, getSeriesBooksOtherFormats } from "../actions/series";
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

export default function Library() {
  return (
    <Suspense fallback={<LibrarySkeleton />}>
      <LibraryData />
    </Suspense>
  );
}

async function LibraryData() {
  const request = getRequest()!;
  const url = new URL(request.url);
  const searchParams = url.searchParams;

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
        initialSearchParamsKey={searchParams.toString()}
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
      initialSearchParamsKey={searchParams.toString()}
    />
  );
}

function LibrarySkeleton() {
  return (
    <main className="container my-8 px-6 mx-auto">
      <div className="animate-pulse">
        <div className="h-8 bg-surface-elevated rounded w-32 mb-2" />
        <div className="h-4 bg-surface-elevated rounded w-24 mb-8" />
        <div className="flex gap-3 mb-8">
          <div className="h-10 bg-surface-elevated rounded w-24" />
          <div className="h-10 bg-surface-elevated rounded w-24" />
          <div className="h-10 bg-surface-elevated rounded w-24" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i}>
              <div className="aspect-[2/3] bg-surface-elevated rounded-lg" />
              <div className="h-3 bg-surface-elevated rounded w-20 mt-2" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
