"use client";

import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router";
import { getUnmatchedBooks, getUnmatchedBooksCount, searchMetadata, applyMetadata, skipBookMatch } from "../actions/books";
import type { Book } from "../lib/db/schema";
import type { MetadataSearchResult } from "../lib/metadata";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function UnmatchedBooks() {
  const [currentBook, setCurrentBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [totalRemaining, setTotalRemaining] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);

  // Search state
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<MetadataSearchResult[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const loadNextBook = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    setSearchResults([]);

    try {
      const [books, count] = await Promise.all([
        getUnmatchedBooks(1),
        getUnmatchedBooksCount(),
      ]);

      if (books.length > 0) {
        setCurrentBook(books[0]);
        setSearchQuery(books[0].title);
      } else {
        setCurrentBook(null);
      }
      setTotalRemaining(count);
    } catch (error) {
      setMessage("Failed to load book");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load first book on mount
  useEffect(() => {
    loadNextBook();
  }, [loadNextBook]);

  // Auto-search when book changes
  useEffect(() => {
    if (currentBook && searchQuery) {
      handleSearch();
    }
  }, [currentBook?.id]);

  const handleSearch = async () => {
    if (!currentBook) return;

    setSearching(true);
    setMessage(null);

    try {
      const authors = currentBook.authors ? JSON.parse(currentBook.authors) : [];
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
    if (!currentBook) return;

    setApplying(true);
    setMessage(null);

    try {
      const result = await applyMetadata(currentBook.id, metadata);
      if (result.success) {
        setProcessedCount((prev) => prev + 1);
        // Move to next book
        await loadNextBook();
      } else {
        setMessage(result.message);
      }
    } catch (error) {
      setMessage("Failed to apply metadata");
    } finally {
      setApplying(false);
    }
  };

  const handleSkip = async () => {
    if (!currentBook) return;
    await skipBookMatch(currentBook.id);
    setProcessedCount((prev) => prev + 1);
    await loadNextBook();
  };

  // All done state
  if (!loading && !currentBook && totalRemaining === 0) {
    return (
      <main className="container my-8 px-6 mx-auto">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Link
                to="/"
                className="text-primary hover:text-primary-hover transition-colors"
              >
                &larr; Library
              </Link>
            </div>
            <h1 className="text-2xl font-bold text-foreground">Unmatched Books</h1>
          </div>
        </div>

        <div className="text-center py-16">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-success-light flex items-center justify-center">
            <svg
              className="w-8 h-8 text-success"
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
          <h2 className="text-xl font-semibold text-foreground mb-2">All caught up!</h2>
          <p className="text-foreground-muted mb-2">
            All your books have cover images. Nice work!
          </p>
          {processedCount > 0 && (
            <p className="text-sm text-foreground-muted mb-6">
              You processed {processedCount} {processedCount === 1 ? "book" : "books"} this session.
            </p>
          )}
          <Link to="/" className="btn btn-primary">
            Back to Library
          </Link>
        </div>
      </main>
    );
  }

  const authors = currentBook?.authors ? JSON.parse(currentBook.authors) : [];

  return (
    <main className="container my-8 px-6 mx-auto max-w-4xl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link
              to="/"
              className="text-primary hover:text-primary-hover transition-colors"
            >
              &larr; Library
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Unmatched Books</h1>
          <p className="text-foreground-muted">
            {totalRemaining} {totalRemaining === 1 ? "book" : "books"} remaining
            {processedCount > 0 && ` · ${processedCount} processed`}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : currentBook ? (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          {/* Header */}
          <div className="bg-surface-elevated px-6 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="inline-block px-2 py-0.5 text-xs font-medium rounded bg-primary-light text-primary uppercase">
                {currentBook.format}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Link
                to={`/book/${currentBook.id}`}
                className="text-sm text-primary hover:text-primary-hover"
              >
                View Details
              </Link>
              <button
                onClick={handleSkip}
                disabled={applying}
                className="text-sm text-foreground-muted hover:text-foreground disabled:opacity-50"
              >
                Skip →
              </button>
            </div>
          </div>

          <div className="p-6">
            <div className="grid md:grid-cols-[280px_1fr] gap-6">
              {/* Book info */}
              <div>
                <div
                  className="aspect-[2/3] w-full max-w-[200px] overflow-hidden rounded-lg bg-gradient-to-br from-primary-light to-accent-light flex items-center justify-center p-4"
                  style={{ backgroundColor: currentBook.coverColor || undefined }}
                >
                  <span className="text-center text-foreground-muted text-sm font-medium">
                    {currentBook.title}
                  </span>
                </div>
                <h3 className="font-semibold text-foreground mt-3 line-clamp-2">
                  {currentBook.title}
                </h3>
                {currentBook.subtitle && (
                  <p className="text-sm text-foreground-muted mt-1 italic">
                    {currentBook.subtitle}
                  </p>
                )}
                {authors.length > 0 && (
                  <p className="text-sm text-foreground-muted mt-1">
                    by {authors.join(", ")}
                  </p>
                )}

                {/* File details */}
                <div className="mt-4 pt-4 border-t border-border space-y-2">
                  <h4 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">File Details</h4>
                  <div className="text-xs space-y-1">
                    <p className="text-foreground-muted">
                      <span className="text-foreground">Filename:</span>{" "}
                      <span className="break-all">{currentBook.fileName}</span>
                    </p>
                    <p className="text-foreground-muted">
                      <span className="text-foreground">Location:</span>{" "}
                      <span className="break-all">{currentBook.filePath}</span>
                    </p>
                    <p className="text-foreground-muted">
                      <span className="text-foreground">Size:</span>{" "}
                      {formatFileSize(currentBook.fileSize)}
                    </p>
                  </div>
                </div>

                {/* Existing metadata */}
                {(currentBook.isbn || currentBook.isbn13 || currentBook.isbn10 ||
                  currentBook.publisher || currentBook.publishedDate ||
                  currentBook.pageCount || currentBook.language ||
                  currentBook.series) && (
                  <div className="mt-4 pt-4 border-t border-border space-y-2">
                    <h4 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">Existing Metadata</h4>
                    <div className="text-xs space-y-1">
                      {(currentBook.isbn || currentBook.isbn13 || currentBook.isbn10) && (
                        <p className="text-foreground-muted">
                          <span className="text-foreground">ISBN:</span>{" "}
                          {currentBook.isbn13 || currentBook.isbn10 || currentBook.isbn}
                        </p>
                      )}
                      {currentBook.publisher && (
                        <p className="text-foreground-muted">
                          <span className="text-foreground">Publisher:</span>{" "}
                          {currentBook.publisher}
                        </p>
                      )}
                      {currentBook.publishedDate && (
                        <p className="text-foreground-muted">
                          <span className="text-foreground">Published:</span>{" "}
                          {currentBook.publishedDate}
                        </p>
                      )}
                      {currentBook.pageCount && (
                        <p className="text-foreground-muted">
                          <span className="text-foreground">Pages:</span>{" "}
                          {currentBook.pageCount}
                        </p>
                      )}
                      {currentBook.language && (
                        <p className="text-foreground-muted">
                          <span className="text-foreground">Language:</span>{" "}
                          {currentBook.language}
                        </p>
                      )}
                      {currentBook.series && (
                        <p className="text-foreground-muted">
                          <span className="text-foreground">Series:</span>{" "}
                          {currentBook.series}
                          {currentBook.seriesNumber && ` #${currentBook.seriesNumber}`}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Description if available */}
                {currentBook.description && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <h4 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-2">Description</h4>
                    <p className="text-xs text-foreground-muted line-clamp-4">
                      {currentBook.description}
                    </p>
                  </div>
                )}
              </div>

              {/* Search and results */}
              <div>
                {/* Search bar */}
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by title, author, or ISBN..."
                    className="flex-1 px-3 py-2 border border-border rounded-lg bg-background text-foreground"
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  />
                  <button
                    onClick={handleSearch}
                    disabled={searching}
                    className="btn btn-primary"
                  >
                    {searching ? "..." : "Search"}
                  </button>
                </div>
                {(currentBook.isbn || currentBook.isbn13 || currentBook.isbn10) ? (
                  <p className="text-xs text-foreground-muted mb-4">
                    Tip: Try searching with ISBN{" "}
                    <button
                      onClick={() => {
                        const isbn = currentBook.isbn13 || currentBook.isbn10 || currentBook.isbn || "";
                        setSearchQuery(isbn);
                      }}
                      className="text-primary hover:underline"
                    >
                      {currentBook.isbn13 || currentBook.isbn10 || currentBook.isbn}
                    </button>
                    {" "}for more accurate results.
                  </p>
                ) : (
                  <div className="mb-2" />
                )}

                {message && (
                  <p className="text-sm text-foreground-muted mb-4">{message}</p>
                )}

                {/* Results */}
                {searching ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : searchResults.length > 0 ? (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {searchResults.map((result, index) => (
                      <div
                        key={index}
                        onClick={() => !applying && handleApply(result)}
                        className={`p-3 border border-border rounded-lg hover:bg-surface-elevated cursor-pointer transition-colors ${
                          applying ? "opacity-50 pointer-events-none" : ""
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
                                    ? "bg-blue-100 text-blue-700"
                                    : "bg-green-100 text-green-700"
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
      ) : null}
    </main>
  );
}
