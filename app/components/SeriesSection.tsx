"use client";

import { useState } from "react";
import { Link } from "react-flight-router/client";
import { BookCover } from "./BookCover";
import { addToWantedList, isBookWanted } from "../actions/wanted";
import { findMissingSeriesBooks, type SeriesInfo } from "../actions/series";
import type { MetadataSearchResult } from "../lib/metadata";
import { badgeStyles } from "../lib/styles";

interface Props {
  currentBookId: string;
  details: SeriesInfo;
}

export function SeriesSection({ currentBookId, details }: Props) {
  const [missingBooks, setMissingBooks] = useState<MetadataSearchResult[] | null>(null);
  const [wantedMap, setWantedMap] = useState<Map<string, boolean>>(new Map());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const sortedOwned = [...details.ownedBooks].sort(
    (a, b) => parseFloat(a.seriesNumber || "999") - parseFloat(b.seriesNumber || "999"),
  );

  const sortedWanted = [...details.wantedBooks].sort(
    (a, b) => parseFloat(a.seriesNumber || "999") - parseFloat(b.seriesNumber || "999"),
  );

  const handleFindMissing = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const missing = await findMissingSeriesBooks(details.name);
      setMissingBooks(missing);
      const entries = await Promise.all(
        missing.map(async (book) => {
          const key = `${book.source}:${book.sourceId}`;
          const wanted = await isBookWanted(book);
          return [key, wanted] as const;
        }),
      );
      setWantedMap(new Map(entries));
    } catch {
      setMessage({ type: "error", text: "Failed to search for missing books" });
    } finally {
      setLoading(false);
    }
  };

  const handleAddToWanted = async (result: MetadataSearchResult) => {
    try {
      await addToWantedList(result);
      const key = `${result.source}:${result.sourceId}`;
      setWantedMap((prev) => new Map(prev).set(key, true));
      setMessage({ type: "success", text: `Added "${result.title}" to wanted list` });
    } catch (error) {
      setMessage({ type: "error", text: (error as Error).message });
    }
  };

  return (
    <section className="bg-surface border border-border rounded-xl p-6 shadow-paper">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted mb-4">
        In this series
      </h2>

      {/* Book strip — owned + wanted in series order */}
      <div className="flex gap-3 overflow-x-auto pb-1 mb-4" style={{ scrollbarWidth: "none" }}>
        {sortedOwned.map((book) => {
          const isCurrent = book.id === currentBookId;
          return (
            <Link
              key={book.id}
              to={`/book/${book.id}`}
              className={`flex-none w-20 group ${isCurrent ? "pointer-events-none" : ""}`}
            >
              <div
                className={`aspect-[2/3] rounded-lg overflow-hidden shadow-sm transition-shadow ${
                  isCurrent ? "ring-2 ring-primary ring-offset-2" : "group-hover:shadow-md"
                }`}
              >
                <BookCover
                  book={book}
                  fallback={
                    <div className="w-full h-full bg-surface-elevated flex items-center justify-center text-xs text-foreground-muted font-medium">
                      #{book.seriesNumber ?? "?"}
                    </div>
                  }
                />
              </div>
              {book.seriesNumber && (
                <p
                  className={`text-xs mt-1 text-center ${
                    isCurrent ? "text-primary font-semibold" : "text-foreground-muted"
                  }`}
                >
                  #{book.seriesNumber}
                </p>
              )}
            </Link>
          );
        })}

        {sortedWanted.map((book) => (
          <div key={book.id} className="flex-none w-20">
            <div className="aspect-[2/3] rounded-lg overflow-hidden shadow-sm relative opacity-60">
              {book.coverUrl ? (
                <img src={book.coverUrl} alt={book.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-surface-elevated border border-dashed border-border flex items-center justify-center text-xs text-foreground-muted font-medium">
                  #{book.seriesNumber ?? "?"}
                </div>
              )}
              <div className="absolute bottom-1 left-0 right-0 flex justify-center">
                <span className="text-[9px] px-1.5 py-0.5 bg-warning-light text-warning rounded font-medium">
                  Wanted
                </span>
              </div>
            </div>
            {book.seriesNumber && (
              <p className="text-xs mt-1 text-center text-foreground-muted">#{book.seriesNumber}</p>
            )}
          </div>
        ))}
      </div>

      {/* Message */}
      {message && (
        <div
          className={`mb-3 p-2.5 rounded-lg text-sm border ${
            message.type === "success"
              ? "bg-success-light text-success border-success/20"
              : "bg-danger-light text-danger border-danger/20"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Find missing books */}
      {missingBooks === null ? (
        <button
          onClick={handleFindMissing}
          disabled={loading}
          className="text-sm text-primary hover:text-primary-hover transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          {loading ? (
            <>
              <div className="w-3.5 h-3.5 border border-primary border-t-transparent rounded-full animate-spin" />
              Searching...
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              Find missing books in this series
            </>
          )}
        </button>
      ) : missingBooks.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          No additional books found in external databases.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs font-medium text-foreground-muted uppercase tracking-wider">
            Found ({missingBooks.length})
          </p>
          {missingBooks.map((book, index) => {
            const key = `${book.source}:${book.sourceId}`;
            return (
              <ExternalBookCard
                key={`${key}:${index}`}
                book={book}
                isWanted={wantedMap.get(key) ?? false}
                onAddToWanted={() => handleAddToWanted(book)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function ExternalBookCard({
  book,
  isWanted,
  onAddToWanted,
}: {
  book: MetadataSearchResult;
  isWanted: boolean;
  onAddToWanted: () => void;
}) {
  return (
    <div className="bg-surface-elevated rounded-lg p-3 flex gap-3">
      <div className="w-14 h-20 flex-shrink-0 rounded overflow-hidden bg-surface">
        {book.coverUrl ? (
          <img src={book.coverUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-foreground-muted p-1 text-center">
            No Cover
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium text-sm text-foreground line-clamp-2">{book.title}</h3>
          <span
            className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
              book.source === "googlebooks" ? badgeStyles.primary : badgeStyles.success
            }`}
          >
            {book.source === "googlebooks" ? "Google" : "OpenLib"}
          </span>
        </div>
        {book.authors.length > 0 && (
          <p className="text-xs text-foreground-muted mt-0.5 truncate">{book.authors.join(", ")}</p>
        )}
        {book.series && (
          <p className="text-xs text-primary mt-0.5">
            {book.series}
            {book.seriesNumber && ` #${book.seriesNumber}`}
          </p>
        )}
        <button
          onClick={onAddToWanted}
          disabled={isWanted}
          className={`mt-2 px-2.5 py-1 text-xs rounded-lg transition-colors ${
            isWanted
              ? "bg-surface text-foreground-muted cursor-not-allowed"
              : "bg-primary text-white hover:bg-primary-hover"
          }`}
        >
          {isWanted ? "Already Wanted" : "Add to Wanted"}
        </button>
      </div>
    </div>
  );
}
