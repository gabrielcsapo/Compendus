"use client";

import { useState, useEffect } from "react";
import { Link } from "react-router";
import { searchMetadata, applyMetadata } from "../actions/books";
import type { Book } from "../lib/db/schema";
import type { MetadataSearchResult } from "../lib/metadata";

interface UnmatchedBookCardProps {
  book: Book;
  position: number;
  total: number;
}

export function UnmatchedBookCard({ book, position, total }: UnmatchedBookCardProps) {
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<MetadataSearchResult[]>([]);
  const [searchQuery, setSearchQuery] = useState(book.title);
  const [message, setMessage] = useState<string | null>(null);
  const [matched, setMatched] = useState(false);

  const authors = book.authors ? JSON.parse(book.authors) : [];

  // Auto-search on mount
  useEffect(() => {
    handleSearch();
  }, []);

  const handleSearch = async () => {
    setSearching(true);
    setMessage(null);

    try {
      const results = await searchMetadata(searchQuery, authors[0]);
      setSearchResults(results);
      if (results.length === 0) {
        setMessage("No results found. Try different search terms.");
      }
    } catch (error) {
      setMessage(`Search failed: ${(error as Error).message}`);
    } finally {
      setSearching(false);
    }
  };

  const handleApply = async (metadata: MetadataSearchResult) => {
    setLoading(true);
    setMessage(null);

    try {
      const result = await applyMetadata(book.id, metadata);
      if (result.success) {
        setMatched(true);
        setMessage("Matched successfully!");
      } else {
        setMessage(result.message);
      }
    } catch (error) {
      setMessage("Failed to apply metadata");
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    setMatched(true);
    setMessage("Skipped - you can match this book later from its detail page.");
  };

  if (matched) {
    return (
      <div className="bg-surface border border-border rounded-xl p-6 opacity-60">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-success-light flex items-center justify-center">
            <svg
              className="w-6 h-6 text-success"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <div>
            <p className="font-medium text-foreground">{book.title}</p>
            <p className="text-sm text-foreground-muted">{message}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="bg-surface-elevated px-6 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-foreground-muted">
            {position} of {total}
          </span>
          <span className="inline-block px-2 py-0.5 text-xs font-medium rounded bg-primary-light text-primary uppercase">
            {book.format}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/book/${book.id}`} className="text-sm text-primary hover:text-primary-hover">
            View Details
          </Link>
          <button
            onClick={handleSkip}
            className="text-sm text-foreground-muted hover:text-foreground"
          >
            Skip
          </button>
        </div>
      </div>

      <div className="p-6">
        <div className="grid md:grid-cols-[200px_1fr] gap-6">
          {/* Book info */}
          <div>
            <div
              className="aspect-[2/3] w-full overflow-hidden rounded-lg bg-gradient-to-br from-primary-light to-accent-light flex items-center justify-center p-4"
              style={{ backgroundColor: book.coverColor || undefined }}
            >
              <span className="text-center text-foreground-muted text-sm font-medium">
                {book.title}
              </span>
            </div>
            <h3 className="font-semibold text-foreground mt-3 line-clamp-2">{book.title}</h3>
            {authors.length > 0 && (
              <p className="text-sm text-foreground-muted mt-1">{authors.join(", ")}</p>
            )}
          </div>

          {/* Search and results */}
          <div>
            {/* Search bar */}
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by title..."
                className="flex-1 px-3 py-2 border border-border rounded-lg bg-background text-foreground"
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <button onClick={handleSearch} disabled={searching} className="btn btn-primary">
                {searching ? "..." : "Search"}
              </button>
            </div>

            {message && <p className="text-sm text-foreground-muted mb-4">{message}</p>}

            {/* Results */}
            {searching ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : searchResults.length > 0 ? (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {searchResults.map((result, index) => (
                  <div
                    key={index}
                    onClick={() => !loading && handleApply(result)}
                    className={`p-3 border border-border rounded-lg hover:bg-surface-elevated cursor-pointer transition-colors ${
                      loading ? "opacity-50 pointer-events-none" : ""
                    }`}
                  >
                    <div className="flex gap-3">
                      {(result.coverUrlHQ || result.coverUrl) && (
                        <img
                          src={result.coverUrlHQ || result.coverUrl || ""}
                          alt=""
                          className="w-10 h-14 object-cover rounded shadow-sm flex-shrink-0"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-foreground truncate text-sm">
                            {result.title}
                          </h4>
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                              result.source === "googlebooks"
                                ? "badge-primary"
                                : "badge-success"
                            }`}
                          >
                            {result.source === "googlebooks" ? "Google" : "OpenLib"}
                          </span>
                        </div>
                        {result.authors.length > 0 && (
                          <p className="text-xs text-foreground-muted truncate">
                            {result.authors.join(", ")}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-0.5">
                          {result.publishedDate && (
                            <span className="text-xs text-foreground-muted">
                              {result.publishedDate}
                            </span>
                          )}
                          {result.pageCount && (
                            <span className="text-xs text-foreground-muted">
                              {result.pageCount} pages
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center py-8 text-foreground-muted">
                Search for metadata to match this book
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
