import { memo, useMemo } from "react";
import { Link } from "react-flight-router/client";
import type { Book } from "../lib/db/schema";
import { AuthorLinks } from "./AuthorLink";
import { BookCover } from "./BookCover";
import { BookObject } from "./BookObject";
import {
  getBookType,
  isConvertibleFormat,
  getConversionTarget,
  type BookType,
} from "../lib/book-types";

interface BookCardProps {
  book: Book;
  size?: "default" | "compact";
}

function TypeIcon({ type }: { type: BookType }) {
  if (type === "audiobook") {
    return (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15.536a5 5 0 001.414 1.414m2.828-9.9a9 9 0 012.828-2.828"
        />
        <circle cx="12" cy="17" r="1.5" strokeWidth={2} />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15.5V9" />
      </svg>
    );
  }
  if (type === "comic") {
    return (
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <rect x="4" y="4" width="16" height="16" rx="2" strokeWidth={2} />
        <path strokeLinecap="round" strokeWidth={2} d="M12 4v16M4 12h16" />
      </svg>
    );
  }
  return null;
}

function formatDuration(seconds: number): string {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function getCoverMeta(book: Book, type: BookType): string | null {
  if (type === "audiobook" && book.duration && book.duration > 0) {
    return formatDuration(book.duration);
  }
  if (type === "comic" && book.pageCount && book.pageCount > 0) {
    return `${book.pageCount} pages`;
  }
  return null;
}

const embeddedLabelShadow = {
  textShadow: "0 1px 3px rgba(0, 0, 0, 0.95), 0 0 8px rgba(0, 0, 0, 0.72)",
};

export const BookCard = memo(function BookCard({ book, size = "default" }: BookCardProps) {
  const authors = useMemo(() => (book.authors ? JSON.parse(book.authors) : []), [book.authors]);
  const progressPercent = Math.round((book.readingProgress || 0) * 100);
  const bookType = getBookType(book.format, book.bookTypeOverride);
  const compact = size === "compact";
  const coverMeta = getCoverMeta(book, bookType);
  const hasEmbeddedFormatLabel = bookType === "audiobook" || bookType === "comic";

  return (
    <article className="book-card group relative z-0 min-w-0 hover:z-20 focus-within:z-20">
      {/* BookObject owns the type-gated physical hover behavior. */}
      <Link to={`/book/${book.id}`} className="relative block w-full">
        <BookObject type={bookType} style={{ backgroundColor: book.coverColor || undefined }}>
          <BookCover book={book} />

          {/* Option C treats format metadata as part of the jacket, not a floating badge. */}
          {hasEmbeddedFormatLabel ? (
            <span
              className="absolute right-3 top-3 z-20 inline-flex items-center gap-1 text-[9px] font-extrabold uppercase tracking-[0.15em] text-white"
              style={embeddedLabelShadow}
            >
              <TypeIcon type={bookType} />
              {bookType === "audiobook"
                ? "Audio"
                : book.seriesNumber
                  ? `Issue ${book.seriesNumber}`
                  : "Comic"}
            </span>
          ) : book.convertedEpubPath && isConvertibleFormat(book.format) ? (
            <span className="absolute right-2 top-2 z-20 inline-flex items-center rounded-full bg-black/55 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-white shadow-sm backdrop-blur-md">
              {getConversionTarget(book.format)}
            </span>
          ) : null}

          {coverMeta && (
            <span
              className="absolute bottom-3 right-3 z-20 text-[9px] font-bold tracking-[0.08em] text-white tabular-nums"
              style={embeddedLabelShadow}
            >
              {coverMeta}
            </span>
          )}

          {/* Read badge */}
          {book.isRead && (
            <span
              className="absolute left-2 top-2 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-success text-white shadow-sm"
              title="Read"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={3}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </span>
          )}
        </BookObject>
      </Link>

      {/* Info */}
      <div className={compact ? "px-0.5 pt-2" : "px-0.5 pb-2 pt-3"}>
        <Link to={`/book/${book.id}`} className="block">
          <h3
            className={`mb-1 line-clamp-2 font-semibold leading-snug text-foreground transition-colors group-hover:text-primary ${compact ? "text-xs" : "text-[13px]"}`}
          >
            {book.title}
          </h3>
          {authors.length > 0 && (
            <p
              className={`text-foreground-muted line-clamp-1 ${compact ? "text-[10px]" : "text-xs"}`}
            >
              <AuthorLinks authors={authors} asSpan />
            </p>
          )}
        </Link>

        {book.series && (
          <p className={`line-clamp-1 ${compact ? "text-[10px]" : "text-xs"}`}>
            {!compact && book.seriesNumber && (
              <span className="text-foreground-muted">#{book.seriesNumber} in </span>
            )}
            <Link
              to={`/library?series=${encodeURIComponent(book.series)}`}
              className="text-primary hover:text-primary-hover font-medium"
            >
              {book.series}
            </Link>
          </p>
        )}

        {/* Progress bar */}
        {progressPercent > 0 && (
          <div className="mt-2">
            <div
              className={`bg-surface-elevated rounded-full overflow-hidden ${compact ? "h-1" : "h-1"}`}
            >
              <div
                className="h-full bg-accent rounded-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {!compact && (
              <p className="mt-1 text-[10px] font-medium text-foreground-muted">
                {progressPercent}% read
              </p>
            )}
          </div>
        )}

        {/* Star rating */}
        {!compact && book.rating != null && (
          <div className="flex items-center gap-0.5 mt-1.5">
            {[1, 2, 3, 4, 5].map((star) => (
              <svg
                key={star}
                className={`w-3 h-3 ${star <= book.rating! ? "text-amber-400" : "text-foreground-muted/20"}`}
                fill={star <= book.rating! ? "currentColor" : "none"}
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                />
              </svg>
            ))}
          </div>
        )}
      </div>
    </article>
  );
});
