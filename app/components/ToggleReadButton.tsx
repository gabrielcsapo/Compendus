"use client";

import { useState } from "react";
import { useRouter } from "react-flight-router/client";
import { toggleBookReadStatus } from "../actions/books";
import { buttonStyles } from "../lib/styles";
import type { Book } from "../lib/db/schema";

interface ToggleReadButtonProps {
  book: Book;
}

export function ToggleReadButton({ book }: ToggleReadButtonProps) {
  const router = useRouter();
  const [isUpdating, setIsUpdating] = useState(false);
  const isRead = book.isRead ?? false;

  const handleToggle = async () => {
    setIsUpdating(true);
    try {
      await toggleBookReadStatus(book.id, !isRead);
      router.refresh();
    } catch {
      setIsUpdating(false);
    }
  };

  return (
    <button
      onClick={handleToggle}
      disabled={isUpdating}
      className={`${buttonStyles.base} ${buttonStyles.secondary} w-full text-center justify-center flex items-center gap-2 ${
        isRead ? "!border-success !text-success hover:!bg-success hover:!text-white" : ""
      }`}
    >
      {isRead ? (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      )}
      {isUpdating ? "Updating..." : isRead ? "Mark as Unread" : "Mark as Read"}
    </button>
  );
}
