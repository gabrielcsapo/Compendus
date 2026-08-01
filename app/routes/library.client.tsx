"use client";

import type { ReactNode } from "react";
import { Link } from "react-flight-router/client";
import type { getBooks, getFormatCounts } from "../actions/books";
import { SeriesCard } from "../components/SeriesCard";
import { BookCover } from "../components/BookCover";
import type { ExploreData } from "../actions/explore";
import { InfiniteBookGrid } from "../components/InfiniteBookGrid";
import { LibraryExploreView } from "../components/LibraryExploreView";
import { SortDropdown, type SortOption } from "../components/SortDropdown";
import { TypeTabs, type TypeFilter } from "../components/TypeTabs";
import { FormatDropdown } from "../components/FormatDropdown";

type LibraryData = {
  view: "series" | "books" | "explore";
  exploreData?: ExploreData;
  seriesList: Array<{
    name: string;
    bookCount: number;
    coverBooks: Array<{ id: string; coverUrl: string | null }>;
  }>;
  seriesFilter: string | null;
  books: Awaited<ReturnType<typeof getBooks>>;
  totalCount: number;
  unmatchedCount: number;
  currentSort: SortOption;
  currentType: TypeFilter;
  currentFormats: string[];
  formatCounts: Awaited<ReturnType<typeof getFormatCounts>>;
  otherFormatBooks: Awaited<ReturnType<typeof getBooks>>;
};

export default function LibraryPage({
  initialData,
  exploreSlot,
}: {
  initialData: LibraryData;
  /** Server-streamed Home sections. */
  exploreSlot?: ReactNode;
}) {
  const data = initialData;

  const {
    view: currentView,
    seriesList,
    seriesFilter: currentSeriesFilter,
    books,
    totalCount,
    unmatchedCount,
    currentSort,
    currentType,
    currentFormats,
    formatCounts,
    otherFormatBooks,
  } = data;

  return (
    <main
      className={
        currentView === "explore"
          ? "my-8 w-full max-w-none px-4 sm:px-6 lg:px-8"
          : "container my-8 px-6 mx-auto"
      }
    >
      {/* Header */}
      <div className="flex flex-col gap-4 mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            {currentSeriesFilter ? (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <Link
                    to={`/library?view=series${currentType !== "all" ? `&type=${currentType}` : ""}`}
                    className="text-sm text-primary hover:text-primary-hover transition-colors"
                  >
                    &larr; All Series
                  </Link>
                </div>
                <h1 className="text-2xl font-bold text-foreground">{currentSeriesFilter}</h1>
                <p className="text-foreground-muted">
                  {totalCount} {totalCount === 1 ? "book" : "books"} in series
                </p>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold text-foreground">
                  {currentView === "explore" ? "Today" : "Library"}
                </h1>
                <p className="text-foreground-muted">
                  {currentView === "explore"
                    ? "Pick up where you left off"
                    : currentView === "series"
                      ? `${seriesList.length} ${seriesList.length === 1 ? "series" : "series"}`
                      : `${totalCount} ${totalCount === 1 ? "book" : "books"}`}
                </p>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!currentSeriesFilter && currentView !== "explore" && unmatchedCount > 0 && (
              <Link
                to="/admin/unmatched"
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-warning-light text-warning hover:opacity-80 transition-opacity text-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <span className="font-medium">{unmatchedCount}</span>
              </Link>
            )}
            {/* Home has two clear exits: browse the catalog or explore ideas. */}
            {!currentSeriesFilter && currentView === "explore" && (
              <>
                <Link
                  to="/library"
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-foreground-muted hover:text-foreground hover:bg-surface-elevated rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                    />
                  </svg>
                  Browse all
                </Link>
                <Link
                  to="/wander"
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-foreground-muted hover:text-foreground hover:bg-surface-elevated rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                    />
                  </svg>
                  Explore
                </Link>
              </>
            )}
            {!currentSeriesFilter && currentView !== "explore" && (
              <>
                <Link
                  to="/collections"
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-foreground-muted hover:text-foreground hover:bg-surface-elevated rounded-lg transition-colors"
                >
                  Collections
                </Link>
                <Link
                  to="/tags"
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-foreground-muted hover:text-foreground hover:bg-surface-elevated rounded-lg transition-colors"
                >
                  Tags
                </Link>
              </>
            )}
          </div>
        </div>
        {!currentSeriesFilter && currentView !== "explore" && (
          <div className="flex flex-wrap items-center gap-3">
            {/* PRIMARY: Content-type filter — always visible, matches iOS */}
            <TypeTabs
              currentType={currentType}
              currentSort={currentSort}
              currentView={
                currentView === "series" ? "series" : currentView === "books" ? "grid" : undefined
              }
              basePath="/library"
            />

            {/* Format dropdown — only meaningful in Browse */}
            {currentView === "books" && formatCounts.length > 1 && (
              <FormatDropdown
                formatCounts={formatCounts}
                selectedFormats={currentFormats}
                currentType={currentType}
                currentSort={currentSort}
              />
            )}

            {/* Right edge: view-mode icons (Explore / Browse / Series) + sort */}
            <div className="ml-auto flex items-center gap-2">
              <div
                className="inline-flex gap-0.5 p-0.5 bg-surface-elevated rounded-lg"
                role="tablist"
                aria-label="View mode"
              >
                <Link
                  to={`/library?view=grid${currentType !== "all" ? `&type=${currentType}` : ""}${currentSort !== "recent" ? `&sort=${currentSort}` : ""}`}
                  title="Browse — full grid"
                  aria-label="Grid view"
                  className={`p-1.5 rounded-md transition-colors ${
                    currentView === "books"
                      ? "bg-primary text-white"
                      : "text-foreground-muted hover:text-foreground hover:bg-surface"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6a2 2 0 012-2h4a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h4a2 2 0 012 2v4a2 2 0 01-2 2h-4a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h4a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h4a2 2 0 012 2v4a2 2 0 01-2 2h-4a2 2 0 01-2-2v-4z"
                    />
                  </svg>
                </Link>
                <Link
                  to={`/library?view=series${currentType !== "all" ? `&type=${currentType}` : ""}`}
                  title="Series — group by series"
                  aria-label="Series view"
                  className={`p-1.5 rounded-md transition-colors ${
                    currentView === "series"
                      ? "bg-primary text-white"
                      : "text-foreground-muted hover:text-foreground hover:bg-surface"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                    />
                  </svg>
                </Link>
              </div>

              {currentView === "books" && <SortDropdown currentSort={currentSort} />}
            </div>
          </div>
        )}
      </div>

      {/* Home sections stream from the server after the header is ready. */}
      {currentView === "explore" &&
        (data.exploreData ? <LibraryExploreView data={data.exploreData} /> : exploreSlot)}

      {/* Series / Browse grid views */}
      {currentView !== "explore" &&
        (currentView === "series" ? (
          <section>
            {seriesList.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-elevated flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-foreground-muted"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                    />
                  </svg>
                </div>
                <p className="text-foreground-muted">No series found in your library.</p>
                <p className="text-foreground-muted/60 text-sm mt-1">
                  Books with series metadata will appear here.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
                {seriesList.map((series) => (
                  <SeriesCard
                    key={series.name}
                    name={series.name}
                    bookCount={series.bookCount}
                    coverBooks={series.coverBooks}
                    currentType={currentType}
                  />
                ))}
              </div>
            )}
          </section>
        ) : (
          <>
            {/* Books grid with infinite scroll */}
            <section>
              <InfiniteBookGrid
                initialBooks={books}
                totalCount={totalCount}
                currentSort={currentSort}
                currentType={currentType}
                currentFormats={currentFormats}
                seriesFilter={currentSeriesFilter}
                emptyMessage={
                  currentSeriesFilter
                    ? "No books found in this series."
                    : "Your library is empty. Drop some books above to get started!"
                }
              />
            </section>

            {/* Other formats for this series */}
            {currentSeriesFilter && otherFormatBooks.length > 0 && (
              <section className="mt-10 pt-8 border-t border-border">
                <h2 className="text-lg font-semibold mb-1 text-foreground">
                  In a different format
                </h2>
                <p className="text-sm text-foreground-muted mb-4">
                  {otherFormatBooks.length} {otherFormatBooks.length === 1 ? "book" : "books"} from
                  this series in other formats
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
                  {otherFormatBooks.map((book) => (
                    <Link key={book.id} to={`/book/${book.id}`} className="group">
                      <div className="aspect-[2/3] rounded-lg overflow-hidden bg-surface-elevated shadow-md">
                        <BookCover
                          book={book}
                          fallback={
                            <div className="w-full h-full flex items-center justify-center p-2 bg-gradient-to-br from-primary-light to-accent-light">
                              <span className="text-xs text-foreground-muted">{book.title}</span>
                            </div>
                          }
                        />
                      </div>
                      <p className="text-xs font-medium mt-1 text-foreground line-clamp-1">
                        {book.title}
                      </p>
                      <p className="text-[10px] text-foreground-muted uppercase">{book.format}</p>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </>
        ))}
    </main>
  );
}
