"use client";

import { BookCarousel } from "./BookCarousel";
import { EmptyLibrary } from "./EmptyLibrary";
import type { ExploreData } from "../actions/explore";

export function LibraryExploreView({ data }: { data: ExploreData }) {
  const {
    inProgress,
    readNextInSeries,
    staleReads,
    recentlyAdded,
    moreByAuthor,
    genreSections,
    topSeries,
    topTags,
  } = data;

  const hasContent =
    inProgress.length > 0 ||
    readNextInSeries.length > 0 ||
    staleReads.length > 0 ||
    recentlyAdded.length > 0 ||
    moreByAuthor.length > 0 ||
    genreSections.length > 0 ||
    topSeries.length > 0 ||
    topTags.length > 0;

  if (!hasContent) {
    return <EmptyLibrary />;
  }

  return (
    <div className="space-y-10 pb-8">
      {inProgress.length > 0 && <BookCarousel title="Continue Reading" books={inProgress} />}

      {readNextInSeries.length > 0 && (
        <BookCarousel title="Read Next in Series" books={readNextInSeries.map((r) => r.book)} />
      )}

      {staleReads.length > 0 && <BookCarousel title="Finish These?" books={staleReads} />}

      {recentlyAdded.length > 0 && (
        <BookCarousel
          title="Recently Added"
          books={recentlyAdded}
          seeAllHref="/library?view=grid"
        />
      )}

      {moreByAuthor.map((authorGroup) => (
        <BookCarousel
          key={authorGroup.author}
          title={`More by ${authorGroup.author}`}
          books={authorGroup.books}
        />
      ))}

      {genreSections.map((genre) => (
        <BookCarousel
          key={genre.subject}
          title={genre.subject.replace(/\b\w/g, (c) => c.toUpperCase())}
          books={genre.books}
        />
      ))}

      {topSeries.map((series) => (
        <BookCarousel
          key={series.name}
          title={series.name}
          books={series.books}
          seeAllHref={`/library?series=${encodeURIComponent(series.name)}&view=grid`}
        />
      ))}

      {topTags.map((tag) => (
        <BookCarousel
          key={tag.id}
          title={tag.name.charAt(0).toUpperCase() + tag.name.slice(1)}
          books={tag.books}
          seeAllHref="/tags"
        />
      ))}
    </div>
  );
}
