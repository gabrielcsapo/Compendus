"use client";

import { useRef, useState } from "react";
import { Link, useRouter } from "react-flight-router/client";
import { BookCover } from "./BookCover";
import { BookObject } from "./BookObject";
import { useToast } from "./ToastContext";
import { setBookAside } from "../actions/books";
import type { BookWithState } from "../actions/books";
import { getBookType } from "../lib/book-types";

interface BookCarouselProps {
  title: string;
  subtitle?: string;
  reasons?: Record<string, string>;
  books: BookWithState[];
  seeAllHref?: string;
  allowSetAside?: boolean;
}

export function BookCarousel({
  title,
  subtitle,
  reasons,
  books,
  seeAllHref,
  allowSetAside = false,
}: BookCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { showToast } = useToast();
  const [settingAsideId, setSettingAsideId] = useState<string | null>(null);
  const [hiddenBookIds, setHiddenBookIds] = useState<Set<string>>(() => new Set());
  const visibleBooks = allowSetAside ? books.filter((book) => !hiddenBookIds.has(book.id)) : books;

  const handleSetAside = async (book: BookWithState) => {
    if (settingAsideId) return;
    setSettingAsideId(book.id);
    try {
      const result = await setBookAside(book.id, true);
      if (!result) throw new Error("Set aside is unavailable without an active profile");
      setHiddenBookIds((current) => new Set(current).add(book.id));
      showToast(`Set aside “${book.title}”. Return it from the book page anytime.`, "info");
      await router.refresh();
    } catch {
      showToast(`Couldn't set aside “${book.title}”. Try again.`, "error");
    } finally {
      setSettingAsideId(null);
    }
  };

  if (visibleBooks.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-2xl font-bold tracking-[-0.035em] text-foreground">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-foreground-muted">{subtitle}</p>}
        </div>
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
        className="-mx-5 -mt-6 flex gap-4 overflow-x-auto px-5 pb-6 pt-6"
        style={{ scrollbarWidth: "none" }}
      >
        {visibleBooks.map((book) => {
          const progressPercent = Math.round((book.readingProgress || 0) * 100);
          let authors: string[] = [];
          try {
            authors = book.authors ? JSON.parse(book.authors) : [];
          } catch {}

          return (
            <article
              key={book.id}
              className="group relative w-[clamp(9.5rem,14vw,12rem)] flex-none"
            >
              <Link to={`/book/${book.id}`} className="block">
                <BookObject
                  type={getBookType(book.format, book.bookTypeOverride)}
                  style={{ backgroundColor: book.coverColor || undefined }}
                >
                  <BookCover book={book} />
                </BookObject>
                <p className="mt-2 line-clamp-2 text-sm font-semibold leading-tight text-foreground transition-colors group-hover:text-primary">
                  {book.title}
                </p>
                {authors.length > 0 && (
                  <p className="text-[10px] text-foreground-muted mt-0.5 line-clamp-1">
                    {authors[0]}
                  </p>
                )}
                {reasons?.[book.id] && (
                  <p className="mt-1 text-[10px] leading-snug text-primary line-clamp-3">
                    {reasons[book.id]}
                  </p>
                )}
                {progressPercent > 0 && (
                  <div className="mt-1.5 h-0.5 bg-surface-elevated rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                )}
              </Link>
              {allowSetAside && (
                <button
                  type="button"
                  onClick={() => handleSetAside(book)}
                  disabled={settingAsideId !== null}
                  className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/65 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-wait disabled:opacity-60"
                  title="Set aside"
                  aria-label={`Set aside ${book.title}`}
                >
                  {settingAsideId === book.id ? (
                    <span
                      className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
                      aria-hidden="true"
                    />
                  ) : (
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 8h14M9 12h6m-9 8h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                  )}
                </button>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
