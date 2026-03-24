"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "react-flight-router/client";
import { searchAllSources, type MetadataSearchResult } from "../lib/metadata";
import {
  addToWantedList,
  isBookWanted,
  isBookOwned,
  getWantedBooks,
  removeFromWantedList,
  updateWantedBook,
  clearWantedList,
} from "../actions/wanted";
import type { WantedBook } from "../lib/db/schema";
import { badgeStyles } from "../lib/styles";

async function uploadFileWithMetadata(
  file: File,
  metadata: WantedBook,
): Promise<{ success: boolean; error?: string }> {
  const formData = new FormData();
  formData.append("file", file);

  if (metadata.title) formData.append("title", metadata.title);
  if (metadata.isbn) formData.append("isbn", metadata.isbn);
  if (metadata.isbn13) formData.append("isbn13", metadata.isbn13);
  if (metadata.isbn10) formData.append("isbn10", metadata.isbn10);
  if (metadata.publisher) formData.append("publisher", metadata.publisher);
  if (metadata.publishedDate) formData.append("publishedDate", metadata.publishedDate);
  if (metadata.description) formData.append("description", metadata.description);
  if (metadata.language) formData.append("language", metadata.language);
  if (metadata.pageCount) formData.append("pageCount", metadata.pageCount.toString());
  if (metadata.authors) formData.append("authors", metadata.authors);

  const response = await fetch("/api/upload", { method: "POST", body: formData });
  return response.json();
}

export default function Component({
  initialBooks,
  initialRemoved,
}: {
  initialBooks?: WantedBook[];
  initialRemoved?: number;
}) {
  const router = useRouter();

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MetadataSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [wantedMap, setWantedMap] = useState<Map<string, boolean>>(new Map());
  const [ownedMap, setOwnedMap] = useState<Map<string, boolean>>(new Map());
  const [searchMessage, setSearchMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Wishlist state
  const [wantedBooks, setWantedBooks] = useState<WantedBook[]>(initialBooks ?? []);
  const [wishlistLoading, setWishlistLoading] = useState(!initialBooks);
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [wishlistMessage, setWishlistMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(
    initialRemoved && initialRemoved > 0
      ? {
          type: "success",
          text: `${initialRemoved} book${initialRemoved > 1 ? "s" : ""} removed (now in library)`,
        }
      : null,
  );
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const hadInitialData = useRef(!!initialBooks);

  useEffect(() => {
    if (hadInitialData.current) {
      hadInitialData.current = false;
      return;
    }
    loadWishlist();
  }, []);

  const setWishlistMessageWithAutoDismiss = (
    msg: { type: "success" | "error"; text: string } | null,
  ) => {
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    setWishlistMessage(msg);
    if (msg?.type === "error") {
      messageTimerRef.current = setTimeout(() => setWishlistMessage(null), 6000);
    }
  };

  const loadWishlist = async () => {
    setWishlistLoading(true);
    try {
      const result = await getWantedBooks();
      setWantedBooks(result.books);
      if (result.removed > 0) {
        setWishlistMessage({
          type: "success",
          text: `${result.removed} book${result.removed > 1 ? "s" : ""} removed (now in library)`,
        });
      }
    } catch {
      setWishlistMessageWithAutoDismiss({ type: "error", text: "Failed to load wishlist" });
    } finally {
      setWishlistLoading(false);
    }
  };

  // Search handlers
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchMessage(null);
    try {
      const results = await searchAllSources(searchQuery);
      setSearchResults(results);

      const statusEntries = await Promise.all(
        results.map(async (result) => {
          const key = `${result.source}:${result.sourceId}`;
          const [wanted, owned] = await Promise.all([isBookWanted(result), isBookOwned(result)]);
          return { key, wanted, owned };
        }),
      );

      const wantedStatus = new Map<string, boolean>();
      const ownedStatus = new Map<string, boolean>();
      for (const { key, wanted, owned } of statusEntries) {
        wantedStatus.set(key, wanted);
        ownedStatus.set(key, owned);
      }
      setWantedMap(wantedStatus);
      setOwnedMap(ownedStatus);

      if (results.length === 0) {
        setSearchMessage({ type: "error", text: "No results found. Try different search terms." });
      }
    } catch {
      setSearchMessage({ type: "error", text: "Search failed. Please try again." });
    } finally {
      setSearching(false);
    }
  };

  const handleAddToWanted = async (result: MetadataSearchResult) => {
    try {
      const newBook = await addToWantedList(result);
      const key = `${result.source}:${result.sourceId}`;
      setWantedMap((prev) => new Map(prev).set(key, true));
      setWantedBooks((prev) => [newBook, ...prev]);
    } catch (error) {
      setSearchMessage({ type: "error", text: (error as Error).message });
    }
  };

  // Wishlist handlers
  const handleRemove = async (id: string) => {
    try {
      await removeFromWantedList(id);
      const removed = wantedBooks.find((b) => b.id === id);
      setWantedBooks((prev) => prev.filter((b) => b.id !== id));
      // If the removed book appears in search results, unmark it as wanted
      if (removed) {
        setWantedMap((prev) => {
          const next = new Map(prev);
          for (const [key] of next) {
            if (
              (removed.sourceId && key.endsWith(`:${removed.sourceId}`)) ||
              key.endsWith(`:${removed.isbn13}`) ||
              key.endsWith(`:${removed.isbn10}`)
            ) {
              next.set(key, false);
            }
          }
          return next;
        });
      }
      setWishlistMessageWithAutoDismiss({ type: "success", text: "Removed from wishlist" });
    } catch {
      setWishlistMessageWithAutoDismiss({ type: "error", text: "Failed to remove book" });
    }
  };

  const handleUpdateStatus = async (id: string, status: WantedBook["status"]) => {
    try {
      await updateWantedBook(id, { status });
      setWantedBooks((prev) => prev.map((b) => (b.id === id ? { ...b, status } : b)));
    } catch {
      setWishlistMessageWithAutoDismiss({ type: "error", text: "Failed to update status" });
    }
  };

  const handleClearAll = async () => {
    try {
      const count = await clearWantedList();
      setWantedBooks([]);
      setShowClearConfirm(false);
      setWishlistMessage({
        type: "success",
        text: `Removed ${count} book${count !== 1 ? "s" : ""} from wishlist`,
      });
      // Clear wantedMap since nothing is wanted anymore
      setWantedMap(new Map());
    } catch {
      setWishlistMessageWithAutoDismiss({ type: "error", text: "Failed to clear wishlist" });
    }
  };

  const handleUpload = async (book: WantedBook, file: File) => {
    setUploadingId(book.id);
    setWishlistMessage(null);
    try {
      const result = await uploadFileWithMetadata(file, book);
      if (result.success) {
        await removeFromWantedList(book.id);
        setWantedBooks((prev) => prev.filter((b) => b.id !== book.id));
        setWishlistMessage({ type: "success", text: `"${book.title}" added to your library` });
        router.refresh();
      } else if (result.error === "duplicate") {
        setWishlistMessageWithAutoDismiss({
          type: "error",
          text: `"${book.title}" already exists in your library`,
        });
      } else {
        setWishlistMessageWithAutoDismiss({
          type: "error",
          text: `Failed to upload: ${result.error}`,
        });
      }
    } catch {
      setWishlistMessageWithAutoDismiss({ type: "error", text: "Upload failed" });
    } finally {
      setUploadingId(null);
    }
  };

  return (
    <div className="lg:grid lg:grid-cols-[1fr_360px] lg:gap-8 lg:items-start">
      {/* Left: Search */}
      <div>
        {searchMessage && (
          <div
            className={`mb-4 p-3 rounded-lg border ${
              searchMessage.type === "success"
                ? "bg-success-light text-success border-success/20"
                : "bg-danger-light text-danger border-danger/20"
            }`}
          >
            {searchMessage.text}
          </div>
        )}

        <div className="flex gap-2 mb-6">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by title, author, or ISBN..."
            className="flex-1 px-4 py-3 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <button
            onClick={handleSearch}
            disabled={searching || !searchQuery.trim()}
            className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors"
          >
            {searching ? "Searching..." : "Search"}
          </button>
        </div>

        {searching ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : searchResults.length > 0 ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {searchResults.map((result, index) => {
              const key = `${result.source}:${result.sourceId}`;
              return (
                <ExternalBookCard
                  key={`${key}:${index}`}
                  book={result}
                  isWanted={wantedMap.get(key) || false}
                  isOwned={ownedMap.get(key) || false}
                  onAddToWanted={() => handleAddToWanted(result)}
                />
              );
            })}
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-elevated flex items-center justify-center">
              <svg
                className="w-8 h-8 text-foreground-muted"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <p className="text-foreground-muted">
              Search Google Books and Open Library to add books to your wishlist
            </p>
          </div>
        )}
      </div>

      {/* Right: Wishlist */}
      <div className="mt-8 lg:mt-0 lg:sticky lg:top-6" data-no-global-drop>
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-foreground">
              Wishlist {wantedBooks.length > 0 && `(${wantedBooks.length})`}
            </h2>
            {wantedBooks.length > 0 && (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="text-xs text-danger hover:text-danger/80 transition-colors"
              >
                Clear All
              </button>
            )}
          </div>

          {wishlistMessage && (
            <div
              className={`mb-3 p-2.5 rounded-lg border flex items-center justify-between gap-2 text-sm ${
                wishlistMessage.type === "success"
                  ? "bg-success-light text-success border-success/20"
                  : "bg-danger-light text-danger border-danger/20"
              }`}
            >
              <span>{wishlistMessage.text}</span>
              <button
                onClick={() => setWishlistMessage(null)}
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                aria-label="Dismiss"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {wishlistLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : wantedBooks.length === 0 ? (
            <div className="text-center py-8">
              <svg
                className="w-10 h-10 mx-auto mb-3 text-foreground-muted/40"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                />
              </svg>
              <p className="text-sm text-foreground-muted">Your wishlist is empty</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[70vh] overflow-y-auto">
              {wantedBooks.map((book) => (
                <WantedBookCard
                  key={book.id}
                  book={book}
                  onRemove={() => handleRemove(book.id)}
                  onUpdateStatus={(status) => handleUpdateStatus(book.id, status)}
                  onUpload={(file) => handleUpload(book, file)}
                  isUploading={uploadingId === book.id}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Clear confirmation dialog */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-border rounded-xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-foreground mb-2">Clear Wishlist?</h3>
            <p className="text-foreground-muted mb-6">
              This will remove all {wantedBooks.length} book{wantedBooks.length !== 1 ? "s" : ""}{" "}
              from your wishlist. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 text-foreground-muted hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleClearAll}
                className="px-4 py-2 bg-danger text-white rounded-lg hover:bg-danger/90 transition-colors"
              >
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ExternalBookCard({
  book,
  isWanted,
  isOwned,
  onAddToWanted,
}: {
  book: MetadataSearchResult;
  isWanted: boolean;
  isOwned: boolean;
  onAddToWanted: () => void;
}) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4 flex gap-4">
      <div className="w-20 h-28 flex-shrink-0 rounded-lg overflow-hidden bg-surface-elevated">
        {book.coverUrl ? (
          <img src={book.coverUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-foreground-muted p-2 text-center">
            No Cover
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground line-clamp-2">{book.title}</h3>
            {book.authors.length > 0 && (
              <p className="text-sm text-foreground-muted truncate">{book.authors.join(", ")}</p>
            )}
          </div>
          <span
            className={`text-xs px-2 py-0.5 rounded flex-shrink-0 ${
              book.source === "googlebooks" ? badgeStyles.primary : badgeStyles.success
            }`}
          >
            {book.source === "googlebooks" ? "Google" : "OpenLib"}
          </span>
        </div>

        <div className="flex items-center gap-2 mt-1 text-xs text-foreground-muted">
          {book.publishedDate && <span>{book.publishedDate}</span>}
          {book.pageCount && <span>{book.pageCount} pages</span>}
        </div>

        {book.series && (
          <p className="text-xs text-primary mt-1">
            Series: {book.series} {book.seriesNumber && `#${book.seriesNumber}`}
          </p>
        )}

        <button
          onClick={onAddToWanted}
          disabled={isWanted || isOwned}
          className={`mt-3 px-3 py-1.5 text-sm rounded-lg transition-colors ${
            isOwned
              ? "bg-success-light text-success cursor-not-allowed"
              : isWanted
                ? "bg-surface-elevated text-foreground-muted cursor-not-allowed"
                : "bg-primary text-white hover:bg-primary-hover"
          }`}
        >
          {isOwned ? "Already Owned" : isWanted ? "In Wishlist" : "Add to Wishlist"}
        </button>
      </div>
    </div>
  );
}

function WantedBookCard({
  book,
  onRemove,
  onUpdateStatus,
  onUpload,
  isUploading,
}: {
  book: WantedBook;
  onRemove: () => void;
  onUpdateStatus: (status: WantedBook["status"]) => void;
  onUpload: (file: File) => void;
  isUploading: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const authors = book.authors ? JSON.parse(book.authors) : [];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isUploading) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (isUploading) return;

    const file = e.dataTransfer.files[0];
    if (file) {
      const validExtensions = [
        ".pdf",
        ".epub",
        ".mobi",
        ".azw",
        ".azw3",
        ".cbr",
        ".cbz",
        ".m4b",
        ".m4a",
        ".mp3",
      ];
      if (validExtensions.some((ext) => file.name.toLowerCase().endsWith(ext))) {
        onUpload(file);
      }
    }
  };

  return (
    <div
      className={`relative bg-background border-2 rounded-lg p-3 flex gap-3 transition-colors ${
        isDragging ? "border-primary bg-primary-light" : "border-border"
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 bg-primary/10 rounded-lg flex items-center justify-center z-10 pointer-events-none">
          <div className="flex items-center gap-2 text-primary font-medium text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
            Drop to upload
          </div>
        </div>
      )}

      <div className="w-10 h-14 flex-shrink-0 rounded overflow-hidden bg-surface-elevated">
        {book.coverUrl ? (
          <img src={book.coverUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[10px] text-foreground-muted">
            —
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-foreground leading-tight line-clamp-2">
          {book.title}
        </p>
        {authors.length > 0 && (
          <p className="text-xs text-foreground-muted truncate">{authors.join(", ")}</p>
        )}
        <select
          value={book.status}
          onChange={(e) => onUpdateStatus(e.target.value as WantedBook["status"])}
          className={`mt-1 text-xs px-1.5 py-0.5 rounded border-0 cursor-pointer ${
            book.status === "wishlist"
              ? "bg-primary-light text-primary"
              : book.status === "searching"
                ? "bg-warning-light text-warning"
                : "bg-success-light text-success"
          }`}
        >
          <option value="wishlist">Wishlist</option>
          <option value="searching">Searching</option>
          <option value="ordered">Ordered</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5 self-start">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.epub,.mobi,.azw,.azw3,.cbr,.cbz,.m4b,.m4a,.mp3"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="text-foreground-muted hover:text-primary transition-colors disabled:opacity-50"
          title="Upload book file"
        >
          {isUploading ? (
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
          )}
        </button>
        <button
          onClick={onRemove}
          disabled={isUploading}
          className="text-foreground-muted hover:text-danger transition-colors disabled:opacity-50"
          title="Remove from wishlist"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
