"use client";

import { useState } from "react";
import { useRouter } from "react-flight-router/client";
import { rateBook } from "../actions/books";
import { StarRating } from "./StarRating";
import { buttonStyles } from "../lib/styles";
import type { Book } from "../lib/db/schema";

interface BookReviewProps {
  book: Book;
}

export function BookReview({ book }: BookReviewProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editRating, setEditRating] = useState<number | null>(book.rating ?? null);
  const [editReview, setEditReview] = useState(book.review ?? "");

  const hasContent = book.rating != null || book.review;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await rateBook(book.id, editRating, editReview || null);
      setIsEditing(false);
      router.refresh();
    } catch {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditRating(book.rating ?? null);
    setEditReview(book.review ?? "");
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium text-foreground-muted block mb-2">Rating</label>
          <StarRating rating={editRating} onChange={setEditRating} />
        </div>
        <div>
          <label className="text-sm font-medium text-foreground-muted block mb-2">Review</label>
          <textarea
            value={editReview}
            onChange={(e) => setEditReview(e.target.value)}
            placeholder="Write your thoughts about this book..."
            className="w-full px-4 py-3 rounded-lg bg-surface border border-border text-foreground placeholder:text-foreground-muted focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary-light resize-y min-h-[100px]"
            rows={4}
          />
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={handleCancel}
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
    );
  }

  return (
    <div className="space-y-3">
      {hasContent ? (
        <>
          {book.rating != null && (
            <div className="flex items-center gap-3">
              <StarRating rating={book.rating} readonly />
              <span className="text-sm text-foreground-muted">{book.rating} / 5</span>
            </div>
          )}
          {book.review && (
            <p className="text-foreground whitespace-pre-line leading-relaxed">{book.review}</p>
          )}
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="text-sm text-primary hover:text-primary-hover transition-colors"
          >
            Edit rating & review
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className={`${buttonStyles.base} ${buttonStyles.ghost} text-foreground-muted`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
            />
          </svg>
          Add rating & review
        </button>
      )}
    </div>
  );
}
