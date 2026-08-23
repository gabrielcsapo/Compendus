import { Link } from "react-flight-router/client";
import type { BookWithState } from "../actions/books";
import { BookCover } from "./BookCover";
import { BookObject } from "./BookObject";
import { getBookType } from "../lib/book-types";

export function ContinueReadingHero({ book }: { book: BookWithState }) {
  let authors: string[] = [];
  try {
    const parsed = book.authors ? JSON.parse(book.authors) : [];
    authors = Array.isArray(parsed)
      ? parsed.filter((author): author is string => typeof author === "string")
      : [];
  } catch {
    authors = [];
  }

  const progressPercent = Math.max(1, Math.round((book.readingProgress || 0) * 100));

  return (
    <section className="relative overflow-hidden rounded-[1.65rem] bg-[#e8efeb] p-5 text-[#17201c] shadow-[0_1px_2px_rgba(23,32,28,.04)] dark:bg-[#18251f] dark:text-[#eef3ef] sm:p-8">
      <div className="absolute inset-y-0 left-0 w-1.5 bg-accent" aria-hidden="true" />
      <div className="grid items-center gap-6 sm:grid-cols-[10rem_minmax(0,1fr)] lg:grid-cols-[12rem_minmax(0,1fr)_15rem] lg:gap-9">
        <Link
          to={`/book/${book.id}`}
          className="mx-auto block w-32 sm:w-40 lg:w-48"
          aria-label={`Open ${book.title}`}
        >
          <BookObject
            type={getBookType(book.format, book.bookTypeOverride)}
            surfaceClassName="bg-white"
          >
            <BookCover book={book} />
          </BookObject>
        </Link>

        <div className="min-w-0">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/65 px-3 py-1.5 text-xs font-semibold text-[#245c49] dark:bg-white/10 dark:text-[#b8ddcf]">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 4h12v17l-6-4-6 4V4Z"
              />
            </svg>
            Continue reading
          </p>
          <h2 className="reading-title text-3xl leading-[1.04] tracking-[-0.045em] sm:text-4xl lg:text-5xl">
            {book.title}
          </h2>
          {authors.length > 0 && <p className="mt-2 text-base opacity-65">{authors.join(", ")}</p>}

          <div className="mt-6 flex max-w-lg items-center gap-3 text-xs opacity-65">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-[#cdd9d2] dark:bg-white/12">
              <div
                className="h-full rounded-full bg-[#356b56] dark:bg-[#9ccab8]"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="font-semibold tabular-nums">{progressPercent}%</span>
          </div>

          <div className="mt-6 flex flex-wrap gap-2.5">
            <Link
              to={`/book/${book.id}/read`}
              className="inline-flex items-center gap-2 rounded-xl bg-[#356b56] px-5 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#245c49] dark:bg-[#9ccab8] dark:text-[#102019] dark:hover:bg-[#b8ddcf]"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 4h12v17l-6-4-6 4V4Z"
                />
              </svg>
              Keep reading
            </Link>
            <Link
              to={`/book/${book.id}`}
              className="inline-flex items-center rounded-xl border border-black/8 bg-white/75 px-5 py-3 text-sm font-semibold transition-colors hover:bg-white dark:border-white/10 dark:bg-white/8 dark:hover:bg-white/12"
            >
              Book details
            </Link>
          </div>
        </div>

        <aside className="hidden border-l border-[#245c49]/12 pl-7 lg:block dark:border-white/10">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] opacity-55">Your place</p>
          <div className="mt-4 border-t border-[#245c49]/12 pt-4 dark:border-white/10">
            <p className="text-sm font-semibold">Resume where you stopped</p>
            <p className="mt-1 text-xs leading-relaxed opacity-55">
              Your progress and reading settings stay with this book.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
