"use client";

import { BookCarousel } from "./BookCarousel";
import { EmptyLibrary } from "./EmptyLibrary";
import { CuratedShelfSwitcher } from "./CuratedShelfSwitcher";
import type { ExploreData } from "../actions/explore";
import type { BookWithState } from "../actions/books";

export function LibraryExploreView({ data }: { data: ExploreData }) {
  const { inProgress, readNextInSeries, recentlyAdded, curated, curatedBooks } = data;
  const curatedById = new Map(curatedBooks.map((book) => [book.id, book]));

  const hasContent =
    inProgress.length > 0 ||
    readNextInSeries.length > 0 ||
    recentlyAdded.length > 0 ||
    (curated?.shelves.length ?? 0) > 0;

  if (!hasContent) {
    return <EmptyLibrary />;
  }

  return (
    <div className="space-y-10 pb-8">
      {inProgress.length > 0 && (
        <BookCarousel title="Continue Reading" books={inProgress.slice(0, 10)} allowSetAside />
      )}

      {readNextInSeries.length > 0 && (
        <BookCarousel
          title="Read Next in Series"
          books={readNextInSeries.slice(0, 10).map((r) => r.book)}
        />
      )}

      {curated && (
        <CuratedShelfSwitcher
          shelves={curated.shelves.map((shelf) => ({
            ...shelf,
            books: shelf.bookIds
              .map((id) => curatedById.get(id))
              .filter((book): book is BookWithState => book != null),
          }))}
        />
      )}

      {recentlyAdded.length > 0 && (
        <BookCarousel
          title="Recently Added"
          books={recentlyAdded.slice(0, 10)}
          seeAllHref="/library?view=grid"
        />
      )}
    </div>
  );
}
