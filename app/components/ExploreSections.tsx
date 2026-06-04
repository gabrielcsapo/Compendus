import { Suspense } from "react";
import { BookCarousel } from "./BookCarousel";
import { CarouselSkeleton } from "./CarouselSkeleton";
import {
  getInProgressBooks,
  getRecentlyAddedBooks,
  getTopSeriesSections,
  getTopTagsSections,
  getReadNextInSeries,
  getStaleReads,
  getMoreByAuthor,
  getGenreSections,
} from "../actions/explore";
import type { BookType } from "../lib/book-types";

// Each section is its own async server component awaiting only its own data,
// wrapped in a Suspense boundary so it streams in independently. Cheap,
// above-the-fold rows (Continue Reading) paint before the expensive
// genre/series/tag queries finish.

async function ContinueReadingSection({ typeFilter }: { typeFilter?: BookType }) {
  const books = await getInProgressBooks(undefined, typeFilter);
  if (books.length === 0) return null;
  return <BookCarousel title="Continue Reading" books={books} />;
}

async function ReadNextSection() {
  const items = await getReadNextInSeries();
  if (items.length === 0) return null;
  return <BookCarousel title="Read Next in Series" books={items.map((r) => r.book)} />;
}

async function FinishTheseSection() {
  const books = await getStaleReads();
  if (books.length === 0) return null;
  return <BookCarousel title="Finish These?" books={books} />;
}

async function RecentlyAddedSection({ typeFilter }: { typeFilter?: BookType }) {
  const books = await getRecentlyAddedBooks(undefined, typeFilter);
  if (books.length === 0) return null;
  return <BookCarousel title="Recently Added" books={books} seeAllHref="/library?view=grid" />;
}

async function MoreByAuthorSection() {
  const groups = await getMoreByAuthor();
  if (groups.length === 0) return null;
  return (
    <>
      {groups.map((authorGroup) => (
        <BookCarousel
          key={authorGroup.author}
          title={`More by ${authorGroup.author}`}
          books={authorGroup.books}
        />
      ))}
    </>
  );
}

async function GenresSection() {
  const sections = await getGenreSections();
  if (sections.length === 0) return null;
  return (
    <>
      {sections.map((genre) => (
        <BookCarousel
          key={genre.subject}
          title={genre.subject.replace(/\b\w/g, (c) => c.toUpperCase())}
          books={genre.books}
        />
      ))}
    </>
  );
}

async function TopSeriesSection() {
  const series = await getTopSeriesSections();
  if (series.length === 0) return null;
  return (
    <>
      {series.map((s) => (
        <BookCarousel
          key={s.name}
          title={s.name}
          books={s.books}
          seeAllHref={`/library?series=${encodeURIComponent(s.name)}&view=grid`}
        />
      ))}
    </>
  );
}

async function TopTagsSection() {
  const tags = await getTopTagsSections();
  if (tags.length === 0) return null;
  return (
    <>
      {tags.map((tag) => (
        <BookCarousel
          key={tag.id}
          title={tag.name.charAt(0).toUpperCase() + tag.name.slice(1)}
          books={tag.books}
          seeAllHref="/tags"
        />
      ))}
    </>
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
      <Suspense fallback={<CarouselSkeleton titleWidth="w-32" />}>
        <FinishTheseSection />
      </Suspense>
      <Suspense fallback={<CarouselSkeleton titleWidth="w-36" />}>
        <RecentlyAddedSection typeFilter={typeFilter} />
      </Suspense>
      <Suspense fallback={<CarouselSkeleton titleWidth="w-48" />}>
        <MoreByAuthorSection />
      </Suspense>
      <Suspense fallback={<CarouselSkeleton titleWidth="w-40" />}>
        <GenresSection />
      </Suspense>
      <Suspense fallback={<CarouselSkeleton titleWidth="w-44" />}>
        <TopSeriesSection />
      </Suspense>
      <Suspense fallback={<CarouselSkeleton titleWidth="w-36" />}>
        <TopTagsSection />
      </Suspense>
    </div>
  );
}
