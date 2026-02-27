"use client";

import { useState } from "react";
import { EditBookModal } from "./EditBookModal";
import { buttonStyles } from "../lib/styles";
import type { Book, Tag } from "../lib/db/schema";

interface EditBookButtonProps {
  book: Book;
  tags: Tag[];
  bookFormat: string;
  hasCover: boolean;
  coverUrl?: string;
  bookAuthors: string[];
  hasConvertedEpub?: boolean;
}

export function EditBookButton({ book, tags, bookFormat, hasCover, coverUrl, bookAuthors, hasConvertedEpub }: EditBookButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={`${buttonStyles.base} ${buttonStyles.ghost} px-2.5`}
        title="Edit Details"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
          />
        </svg>
      </button>
      <EditBookModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        book={book}
        currentTags={tags}
        bookFormat={bookFormat}
        hasCover={hasCover}
        coverUrl={coverUrl}
        bookAuthors={bookAuthors}
        hasConvertedEpub={hasConvertedEpub}
      />
    </>
  );
}
