"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import { createPortal } from "react-dom";
import { quickSearch, type QuickSearchResult } from "../actions/search";

export function SearchCommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QuickSearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Handle keyboard shortcut to open palette
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen(true);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Listen for custom event to open palette (from search button)
  useEffect(() => {
    function handleOpenPalette() {
      setIsOpen(true);
    }
    window.addEventListener("open-search-palette", handleOpenPalette);
    return () => window.removeEventListener("open-search-palette", handleOpenPalette);
  }, []);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([]);
      return;
    }

    setIsLoading(true);
    const timeout = setTimeout(async () => {
      const searchResults = await quickSearch(query);
      setResults(searchResults);
      setSelectedIndex(0);
      setIsLoading(false);
    }, 200);

    return () => clearTimeout(timeout);
  }, [query]);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const navigateToBook = useCallback(
    (bookId: string) => {
      close();
      navigate(`/book/${bookId}`);
    },
    [close, navigate],
  );

  const navigateToSearch = useCallback(() => {
    if (query.trim()) {
      close();
      navigate(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  }, [close, navigate, query]);

  // Handle keyboard navigation within modal
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          close();
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (results.length > 0 && results[selectedIndex]) {
            navigateToBook(results[selectedIndex].id);
          } else if (query.trim()) {
            navigateToSearch();
          }
          break;
      }
    },
    [close, results, selectedIndex, navigateToBook, navigateToSearch, query],
  );

  if (!isOpen) return null;

  const modal = (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={close}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative w-full max-w-xl mx-4 bg-surface rounded-2xl shadow-2xl overflow-hidden border border-border"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center border-b border-border px-4 gap-3">
          <svg
            className="w-5 h-5 text-foreground-muted flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search books..."
            className="flex-1 py-4 text-lg outline-none bg-transparent text-foreground placeholder:text-foreground-muted"
          />
          {isLoading && (
            <div className="w-5 h-5 border-2 border-border border-t-primary rounded-full animate-spin" />
          )}
          <kbd className="hidden sm:inline-block px-2 py-1 text-xs text-foreground-muted bg-surface-elevated rounded border border-border font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        {query.length >= 2 && (
          <div className="max-h-96 overflow-y-auto">
            {results.length > 0 ? (
              <>
                <ul className="py-2">
                  {results.map((book, index) => {
                    const authors = book.authors ? JSON.parse(book.authors) : [];
                    return (
                      <li key={book.id}>
                        <button
                          className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                            index === selectedIndex
                              ? "bg-primary-light"
                              : "hover:bg-surface-elevated"
                          }`}
                          onClick={() => navigateToBook(book.id)}
                          onMouseEnter={() => setSelectedIndex(index)}
                        >
                          {/* Cover thumbnail */}
                          <div
                            className="w-10 h-14 flex-shrink-0 rounded-lg overflow-hidden bg-surface-elevated"
                            style={{
                              backgroundColor: book.coverColor || undefined,
                            }}
                          >
                            {book.coverPath && (
                              <img
                                src={`/covers/${book.id}.jpg?v=${book.updatedAt?.getTime() || ""}`}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            )}
                          </div>
                          {/* Book info */}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate text-foreground">{book.title}</div>
                            {authors.length > 0 && (
                              <div className="text-sm text-foreground-muted truncate">
                                {authors.join(", ")}
                              </div>
                            )}
                          </div>
                          {/* Format badge */}
                          <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-primary-light text-primary uppercase flex-shrink-0">
                            {book.format}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {/* View all results link */}
                <div className="border-t border-border px-4 py-3">
                  <button
                    className="text-sm text-primary hover:text-primary-hover font-medium transition-colors"
                    onClick={navigateToSearch}
                  >
                    View all results for "{query}" →
                  </button>
                </div>
              </>
            ) : !isLoading ? (
              <div className="px-4 py-8 text-center text-foreground-muted">
                No books found for "{query}"
              </div>
            ) : null}
          </div>
        )}

        {/* Empty state */}
        {query.length < 2 && (
          <div className="px-4 py-8 text-center text-foreground-muted text-sm">
            Type to search your library
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
