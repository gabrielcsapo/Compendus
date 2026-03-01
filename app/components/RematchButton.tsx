"use client";

import { useState } from "react";
import { RematchModal } from "./RematchModal";
import { buttonStyles } from "../lib/styles";
import type { BookFormat } from "../lib/types";

interface RematchButtonProps {
  bookId: string;
  bookTitle: string;
  bookAuthors: string[];
  bookFormat?: BookFormat;
  hasCover?: boolean;
  coverUrl?: string;
}

export function RematchButton({ bookId, bookTitle, bookAuthors, bookFormat, hasCover, coverUrl }: RematchButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={`${buttonStyles.base} ${buttonStyles.ghost} px-2.5`}
        title="Rematch Metadata"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>
      <RematchModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        bookId={bookId}
        bookTitle={bookTitle}
        bookAuthors={bookAuthors}
        bookFormat={bookFormat}
        hasCover={hasCover}
        coverUrl={coverUrl}
      />
    </>
  );
}
