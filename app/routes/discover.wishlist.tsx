"use client";

import { useState, useEffect } from "react";
import { getWantedBooks, removeFromWantedList, updateWantedBook } from "../actions/wanted";
import type { WantedBook } from "../lib/db/schema";

export function Component() {
  const [wantedBooks, setWantedBooksState] = useState<WantedBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
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
          {wantedBooks.map((book) => (
            <WantedBookCard
              key={book.id}
              book={book}
              onRemove={() => handleRemove(book.id)}
              onUpdateStatus={(status) => handleUpdateStatus(book.id, status)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WantedBookCard({
  book,
  onRemove,
  onUpdateStatus,
}: {
  book: WantedBook;
  onRemove: () => void;
  onUpdateStatus: (status: WantedBook["status"]) => void;
}) {
  const authors = book.authors ? JSON.parse(book.authors) : [];

  return (
    <div className="bg-surface border border-border rounded-xl p-4 flex gap-4">
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
      <button
        onClick={onRemove}
        className="text-foreground-muted hover:text-danger transition-colors self-start"
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
  );
}
