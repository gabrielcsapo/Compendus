"use client";

import { useCallback } from "react";

export function SearchInput() {
  const handleClick = useCallback(() => {
    window.dispatchEvent(new CustomEvent("open-search-palette"));
  }, []);

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-surface-elevated hover:bg-surface border border-border text-foreground-muted hover:text-foreground transition-colors"
      aria-label="Search books"
    >
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      <span className="text-sm">Search</span>
      <kbd className="ml-auto hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-mono bg-background rounded border border-border">
        <span className="text-xs">⌘</span>K
      </kbd>
    </button>
  );
}
