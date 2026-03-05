"use client";

import { Link } from "react-flight-router/client";
import type { Book } from "../../lib/db/schema";
import { BookCover } from "../BookCover";

function timeAgo(date: Date | number | null): string {
  if (!date) return "";
  const ms = typeof date === "number" ? date * 1000 : date.getTime();
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function ContinueReadingCarousel({ books }: { books: Book[] }) {
  if (books.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">Continue Reading</h2>
        <span className="text-sm text-foreground-muted">
          {books.length} {books.length === 1 ? "book" : "books"}
        </span>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-3 scrollbar-none -mx-1 px-1">
        {books.map((book) => {
          const progressPercent = Math.round((book.readingProgress || 0) * 100);

          return (
            <Link
              key={book.id}
              to={`/book/${book.id}/read`}
              className="group flex-shrink-0 w-28 transition-transform duration-200 hover:-translate-y-1"
            >
              {/* Cover with progress bar overlay */}
              <div
                className="relative aspect-[2/3] w-full rounded-lg overflow-hidden shadow-md group-hover:shadow-xl transition-shadow duration-200"
                style={{ backgroundColor: book.coverColor || undefined }}
              >
                <BookCover
                  book={book}
                  imgClassName="group-hover:scale-105 transition-transform duration-300"
                  fallback={
                    <div className="w-full h-full flex items-center justify-center p-2 bg-gradient-to-br from-primary-light to-accent-light">
                      <span className="text-center text-foreground-muted text-xs font-medium line-clamp-3">
                        {book.title}
                      </span>
                    </div>
                  }
                />

                {/* Progress bar at bottom of cover */}
                {progressPercent > 0 && (
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/30">
                    <div
                      className="h-full bg-primary rounded-r-full"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                )}

                {/* Progress percent badge */}
                <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 bg-black/70 text-white text-[10px] font-medium rounded-full">
                  {progressPercent}%
                </div>
              </div>

              {/* Title and meta */}
              <div className="mt-2 px-0.5">
                <h3 className="text-xs font-medium text-foreground line-clamp-2 leading-tight">
                  {book.title}
                </h3>
                {book.lastReadAt && (
                  <p className="text-[10px] text-foreground-muted mt-0.5">
                    {timeAgo(book.lastReadAt)}
                  </p>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
