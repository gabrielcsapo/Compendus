"use client";

import { useState, useEffect } from "react";
import { useRouter } from "react-flight-router/client";
import { rateBook } from "../actions/books";
import { StarRating } from "./StarRating";
import { buttonStyles } from "../lib/styles";
import type { Book } from "../lib/db/schema";

interface BookRatingProps {
  book: Book;
}

/**
 * Inline star rating that opens a modal for editing both the rating and the
 * written review. Replaces the standalone "Rating & Review" section.
 */
export function BookRating({ book }: BookRatingProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [rating, setRating] = useState<number | null>(book.rating ?? null);
  const [review, setReview] = useState(book.review ?? "");

  const openModal = () => {
    setRating(book.rating ?? null);
    setReview(book.review ?? "");
    setOpen(true);
  };

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("keydown", onEsc);
      return () => document.removeEventListener("keydown", onEsc);
    }
  }, [open]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await rateBook(book.id, rating, review || null);
      setOpen(false);
      router.refresh();
    } catch {
      setIsSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="inline-flex items-center gap-2 group cursor-pointer"
        title={book.rating != null ? "Edit rating & review" : "Add rating & review"}
      >
        <StarRating rating={book.rating ?? null} readonly />
        <span className="text-sm text-foreground-muted group-hover:text-foreground transition-colors">
          {book.rating != null ? `${book.rating}/5` : "Rate this book"}
          {book.review ? " · Review" : ""}
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative bg-surface border border-border rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Rating &amp; Review</h2>

            <div className="mb-4">
              <label className="text-sm font-medium text-foreground-muted block mb-2">
                Your rating
              </label>
              <StarRating rating={rating} onChange={setRating} />
            </div>

            <div className="mb-4">
              <label className="text-sm font-medium text-foreground-muted block mb-2">Review</label>
              <textarea
                value={review}
                onChange={(e) => setReview(e.target.value)}
                placeholder="Write your thoughts about this book..."
                rows={5}
                className="w-full px-4 py-3 rounded-lg bg-surface border border-border text-foreground placeholder:text-foreground-muted focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary-light resize-y min-h-[120px]"
              />
            </div>

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={isSaving}
                className={`${buttonStyles.base} ${buttonStyles.ghost}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className={`${buttonStyles.base} ${buttonStyles.primary}`}
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
