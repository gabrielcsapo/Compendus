"use client";

import { useState } from "react";
import { deleteBook } from "../actions/books";
import type { Book } from "../lib/db/schema";

interface DeleteBookButtonProps {
  book: Book;
}

export function DeleteBookButton({ book }: DeleteBookButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);
    try {
      const success = await deleteBook(book.id);
      if (success) {
        window.location.href = "/";
      } else {
        setError("Failed to delete book");
        setIsDeleting(false);
      }
    } catch {
      setError("Failed to delete book");
      setIsDeleting(false);
    }
  };

  const handleClose = () => {
    if (!isDeleting) {
      setIsOpen(false);
      setError(null);
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="btn btn-secondary w-full mt-2 text-center justify-center flex items-center gap-2 text-error hover:bg-error hover:text-white hover:border-error"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
          />
        </svg>
        Delete Book
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={handleClose} />
          <div className="relative bg-surface border border-border rounded-xl p-6 w-full max-w-md mx-4 shadow-xl">
            <h2 className="text-xl font-bold mb-4 text-foreground">Delete Book</h2>

            <p className="text-foreground-muted mb-2">
              Are you sure you want to delete{" "}
              <strong className="text-foreground">{book.title}</strong>?
            </p>
            <p className="text-foreground-muted text-sm mb-6">
              This will permanently remove the book file, cover image, and all associated data
              including bookmarks, highlights, and reading progress. This action cannot be undone.
            </p>

            {error && (
              <div className="mb-4 p-3 bg-error/10 border border-error/20 rounded-lg text-error text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={handleClose}
                disabled={isDeleting}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="btn bg-error text-white hover:bg-error/90 border-error"
              >
                {isDeleting ? (
                  <>
                    <svg
                      className="animate-spin -ml-1 mr-2 h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Deleting...
                  </>
                ) : (
                  "Delete Book"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
