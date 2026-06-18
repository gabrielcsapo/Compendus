"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-flight-router/client";
import { buttonStyles, badgeStyles } from "../lib/styles";
import { BookCover } from "../components/BookCover";
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
import type { BookFormat } from "../lib/types";
import { THEMES } from "../lib/reader/settings";
import { CoverExtractButton } from "../components/CoverExtractButton";
import { CoverDropZone } from "../components/CoverDropZone";
import type { Book } from "../lib/db/schema";
import type { MetadataSearchResult } from "../lib/metadata";

const QUEUE_SIZE = 12;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]{1,5}$/i, "");
}

/**
 * Derive a human title from archive-style filenames like
 * "Title -- Author -- 7th ed -- isbn13 978... -- <hash> -- Site.pdf"
 */
function cleanFilename(fileName: string): string {
  let name = stripExtension(fileName);
  if (name.includes(" -- ")) name = name.split(" -- ")[0];
  return name
    .replace(/\((?:z-?lib(?:rary)?[^)]*|annas?[^)]*archive[^)]*)\)/gi, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** ISBN from DB columns, or scraped out of the filename/title text. */
function extractIsbn(book: Book): string | null {
  if (book.isbn13) return book.isbn13;
  if (book.isbn10) return book.isbn10;
  if (book.isbn) return book.isbn;
  const haystack = `${book.fileName} ${book.title}`.replace(/[-‐-―\s]/g, " ");
  const compact = haystack.replace(/(\d) (?=\d)/g, "$1");
  const m13 = compact.match(/\b97[89]\d{10}\b/);
  if (m13) return m13[0];
  const m10 = compact.match(/\b\d{9}[\dXx]\b/);
  return m10 ? m10[0] : null;
}

function parseAuthors(book: Book): string[] {
  try {
    const authors = book.authors ? JSON.parse(book.authors) : [];
    return Array.isArray(authors) ? authors : [];
  } catch {
    return [];
  }
}

function guessAuthor(book: Book): string | null {
  const fromDb = parseAuthors(book)[0];
  if (fromDb && !fromDb.includes(" -- ")) return fromDb;
  const segments = stripExtension(book.fileName).split(" -- ");
  if (segments.length > 1) {
    const seg = segments[1]
      .replace(/_/g, " ")
      .replace(/,\s*(sir|jr|sr|dr)\.?\s*$/i, "")
      .trim();
    if (seg && seg.length < 60 && !/\d{6,}/.test(seg)) return seg;
  }
  return null;
}

interface SearchStrategy {
  label: string;
  query: string;
}

function buildStrategies(book: Book): SearchStrategy[] {
  const strategies: SearchStrategy[] = [];
  const isbn = extractIsbn(book);
  if (isbn) strategies.push({ label: `ISBN ${isbn}`, query: isbn });

  const cleaned = cleanFilename(book.fileName);
  const title = !book.title?.trim() || book.title.includes(" -- ") ? cleaned : book.title.trim();
  if (title) strategies.push({ label: "Title", query: title });

  const author = guessAuthor(book);
  if (title && author) {
    strategies.push({ label: "Title + author", query: `${title} ${author}` });
  }
  return strategies;
}

/** PDF producer strings that end up in the publisher field of scanned books. */
const JUNK_PUBLISHER =
  /adobe|acrobat|calibre|microsoft|quartz|ghostscript|itext|pdfsharp|abbyy|finereader|scansnap|libreoffice|openoffice|paper capture|internet archive pdf|tesseract|epubcheck|sigil|pandoc/i;

function displayTitle(book: Book): string {
  const t = book.title?.trim();
  if (!t || t.includes(" -- ") || t === stripExtension(book.fileName)) {
    return cleanFilename(book.fileName) || t || book.fileName;
  }
  return t;
}

function pagesMismatch(a: number | null | undefined, b: number | null | undefined): boolean {
  if (!a || !b) return false;
  return Math.abs(a - b) / Math.max(a, b) > 0.15;
}

export default function UnmatchedBooks({
  initialBooks,
  initialCount,
}: {
  initialBooks?: Book[] | null;
  initialCount?: number;
}) {
  const [queue, setQueue] = useState<Book[]>(initialBooks ?? []);
  const [currentBook, setCurrentBook] = useState<Book | null>(initialBooks?.[0] ?? null);
  const [loading, setLoading] = useState(initialBooks === undefined);
  const [totalRemaining, setTotalRemaining] = useState(initialCount ?? 0);
  const [processedCount, setProcessedCount] = useState(0);
  const hadInitialData = useRef(initialBooks !== undefined);

  // Search state
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<MetadataSearchResult[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [applyingIndex, setApplyingIndex] = useState<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Reader preview state (lazy — only loads when expanded)
  const [showPreview, setShowPreview] = useState(false);
  const [previewContent, setPreviewContent] = useState<PageContent | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Cover prompt state
  const [pendingMetadata, setPendingMetadata] = useState<MetadataSearchResult | null>(null);
  const [showCoverPrompt, setShowCoverPrompt] = useState(false);

  // Delete state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const applying = applyingIndex !== null;

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [books, count] = await Promise.all([
        getUnmatchedBooks(QUEUE_SIZE),
        getUnmatchedBooksCount(),
      ]);
      setQueue(books);
      setCurrentBook(books[0] ?? null);
      setTotalRemaining(count);
    } catch {
      setMessage("Failed to load books");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load queue on mount unless the server already provided it
  useEffect(() => {
    if (hadInitialData.current) {
      hadInitialData.current = false;
      return;
    }
    loadQueue();
  }, [loadQueue]);

  const runSearch = async (query: string) => {
    if (!currentBook || !query.trim()) return;

    setSearching(true);
    setMessage(null);

    try {
      const author = guessAuthor(currentBook) ?? undefined;
      const results = await searchMetadata(query, author, currentBook.format as BookFormat);
      setSearchResults(results);
      setHasSearched(true);
      if (results.length === 0) {
        setMessage("No results. Try another search strategy below, or edit the query.");
      }
    } catch (error) {
      setMessage(`Search failed: ${(error as Error).message}`);
    } finally {
      setSearching(false);
    }
  };

  // When the current book changes: reset per-book state and auto-search
  // with the best available strategy (ISBN beats cleaned title).
  useEffect(() => {
    if (!currentBook) return;
    setSearchResults([]);
    setHasSearched(false);
    setShowPreview(false);
    setPreviewContent(null);
    const best = buildStrategies(currentBook)[0];
    const query = best?.query ?? currentBook.title;
    setSearchQuery(query);
    runSearch(query);
  }, [currentBook?.id]);

  // Lazy-load the content preview when expanded
  useEffect(() => {
    if (!showPreview || !currentBook || previewContent) return;

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
  }, [showPreview, currentBook?.id]);

  const handleApply = async (metadata: MetadataSearchResult, index: number) => {
    if (!currentBook) return;

    // If book already has a cover, ask whether to update it
    if (currentBook.coverPath) {
      setApplyingIndex(index);
      setPendingMetadata(metadata);
      setShowCoverPrompt(true);
      return;
    }

    await doApplyMetadata(metadata, false, index);
  };

  const doApplyMetadata = async (metadata: MetadataSearchResult, skipCover = false, index = 0) => {
    if (!currentBook) return;

    setApplyingIndex(index);
    setMessage(null);
    setShowCoverPrompt(false);
    setPendingMetadata(null);

    try {
      const result = await applyMetadata(currentBook.id, metadata, { skipCover });
      if (result.success) {
        setProcessedCount((prev) => prev + 1);
        await loadQueue();
      } else {
        setMessage(result.message);
      }
    } catch {
      setMessage("Failed to apply metadata");
    } finally {
      setApplyingIndex(null);
    }
  };

  const cancelCoverPrompt = () => {
    setShowCoverPrompt(false);
    setPendingMetadata(null);
    setApplyingIndex(null);
  };

  const handleSkip = useCallback(async () => {
    if (!currentBook || applying) return;
    await skipBookMatch(currentBook.id);
    setProcessedCount((prev) => prev + 1);
    await loadQueue();
  }, [currentBook, applying, loadQueue]);

  const handleDelete = async () => {
    if (!currentBook) return;
    setDeleting(true);
    try {
      const success = await deleteBook(currentBook.id);
      if (success) {
        setShowDeleteConfirm(false);
        setProcessedCount((prev) => prev + 1);
        await loadQueue();
      } else {
        setMessage("Failed to delete book");
      }
    } catch {
      setMessage("Failed to delete book");
    } finally {
      setDeleting(false);
    }
  };

  // Keyboard shortcuts: S = skip, / = focus search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }
      if (showCoverPrompt || showDeleteConfirm) return;
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        handleSkip();
      } else if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSkip, showCoverPrompt, showDeleteConfirm]);

  // All done state
  if (!loading && !currentBook && totalRemaining === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-success-light flex items-center justify-center">
          <svg
            className="w-8 h-8 text-success"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">All caught up!</h2>
        <p className="text-foreground-muted mb-2">All your books have been matched. Nice work!</p>
        {processedCount > 0 && (
          <p className="text-sm text-foreground-muted mb-6">
            You processed {processedCount} {processedCount === 1 ? "book" : "books"} this session.
          </p>
        )}
        <Link to="/library" className={`${buttonStyles.base} ${buttonStyles.primary}`}>
          Back to Library
        </Link>
      </div>
    );
  }

  const sessionTotal = processedCount + totalRemaining;
  const progressPct = sessionTotal > 0 ? (processedCount / sessionTotal) * 100 : 0;
  const strategies = currentBook ? buildStrategies(currentBook) : [];
  const isJunkPublisher = currentBook?.publisher
    ? JUNK_PUBLISHER.test(currentBook.publisher)
    : false;
  const upNext = currentBook ? queue.filter((b) => b.id !== currentBook.id) : [];

  return (
    <div>
      {/* Sticky session toolbar: progress + per-book actions */}
      <div className="sticky top-[72px] z-20 mb-5">
        <div className="flex items-center gap-5 bg-surface/95 backdrop-blur-md border border-border rounded-xl px-4 py-3 shadow-sm">
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between mb-1.5 text-xs">
              <span className="font-medium text-foreground">{processedCount} processed</span>
              <span className="text-foreground-muted">
                {totalRemaining} {totalRemaining === 1 ? "book" : "books"} remaining
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-elevated overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
          {currentBook && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Link
                to={`/book/${currentBook.id}`}
                className="px-3 py-2 text-sm text-foreground-muted hover:text-foreground hover:bg-surface-elevated rounded-lg transition-colors"
              >
                Details
              </Link>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={applying || deleting}
                title="Delete book"
                aria-label="Delete book"
                className="p-2 rounded-lg text-foreground-muted hover:text-danger hover:bg-danger-light transition-colors disabled:opacity-50"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
              <div className="w-px h-6 bg-border mx-1.5" />
              <button
                onClick={handleSkip}
                disabled={applying}
                className={`${buttonStyles.base} !py-2`}
              >
                Skip
                <kbd className="text-[10px] font-sans px-1.5 py-0.5 rounded border border-border bg-surface-elevated text-foreground-muted">
                  S
                </kbd>
              </button>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : currentBook ? (
        <>
          <div className="bg-surface border border-border rounded-xl p-6">
            <div className="grid md:grid-cols-[220px_1fr] gap-8">
              {/* Identity panel: cover (= dropzone) + the evidence that matters */}
              <div className="min-w-0">
                <CoverDropZone
                  bookId={currentBook.id}
                  coverPath={currentBook.coverPath}
                  coverColor={currentBook.coverColor}
                  title={displayTitle(currentBook)}
                  updatedAt={currentBook.updatedAt}
                  onSuccess={loadQueue}
                />
                {!currentBook.coverPath && (
                  <div className="mt-2 text-center">
                    <CoverExtractButton
                      bookId={currentBook.id}
                      bookFormat={currentBook.format}
                      onSuccess={loadQueue}
                      variant="inline"
                    />
                  </div>
                )}

                <h3 className="font-semibold text-foreground mt-4 leading-snug">
                  {displayTitle(currentBook)}
                </h3>
                {currentBook.subtitle && (
                  <p className="text-sm text-foreground-muted mt-1 italic">
                    {currentBook.subtitle}
                  </p>
                )}
                {guessAuthor(currentBook) && (
                  <p className="text-sm text-foreground-muted mt-1">
                    by {guessAuthor(currentBook)}
                  </p>
                )}

                <dl className="mt-4 pt-4 border-t border-border grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                  <dt className="text-foreground-muted">Format</dt>
                  <dd className="text-foreground uppercase">{currentBook.format}</dd>
                  <dt className="text-foreground-muted">Size</dt>
                  <dd className="text-foreground">{formatFileSize(currentBook.fileSize)}</dd>
                  {currentBook.pageCount && (
                    <>
                      <dt className="text-foreground-muted">Pages</dt>
                      <dd className="text-foreground">{currentBook.pageCount}</dd>
                    </>
                  )}
                  {extractIsbn(currentBook) && (
                    <>
                      <dt className="text-foreground-muted">ISBN</dt>
                      <dd className="text-foreground">{extractIsbn(currentBook)}</dd>
                    </>
                  )}
                  {currentBook.publisher && !isJunkPublisher && (
                    <>
                      <dt className="text-foreground-muted">Publisher</dt>
                      <dd className="text-foreground">{currentBook.publisher}</dd>
                    </>
                  )}
                  {currentBook.publishedDate && !isJunkPublisher && (
                    <>
                      <dt className="text-foreground-muted">Published</dt>
                      <dd className="text-foreground">{currentBook.publishedDate}</dd>
                    </>
                  )}
                  {currentBook.language && (
                    <>
                      <dt className="text-foreground-muted">Language</dt>
                      <dd className="text-foreground">{currentBook.language}</dd>
                    </>
                  )}
                  {currentBook.series && (
                    <>
                      <dt className="text-foreground-muted">Series</dt>
                      <dd className="text-foreground">
                        {currentBook.series}
                        {currentBook.seriesNumber && ` #${currentBook.seriesNumber}`}
                      </dd>
                    </>
                  )}
                </dl>

                <details className="mt-4 pt-4 border-t border-border group">
                  <summary className="text-xs text-foreground-muted cursor-pointer hover:text-foreground select-none list-none flex items-center gap-1">
                    <svg
                      className="w-3 h-3 transition-transform group-open:rotate-90"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                    Raw file info
                  </summary>
                  <div className="mt-2 text-xs space-y-1.5">
                    <p className="text-foreground-muted break-all">
                      <span className="text-foreground">Filename:</span> {currentBook.fileName}
                    </p>
                    <p className="text-foreground-muted break-all">
                      <span className="text-foreground">Location:</span> {currentBook.filePath}
                    </p>
                  </div>
                </details>

                {currentBook.description && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <p className="text-xs text-foreground-muted line-clamp-4">
                      {currentBook.description}
                    </p>
                  </div>
                )}
              </div>

              {/* Matching workbench: search + results */}
              <div className="min-w-0">
                {/* Search bar */}
                <div className="flex gap-2">
                  <div className="relative flex-1 min-w-0">
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search by title, author, or ISBN..."
                      className="w-full pl-3 pr-9 py-2 border border-border rounded-lg bg-background text-foreground focus:border-primary focus:outline-none"
                      onKeyDown={(e) => e.key === "Enter" && runSearch(searchQuery)}
                    />
                    {searchQuery && (
                      <button
                        onClick={() => {
                          setSearchQuery("");
                          searchInputRef.current?.focus();
                        }}
                        aria-label="Clear search"
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-foreground-muted hover:text-foreground"
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => runSearch(searchQuery)}
                    disabled={searching}
                    className={`${buttonStyles.base} ${buttonStyles.primary} flex-shrink-0`}
                  >
                    Search
                  </button>
                </div>

                {/* Query strategy chips */}
                {strategies.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                    <span className="text-xs text-foreground-muted mr-0.5">Try:</span>
                    {strategies.map((strategy) => (
                      <button
                        key={strategy.label}
                        onClick={() => {
                          setSearchQuery(strategy.query);
                          runSearch(strategy.query);
                        }}
                        disabled={searching}
                        className={`px-2.5 py-1 text-xs rounded-full border transition-colors disabled:opacity-50 ${
                          searchQuery === strategy.query
                            ? "border-primary/40 bg-primary-light text-primary"
                            : "border-border text-foreground-muted hover:text-foreground hover:border-border-hover"
                        }`}
                      >
                        {strategy.label}
                      </button>
                    ))}
                  </div>
                )}

                {message && <p className="text-sm text-foreground-muted mt-3">{message}</p>}

                {/* Results */}
                <div className="mt-4">
                  {searching ? (
                    <div className="space-y-2">
                      {[0, 1, 2].map((i) => (
                        <div
                          key={i}
                          className="flex gap-3 p-3 border border-border rounded-lg animate-pulse"
                        >
                          <div className="w-12 h-[68px] rounded bg-surface-elevated flex-shrink-0" />
                          <div className="flex-1 py-1 space-y-2">
                            <div className="h-3.5 bg-surface-elevated rounded w-2/3" />
                            <div className="h-3 bg-surface-elevated rounded w-1/3" />
                            <div className="h-3 bg-surface-elevated rounded w-1/4" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : searchResults.length > 0 ? (
                    <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
                      {searchResults.map((result, index) => {
                        const mismatch = pagesMismatch(result.pageCount, currentBook.pageCount);
                        return (
                          <div
                            key={`${result.source}-${result.sourceId}-${index}`}
                            className="flex gap-3 p-3 border border-border rounded-lg hover:border-primary/40 transition-colors"
                          >
                            <div className="w-12 h-[68px] rounded overflow-hidden bg-surface-elevated flex-shrink-0 flex items-center justify-center">
                              {result.coverUrlHQ || result.coverUrl ? (
                                <img
                                  src={result.coverUrlHQ || result.coverUrl || ""}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <svg
                                  className="w-5 h-5 text-foreground-muted/50"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={1.5}
                                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                                  />
                                </svg>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start gap-2">
                                <h4 className="font-medium text-foreground text-sm leading-snug">
                                  {result.title}
                                </h4>
                                <span
                                  className={`${badgeStyles.base} flex-shrink-0 ${
                                    result.source === "googlebooks"
                                      ? badgeStyles.primary
                                      : badgeStyles.success
                                  }`}
                                >
                                  {result.source === "googlebooks" ? "Google" : "OpenLib"}
                                </span>
                              </div>
                              {result.authors.length > 0 && (
                                <p className="text-xs text-foreground-muted truncate mt-0.5">
                                  {result.authors.join(", ")}
                                </p>
                              )}
                              <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-1">
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
                                {mismatch && (
                                  <span
                                    className={`${badgeStyles.base} ${badgeStyles.warning}`}
                                    title="Page count differs from this file — may be a different edition"
                                  >
                                    file has {currentBook.pageCount}p
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center flex-shrink-0">
                              <button
                                onClick={() => handleApply(result, index)}
                                disabled={applying}
                                className={`${buttonStyles.base} ${buttonStyles.primary} !px-3.5 !py-1.5 !text-xs`}
                              >
                                {applyingIndex === index ? (
                                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  "Apply"
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : hasSearched ? null : (
                    <p className="text-sm text-foreground-muted py-4">
                      Searching for a match&hellip;
                    </p>
                  )}
                </div>

                {/* Content preview, collapsed by default */}
                <div className="mt-5 border-t border-border pt-3">
                  <button
                    onClick={() => setShowPreview((prev) => !prev)}
                    className="flex items-center gap-1.5 text-xs text-foreground-muted hover:text-foreground transition-colors"
                  >
                    <svg
                      className={`w-3 h-3 transition-transform ${showPreview ? "rotate-90" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                    Peek inside
                    <span className="text-foreground-muted/60">— first page of the file</span>
                  </button>

                  {showPreview && (
                    <div className="mt-3 border border-border rounded-lg overflow-hidden h-72">
                      {previewLoading ? (
                        <div className="flex items-center justify-center h-full bg-surface-elevated">
                          <div className="flex flex-col items-center gap-2">
                            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                            <span className="text-xs text-foreground-muted">
                              Loading preview...
                            </span>
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
                            <div className="h-full flex items-center justify-center bg-surface-elevated">
                              <img
                                src={previewContent.imageUrl}
                                alt="Page preview"
                                className="max-h-full max-w-full object-contain"
                              />
                            </div>
                          ) : previewContent.type === "audio" ? (
                            <div className="flex items-center justify-center h-full bg-surface-elevated">
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
                            <div className="flex items-center justify-center h-full bg-surface-elevated">
                              <p className="text-sm text-foreground-muted">No preview available</p>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-full bg-surface-elevated">
                          <p className="text-sm text-foreground-muted">No preview available</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Up next: jump anywhere in the queue */}
          {upNext.length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-2">
                Up next
              </p>
              <div className="flex gap-2.5 overflow-x-auto pb-2">
                {upNext.map((book) => (
                  <button
                    key={book.id}
                    onClick={() => setCurrentBook(book)}
                    disabled={applying}
                    title={displayTitle(book)}
                    className="w-16 flex-shrink-0 group disabled:opacity-50"
                  >
                    <div className="aspect-[2/3] rounded-lg overflow-hidden border border-border group-hover:border-primary transition-colors bg-surface-elevated">
                      <BookCover
                        book={book}
                        size="thumb"
                        alt=""
                        fallback={
                          <div className="w-full h-full flex items-center justify-center p-1.5 bg-gradient-to-br from-primary-light to-accent-light">
                            <span className="text-center text-foreground-muted text-[9px] font-medium line-clamp-4 break-words">
                              {displayTitle(book)}
                            </span>
                          </div>
                        }
                      />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      ) : null}

      {/* Cover update prompt */}
      {showCoverPrompt && pendingMetadata && currentBook && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-border rounded-xl p-6 max-w-lg w-full">
            <h3 className="text-lg font-semibold text-foreground mb-2">Update Cover Image?</h3>
            <p className="text-foreground-muted mb-4">
              This book already has a cover. Would you like to replace it with the one from the
              metadata source?
            </p>

            {/* Side by side cover comparison */}
            <div className="flex gap-4 justify-center mb-6">
              <div className="text-center">
                <p className="text-xs font-medium text-foreground-muted mb-2">Current</p>
                <div
                  className="w-24 h-36 rounded-lg overflow-hidden border border-border bg-surface-elevated"
                  style={{ backgroundColor: currentBook.coverColor || undefined }}
                >
                  <BookCover book={currentBook} size="full" alt="Current cover" />
                </div>
              </div>
              {(pendingMetadata.coverUrlHQ || pendingMetadata.coverUrl) && (
                <div className="text-center">
                  <p className="text-xs font-medium text-foreground-muted mb-2">New</p>
                  <div className="w-24 h-36 rounded-lg overflow-hidden border border-border bg-surface-elevated">
                    <img
                      src={pendingMetadata.coverUrlHQ || pendingMetadata.coverUrl || ""}
                      alt="New cover"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={cancelCoverPrompt}
                className="px-4 py-2 text-foreground-muted hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                // Pass the index through: doApplyMetadata's default (0) made
                // the spinner always render on the FIRST result card —
                // applyingIndex still holds the clicked card from handleApply.
                onClick={() => doApplyMetadata(pendingMetadata, true, applyingIndex ?? 0)}
                className="px-4 py-2 border border-border rounded-lg text-foreground hover:bg-surface-elevated transition-colors"
              >
                Keep Current Cover
              </button>
              <button
                onClick={() => doApplyMetadata(pendingMetadata, false, applyingIndex ?? 0)}
                className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors"
              >
                Use New Cover
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && currentBook && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-border rounded-xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-foreground mb-2">Delete Book?</h3>
            <p className="text-foreground-muted mb-2">
              This will permanently delete "{displayTitle(currentBook)}" and its file from your
              library.
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
    </div>
  );
}
