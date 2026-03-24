"use client";

import { BookCarousel } from "./BookCarousel";
import type { ExploreData } from "../actions/explore";

export function LibraryExploreView({ data }: { data: ExploreData }) {
  const { inProgress, recentlyAdded, topSeries, topTags } = data;

  const hasContent =
    inProgress.length > 0 || recentlyAdded.length > 0 || topSeries.length > 0 || topTags.length > 0;

  if (!hasContent) {
    return (
      <div className="text-center py-16 px-6">
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
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
            />
          </svg>
        </div>
        <p className="text-foreground-muted">Your library is empty.</p>
        <p className="text-foreground-muted/60 text-sm mt-1">Drop some books to get started!</p>
      </div>
    );
  }

  return (
    <div className="space-y-10 pb-8">
      {inProgress.length > 0 && <BookCarousel title="Continue Reading" books={inProgress} />}

      {recentlyAdded.length > 0 && (
        <BookCarousel
          title="Recently Added"
          books={recentlyAdded}
          seeAllHref="/library?view=grid"
        />
      )}

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
