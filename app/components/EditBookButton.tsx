"use client";

import { useState } from "react";
import { EditBookModal } from "./EditBookModal";
import type { Book, Tag } from "../lib/db/schema";

interface EditBookButtonProps {
  book: Book;
  tags: Tag[];
}

export function EditBookButton({ book, tags }: EditBookButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="btn btn-secondary w-full mt-2 text-center justify-center flex items-center gap-2"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
          />
        </svg>
        Edit Details
      </button>
      <EditBookModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        book={book}
        currentTags={tags}
      />
    </>
  );
}
