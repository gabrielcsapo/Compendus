"use client";

import { useCallback } from "react";

export function SearchInput() {
  const handleClick = useCallback(() => {
    window.dispatchEvent(new CustomEvent("open-search-palette"));
  }, []);

  return (
    <button
      onClick={handleClick}
      className="flex h-10 w-10 items-center justify-center rounded-xl text-foreground-muted transition-colors hover:bg-surface-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
      aria-label="Search books"
      title="Search books (⌘K)"
    >
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
    </button>
  );
}
