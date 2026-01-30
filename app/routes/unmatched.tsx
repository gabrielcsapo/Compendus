"use client";

import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router";
import {
  getUnmatchedBooks,
  getUnmatchedBooksCount,
  searchMetadata,
  applyMetadata,
  skipBookMatch,
  deleteBook,
} from "../actions/books";
import { getReaderInfo, getReaderPage } from "../actions/reader";
import type { PageContent } from "../lib/reader/types";
import { THEMES } from "../lib/reader/settings";
import { ClickableCoverPlaceholder } from "../components/CoverExtractButton";
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

  // Reader preview state
  const [previewContent, setPreviewContent] = useState<PageContent | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Delete state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadNextBook = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    setSearchResults([]);

    try {
      const [books, count] = await Promise.all([getUnmatchedBooks(1), getUnmatchedBooksCount()]);

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

  // Load reader preview when book changes
  useEffect(() => {
    if (!currentBook) {
      setPreviewContent(null);
      return;
    }

    const loadPreview = async () => {
      setPreviewLoading(true);
      try {
        const viewport = { width: 400, height: 300, dpr: 1 };
        const info = await getReaderInfo(currentBook.id, viewport);
        if (info && info.totalPages > 0) {
          const page = await getReaderPage(currentBook.id, 1, viewport);
          if (page) {
            setPreviewContent(page.content);
          }
        }
      } catch (error) {
        console.error("Failed to load preview:", error);
      } finally {
        setPreviewLoading(false);
      }
    };

    loadPreview();
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

  const handleDelete = async () => {
    if (!currentBook) return;
    setDeleting(true);
    try {
      const success = await deleteBook(currentBook.id);
      if (success) {
        setShowDeleteConfirm(false);
        setProcessedCount((prev) => prev + 1);
        await loadNextBook();
      } else {
        setMessage("Failed to delete book");
      }
    } catch (error) {
      setMessage("Failed to delete book");
    } finally {
      setDeleting(false);
    }
  };

  // All done state
  if (!loading && !currentBook && totalRemaining === 0) {
    return (
      <main className="container my-8 px-6 mx-auto">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Link to="/" className="text-primary hover:text-primary-hover transition-colors">
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
          <p className="text-foreground-muted mb-2">All your books have cover images. Nice work!</p>
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
            <Link to="/" className="text-primary hover:text-primary-hover transition-colors">
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
                onClick={() => setShowDeleteConfirm(true)}
                disabled={applying || deleting}
                className="text-sm text-danger hover:text-danger/80 disabled:opacity-50"
              >
                Delete
              </button>
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
                <ClickableCoverPlaceholder
                  bookId={currentBook.id}
                  bookFormat={currentBook.format}
                  title={currentBook.title}
                  coverColor={currentBook.coverColor}
                  onSuccess={loadNextBook}
                  className="aspect-[2/3] w-full max-w-[200px] overflow-hidden rounded-lg"
                />
                <h3 className="font-semibold text-foreground mt-3 line-clamp-2">
                  {currentBook.title}
                </h3>
                {currentBook.subtitle && (
                  <p className="text-sm text-foreground-muted mt-1 italic">
                    {currentBook.subtitle}
                  </p>
                )}
                {authors.length > 0 && (
                  <p className="text-sm text-foreground-muted mt-1">by {authors.join(", ")}</p>
                )}

                {/* File details */}
                <div className="mt-4 pt-4 border-t border-border space-y-2">
                  <h4 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">
                    File Details
                  </h4>
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
                {(currentBook.isbn ||
                  currentBook.isbn13 ||
                  currentBook.isbn10 ||
                  currentBook.publisher ||
                  currentBook.publishedDate ||
                  currentBook.pageCount ||
                  currentBook.language ||
                  currentBook.series) && (
                  <div className="mt-4 pt-4 border-t border-border space-y-2">
                    <h4 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">
                      Existing Metadata
                    </h4>
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
                          <span className="text-foreground">Pages:</span> {currentBook.pageCount}
                        </p>
                      )}
                      {currentBook.language && (
                        <p className="text-foreground-muted">
                          <span className="text-foreground">Language:</span> {currentBook.language}
                        </p>
                      )}
                      {currentBook.series && (
                        <p className="text-foreground-muted">
                          <span className="text-foreground">Series:</span> {currentBook.series}
                          {currentBook.seriesNumber && ` #${currentBook.seriesNumber}`}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Description if available */}
                {currentBook.description && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <h4 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-2">
                      Description
                    </h4>
                    <p className="text-xs text-foreground-muted line-clamp-4">
                      {currentBook.description}
                    </p>
                  </div>
                )}
              </div>

              {/* Reader Preview and Search */}
              <div className="min-w-0 overflow-hidden">
                {/* Reader Preview */}
                <div className="mb-4 border border-border rounded-lg overflow-hidden">
                  <div className="bg-surface-elevated px-3 py-2 border-b border-border">
                    <h4 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">
                      Content Preview
                    </h4>
                  </div>
                  <div className="h-64 overflow-hidden">
                    {previewLoading ? (
                      <div className="flex items-center justify-center h-full bg-gray-50">
                        <div className="flex flex-col items-center gap-2">
                          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                          <span className="text-xs text-foreground-muted">Loading preview...</span>
                        </div>
                      </div>
                    ) : previewContent ? (
                      <div className="h-full overflow-auto">
                        {previewContent.type === "text" && previewContent.html ? (
                          <div
                            className="p-4 prose prose-sm max-w-none text-xs"
                            style={{
                              fontSize: "11px",
                              lineHeight: 1.4,
                              backgroundColor: THEMES.light.background,
                              color: THEMES.light.foreground,
                            }}
                            // biome-ignore lint/security/noDangerouslySetInnerHtml: Content is sanitized server-side
                            dangerouslySetInnerHTML={{ __html: previewContent.html }}
                          />
                        ) : previewContent.type === "image" && previewContent.imageUrl ? (
                          <div className="h-full flex items-center justify-center bg-gray-100">
                            <img
                              src={previewContent.imageUrl}
                              alt="Page preview"
                              className="max-h-full max-w-full object-contain"
                            />
                          </div>
                        ) : previewContent.type === "audio" ? (
                          <div className="flex items-center justify-center h-full bg-gray-50">
                            <div className="text-center">
                              <svg
                                className="w-12 h-12 mx-auto mb-2 text-foreground-muted"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={1.5}
                                  d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                                />
                              </svg>
                              <p className="text-sm text-foreground-muted">Audiobook</p>
                              {previewContent.chapterTitle && (
                                <p className="text-xs text-foreground-muted/70 mt-1">
                                  {previewContent.chapterTitle}
                                </p>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center h-full bg-gray-50">
                            <p className="text-sm text-foreground-muted">No preview available</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full bg-gray-50">
                        <p className="text-sm text-foreground-muted">No preview available</p>
                      </div>
                    )}
                  </div>
                </div>

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
                  <button onClick={handleSearch} disabled={searching} className="btn btn-primary">
                    {searching ? "..." : "Search"}
                  </button>
                </div>
                {currentBook.isbn || currentBook.isbn13 || currentBook.isbn10 ? (
                  <p className="text-xs text-foreground-muted mb-4">
                    Tip: Try searching with ISBN{" "}
                    <button
                      onClick={() => {
                        const isbn =
                          currentBook.isbn13 || currentBook.isbn10 || currentBook.isbn || "";
                        setSearchQuery(isbn);
                      }}
                      className="text-primary hover:underline"
                    >
                      {currentBook.isbn13 || currentBook.isbn10 || currentBook.isbn}
                    </button>{" "}
                    for more accurate results.
                  </p>
                ) : (
                  <div className="mb-2" />
                )}

                {message && <p className="text-sm text-foreground-muted mb-4">{message}</p>}

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

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && currentBook && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-border rounded-xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-foreground mb-2">Delete Book?</h3>
            <p className="text-foreground-muted mb-2">
              This will permanently delete "{currentBook.title}" and its file from your library.
            </p>
            <p className="text-sm text-danger mb-6">This action cannot be undone.</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="px-4 py-2 text-foreground-muted hover:text-foreground transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 bg-danger text-white rounded-lg hover:bg-danger/90 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {deleting && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
