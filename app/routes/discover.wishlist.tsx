"use client";

import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import {
  getWantedBooks,
  removeFromWantedList,
  updateWantedBook,
  clearWantedList,
} from "../actions/wanted";
import type { WantedBook } from "../lib/db/schema";

// Upload a file with metadata from wishlist item
async function uploadFileWithMetadata(
  file: File,
  metadata: WantedBook,
): Promise<{ success: boolean; error?: string }> {
  const formData = new FormData();
  formData.append("file", file);

  // Add metadata fields
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

  const response = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });

  return response.json();
}

export function Component() {
  const navigate = useNavigate();
  const [wantedBooks, setWantedBooksState] = useState<WantedBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  useEffect(() => {
    loadWantedList();
  }, []);

  const loadWantedList = async () => {
    setLoading(true);
    try {
      const result = await getWantedBooks();
      setWantedBooksState(result.books);
      if (result.removed > 0) {
        setMessage({
          type: "success",
          text: `${result.removed} book${result.removed > 1 ? "s" : ""} removed from wishlist (now in library)`,
        });
      }
    } catch (error) {
      setMessage({ type: "error", text: "Failed to load wanted list" });
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await removeFromWantedList(id);
      setWantedBooksState((prev) => prev.filter((b) => b.id !== id));
      setMessage({ type: "success", text: "Removed from wanted list" });
    } catch (error) {
      setMessage({ type: "error", text: "Failed to remove book" });
    }
  };

  const handleUpdateStatus = async (id: string, status: WantedBook["status"]) => {
    try {
      await updateWantedBook(id, { status });
      setWantedBooksState((prev) => prev.map((b) => (b.id === id ? { ...b, status } : b)));
    } catch (error) {
      setMessage({ type: "error", text: "Failed to update status" });
    }
  };

  const handleClearAll = async () => {
    try {
      const count = await clearWantedList();
      setWantedBooksState([]);
      setShowClearConfirm(false);
      setMessage({
        type: "success",
        text: `Removed ${count} book${count !== 1 ? "s" : ""} from wishlist`,
      });
    } catch (error) {
      setMessage({ type: "error", text: "Failed to clear wishlist" });
    }
  };

  const handleUpload = async (book: WantedBook, file: File) => {
    setUploadingId(book.id);
    setMessage(null);
    try {
      const result = await uploadFileWithMetadata(file, book);
      if (result.success) {
        // Remove from wishlist after successful upload
        await removeFromWantedList(book.id);
        setWantedBooksState((prev) => prev.filter((b) => b.id !== book.id));
        setMessage({ type: "success", text: `"${book.title}" added to your library` });
        // Refresh after a short delay to show the message
        setTimeout(() => navigate(0), 1500);
      } else if (result.error === "duplicate") {
        setMessage({ type: "error", text: `"${book.title}" already exists in your library` });
      } else {
        setMessage({ type: "error", text: `Failed to upload: ${result.error}` });
      }
    } catch (error) {
      setMessage({ type: "error", text: "Upload failed" });
    } finally {
      setUploadingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div data-no-global-drop>
      {/* Message */}
      {message && (
        <div
          className={`mb-4 p-3 rounded-lg border ${
            message.type === "success"
              ? "bg-success-light text-success border-success/20"
              : "bg-danger-light text-danger border-danger/20"
          }`}
        >
          {message.text}
        </div>
      )}

      {wantedBooks.length === 0 ? (
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
                d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
              />
            </svg>
          </div>
          <p className="text-foreground-muted mb-2">Your wanted list is empty</p>
          <p className="text-foreground-muted/60 text-sm">Search for books to add them here</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Header with count and clear button */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-foreground-muted">
              {wantedBooks.length} book{wantedBooks.length !== 1 ? "s" : ""} in wishlist
            </p>
            <button
              onClick={() => setShowClearConfirm(true)}
              className="text-sm text-danger hover:text-danger/80 transition-colors"
            >
              Clear All
            </button>
          </div>

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
    if (file) {
      onUpload(file);
    }
    // Reset input so the same file can be selected again
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isUploading) {
      setIsDragging(true);
    }
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
      // Validate file type
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
      const hasValidExtension = validExtensions.some((ext) =>
        file.name.toLowerCase().endsWith(ext),
      );
      if (hasValidExtension) {
        onUpload(file);
      }
    }
  };

  return (
    <div
      className={`relative bg-surface border-2 rounded-xl p-4 flex gap-4 transition-colors ${
        isDragging ? "border-primary bg-primary-light" : "border-border hover:border-border"
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-primary/10 rounded-xl flex items-center justify-center z-10 pointer-events-none">
          <div className="flex items-center gap-2 text-primary font-medium">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

      {/* Cover */}
      <div className="w-16 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-surface-elevated">
        {book.coverUrl ? (
          <img src={book.coverUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-foreground-muted">
            No Cover
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-foreground">{book.title}</h3>
        {authors.length > 0 && (
          <p className="text-sm text-foreground-muted">{authors.join(", ")}</p>
        )}
        {(book.isbn13 || book.isbn10 || book.isbn) && (
          <p className="text-xs text-foreground-muted/70 font-mono">
            ISBN: {book.isbn13 || book.isbn10 || book.isbn}
          </p>
        )}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <select
            value={book.status}
            onChange={(e) => onUpdateStatus(e.target.value as WantedBook["status"])}
            className={`text-xs px-2 py-1 rounded border-0 cursor-pointer ${
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
          {book.series && (
            <span className="text-xs text-foreground-muted">
              {book.series} {book.seriesNumber && `#${book.seriesNumber}`}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2 self-start">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.epub,.mobi,.azw,.azw3,.cbr,.cbz,.m4b,.m4a,.mp3"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Upload button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="text-foreground-muted hover:text-primary transition-colors disabled:opacity-50"
          title="Upload book file"
        >
          {isUploading ? (
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
          )}
        </button>

        {/* Remove button */}
        <button
          onClick={onRemove}
          disabled={isUploading}
          className="text-foreground-muted hover:text-danger transition-colors disabled:opacity-50"
          title="Remove from wanted list"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
