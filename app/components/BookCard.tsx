import { Link } from "react-router";
import type { Book } from "../lib/db/schema";
import { AuthorLinks } from "./AuthorLink";

interface BookCardProps {
  book: Book;
}

export function BookCard({ book }: BookCardProps) {
  const authors = book.authors ? JSON.parse(book.authors) : [];
  const progressPercent = Math.round((book.readingProgress || 0) * 100);

  return (
    <Link
      to={`/book/${book.id}`}
      className="group block bg-surface border border-border rounded-xl overflow-hidden transition-all duration-200 hover:shadow-lg hover:-translate-y-1 hover:border-primary/30"
    >
      {/* Cover */}
      <div
        className="aspect-[2/3] w-full overflow-hidden bg-surface-elevated"
        style={{ backgroundColor: book.coverColor || undefined }}
      >
        {book.coverPath ? (
          <img
            src={`/covers/${book.id}.jpg`}
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
      </div>

      {/* Info */}
      <div className="p-4">
        <h3 className="font-semibold text-sm line-clamp-2 mb-1 text-foreground">{book.title}</h3>
        {authors.length > 0 && (
          <p className="text-xs text-foreground-muted line-clamp-1">
            <AuthorLinks authors={authors} asSpan />
          </p>
        )}

        {/* Progress bar */}
        {progressPercent > 0 && (
          <div className="mt-3">
            <div className="h-1.5 bg-surface-elevated rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary to-accent rounded-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className="text-xs text-foreground-muted mt-1.5">{progressPercent}%</p>
          </div>
        )}

        {/* Format badge */}
        <div className="mt-3">
          <span className="inline-block px-2.5 py-1 text-xs font-medium rounded-full bg-primary-light text-primary uppercase tracking-wide">
            {book.format}
          </span>
        </div>
      </div>
    </Link>
  );
}
