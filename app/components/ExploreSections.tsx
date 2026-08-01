import { Suspense } from "react";
import { BookCarousel } from "./BookCarousel";
import { CarouselSkeleton } from "./CarouselSkeleton";
import { CuratedShelfSwitcher } from "./CuratedShelfSwitcher";
import { getInProgressBooks, getRecentlyAddedBooks, getReadNextInSeries } from "../actions/explore";
import { getBooks } from "../actions/books";
import { getCuratedDiscovery } from "../lib/discovery/curation";
import { resolveProfileId } from "../lib/profile";
import type { BookType } from "../lib/book-types";

// Each section is its own async server component awaiting only its own data,
// wrapped in a Suspense boundary so it streams in independently. Cheap,
// above-the-fold rows (Continue Reading) paint before the expensive
// genre/series/tag queries finish.

async function ContinueReadingSection({ typeFilter }: { typeFilter?: BookType }) {
  const books = await getInProgressBooks(undefined, typeFilter);
  if (books.length === 0) return null;
  return <BookCarousel title="Continue Reading" books={books.slice(0, 10)} allowSetAside />;
}

async function ReadNextSection() {
  const items = await getReadNextInSeries();
  if (items.length === 0) return null;
  return <BookCarousel title="Read Next in Series" books={items.slice(0, 10).map((r) => r.book)} />;
}

async function RecentlyAddedSection({ typeFilter }: { typeFilter?: BookType }) {
  const books = await getRecentlyAddedBooks(undefined, typeFilter);
  if (books.length === 0) return null;
  return (
    <BookCarousel
      title="Recently Added"
      books={books.slice(0, 10)}
      seeAllHref="/library?view=grid"
    />
  );
}

async function CuratedDiscoverySections({ typeFilter }: { typeFilter?: BookType }) {
  const profileId = resolveProfileId();
  if (!profileId) return null;
  const curated = await getCuratedDiscovery(profileId);
  const ids = [...new Set(curated.shelves.flatMap((shelf) => shelf.bookIds))];
  const books = await getBooks({ ids, limit: ids.length, profileId, type: typeFilter });
  const booksById = new Map(books.map((book) => [book.id, book]));
  return (
    <CuratedShelfSwitcher
      shelves={curated.shelves.map((shelf) => ({
        ...shelf,
        books: shelf.bookIds.flatMap((id) => {
          const book = booksById.get(id);
          return book ? [book] : [];
        }),
      }))}
    />
  );
}

/**
 * Streamed curated explore view. Rendered on the server and passed into
 * LibraryClient as a slot so each section streams in via its own Suspense
 * boundary instead of the whole page blocking on the slowest query.
 */
export function ExploreSections({ typeFilter }: { typeFilter?: BookType }) {
  return (
    <div className="space-y-10 pb-8">
      <Suspense fallback={<CarouselSkeleton titleWidth="w-40" />}>
        <ContinueReadingSection typeFilter={typeFilter} />
      </Suspense>
      <Suspense fallback={<CarouselSkeleton titleWidth="w-44" />}>
        <ReadNextSection />
      </Suspense>
      <Suspense fallback={<CarouselSkeleton titleWidth="w-44" />}>
        <CuratedDiscoverySections typeFilter={typeFilter} />
      </Suspense>
      <Suspense fallback={<CarouselSkeleton titleWidth="w-36" />}>
        <RecentlyAddedSection typeFilter={typeFilter} />
      </Suspense>
    </div>
  );
}
