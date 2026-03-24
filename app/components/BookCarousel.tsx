"use client";

import { useRef } from "react";
import { Link } from "react-flight-router/client";
import { BookCover } from "./BookCover";
import type { BookWithState } from "../actions/books";

interface BookCarouselProps {
  title: string;
  books: BookWithState[];
  seeAllHref?: string;
}

export function BookCarousel({ title, books, seeAllHref }: BookCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  if (books.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        <div className="flex items-center gap-2">
          {seeAllHref && (
            <Link
              to={seeAllHref}
              className="text-sm text-primary hover:text-primary-hover transition-colors"
            >
              See all
            </Link>
          )}
          <div className="flex gap-1">
            <button
              onClick={() => scrollRef.current?.scrollBy({ left: -288, behavior: "smooth" })}
              className="w-7 h-7 rounded-full bg-surface-elevated border border-border flex items-center justify-center text-foreground-muted hover:text-foreground transition-colors"
              aria-label="Scroll left"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <button
              onClick={() => scrollRef.current?.scrollBy({ left: 288, behavior: "smooth" })}
              className="w-7 h-7 rounded-full bg-surface-elevated border border-border flex items-center justify-center text-foreground-muted hover:text-foreground transition-colors"
              aria-label="Scroll right"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto pb-1"
        style={{ scrollbarWidth: "none" }}
      >
        {books.map((book) => {
          const progressPercent = Math.round((book.readingProgress || 0) * 100);
          let authors: string[] = [];
          try {
            authors = book.authors ? JSON.parse(book.authors) : [];
          } catch {}

          return (
            <Link key={book.id} to={`/book/${book.id}`} className="flex-none w-28 group">
              <div
                className="aspect-[2/3] rounded-lg overflow-hidden shadow-sm group-hover:shadow-md transition-shadow"
                style={{ backgroundColor: book.coverColor || undefined }}
              >
                <BookCover
                  book={book}
                  imgClassName="group-hover:scale-105 transition-transform duration-300"
                />
              </div>
              <p className="text-xs font-medium text-foreground mt-1.5 line-clamp-2 leading-tight">
                {book.title}
              </p>
              {authors.length > 0 && (
                <p className="text-[10px] text-foreground-muted mt-0.5 line-clamp-1">
                  {authors[0]}
                </p>
              )}
              {progressPercent > 0 && (
                <div className="mt-1.5 h-0.5 bg-surface-elevated rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
