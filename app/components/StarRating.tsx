"use client";

import { useState } from "react";

interface StarRatingProps {
  rating: number | null;
  onChange?: (rating: number | null) => void;
  readonly?: boolean;
  size?: "sm" | "md";
}

function StarIcon({ filled }: { filled: boolean }) {
  if (filled) {
    return (
      <svg fill="currentColor" viewBox="0 0 24 24" className="w-full h-full">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    );
  }
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-full h-full">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

export function StarRating({ rating, onChange, readonly = false, size = "md" }: StarRatingProps) {
  const [hoverRating, setHoverRating] = useState<number | null>(null);

  const displayRating = hoverRating ?? rating ?? 0;
  const sizeClass = size === "sm" ? "w-4 h-4" : "w-6 h-6";

  return (
    <div
      className="inline-flex items-center gap-0.5"
      onMouseLeave={() => !readonly && setHoverRating(null)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          className={`${sizeClass} transition-colors ${
            readonly ? "cursor-default" : "cursor-pointer hover:scale-110"
          } ${star <= displayRating ? "text-amber-400" : "text-foreground-muted/30"}`}
          onMouseEnter={() => !readonly && setHoverRating(star)}
          onClick={() => {
            if (readonly || !onChange) return;
            // Click same star to clear
            onChange(star === rating ? null : star);
          }}
          title={readonly ? `${rating} of 5 stars` : star === rating ? "Clear rating" : `Rate ${star} of 5`}
        >
          <StarIcon filled={star <= displayRating} />
        </button>
      ))}
    </div>
  );
}
