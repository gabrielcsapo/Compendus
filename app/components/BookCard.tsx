import { Link } from "react-flight-router/client";
import type { Book } from "../lib/db/schema";
import { AuthorLinks } from "./AuthorLink";
import { getBookType, isConvertibleFormat, getConversionTarget, type BookType } from "../lib/book-types";

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
  return null;
}

function getBadgeStyles(type: BookType, convertible?: boolean): string {
  if (type === "audiobook") {
    return "bg-accent-light text-accent";
  }
  if (convertible) {
    return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
  }
  return "bg-primary-light text-primary";
}

export function BookCard({ book, size = "default" }: BookCardProps) {
  const authors = book.authors ? JSON.parse(book.authors) : [];
  const progressPercent = Math.round((book.readingProgress || 0) * 100);
  const bookType = getBookType(book.format, book.bookTypeOverride);
  const compact = size === "compact";

  return (
    <div className="group relative bg-surface border border-border rounded-xl overflow-hidden transition-all duration-200 hover:shadow-lg hover:-translate-y-1 hover:border-primary/30">
      {/* Cover with quick action overlay */}
      <Link
        to={`/book/${book.id}`}
        className="block aspect-[2/3] w-full overflow-hidden bg-surface-elevated relative"
        style={{ backgroundColor: book.coverColor || undefined }}
      >
        {book.coverPath ? (
          <img
            src={`/covers/${book.id}.jpg?v=${book.updatedAt?.getTime() || ""}`}
            alt={book.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center p-4 bg-gradient-to-br from-primary-light to-accent-light">
            <span className="text-center text-foreground-muted text-sm font-medium line-clamp-4">
              {book.title}
            </span>
          </div>
        )}

        {/* Format badge overlay */}
        {book.convertedEpubPath && isConvertibleFormat(book.format) ? (
          <span className={`absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full uppercase tracking-wide bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 shadow-sm`}>
            <TypeIcon type={bookType} />
            {getConversionTarget(book.format)}
          </span>
        ) : (
          <span className={`absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full uppercase tracking-wide ${getBadgeStyles(bookType, isConvertibleFormat(book.format))} shadow-sm`}>
            <TypeIcon type={bookType} />
            {book.format}
            {isConvertibleFormat(book.format) && (
              <svg className="w-3 h-3 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
          </span>
        )}

      </Link>

      {/* Hover overlay with quick action - positioned absolutely over the card */}
      <div className="absolute inset-0 aspect-[2/3] bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center pointer-events-none">
        <Link
          to={`/book/${book.id}/read`}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg font-medium text-sm hover:bg-primary-hover transition-colors shadow-lg pointer-events-auto"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          {progressPercent > 0 ? "Continue" : "Read"}
        </Link>
      </div>

      {/* Info */}
      <div className={compact ? "p-2" : "p-4"}>
        <Link to={`/book/${book.id}`} className="block">
          <h3 className={`font-semibold line-clamp-2 mb-1 text-foreground ${compact ? "text-xs" : "text-sm"}`}>{book.title}</h3>
          {authors.length > 0 && (
            <p className={`text-foreground-muted line-clamp-1 ${compact ? "text-[10px]" : "text-xs"}`}>
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
              to={`/?series=${encodeURIComponent(book.series)}`}
              className="text-primary hover:text-primary-hover font-medium"
            >
              {book.series}
            </Link>
          </p>
        )}

        {/* Progress bar */}
        {progressPercent > 0 && (
          <div className="mt-2">
            <div className={`bg-surface-elevated rounded-full overflow-hidden ${compact ? "h-1" : "h-1.5"}`}>
              <div
                className="h-full bg-gradient-to-r from-primary to-accent rounded-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {!compact && <p className="text-xs text-foreground-muted mt-1">{progressPercent}%</p>}
          </div>
        )}
      </div>
    </div>
  );
}
