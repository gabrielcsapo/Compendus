"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { BookGrid } from "./BookGrid";
import type { Book } from "../lib/db/schema";
import type { SortOption } from "./SortDropdown";
import type { TypeFilter } from "./TypeTabs";

const BOOKS_PER_PAGE = 24;

function LoadingSpinner() {
  return (
    <div className="flex items-center gap-2 text-foreground-muted">
      <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span className="text-sm">Loading more books...</span>
    </div>
  );
}

interface InfiniteBookGridProps {
  initialBooks: Book[];
  totalCount: number;
  currentSort: SortOption;
  currentType: TypeFilter;
  currentFormats: string[];
  seriesFilter: string | null;
  emptyMessage?: string;
}

export function InfiniteBookGrid({
  initialBooks,
  totalCount,
  currentSort,
  currentType,
  currentFormats,
  seriesFilter,
  emptyMessage,
}: InfiniteBookGridProps) {
  const [books, setBooks] = useState<Book[]>(initialBooks);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(initialBooks.length < totalCount);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset when loader data changes (filter/sort change triggers navigation)
  useEffect(() => {
    setBooks(initialBooks);
    setHasMore(initialBooks.length < totalCount);
  }, [initialBooks, totalCount]);

  const buildFetchUrl = useCallback((offset: number) => {
    const params = new URLSearchParams();
    params.set("offset", String(offset));
    if (currentSort !== "recent") params.set("sort", currentSort);
    if (currentType !== "all") params.set("type", currentType);
    if (currentFormats.length > 0) params.set("format", currentFormats.join(","));
    if (seriesFilter) params.set("series", seriesFilter);
    return `/api/library?${params.toString()}`;
  }, [currentSort, currentType, currentFormats, seriesFilter]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const res = await fetch(buildFetchUrl(books.length));
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      const newBooks: Book[] = data.books.map((b: Record<string, unknown>) => ({
        ...b,
        createdAt: b.createdAt ? new Date(b.createdAt as string) : null,
        updatedAt: b.updatedAt ? new Date(b.updatedAt as string) : null,
        lastReadAt: b.lastReadAt ? new Date(b.lastReadAt as string) : null,
        importedAt: b.importedAt ? new Date(b.importedAt as string) : null,
      }));
      setBooks(prev => [...prev, ...newBooks]);
      if (newBooks.length < BOOKS_PER_PAGE) {
        setHasMore(false);
      }
    } catch (err) {
      console.error("Failed to load more books:", err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [books.length, isLoadingMore, hasMore, buildFetchUrl]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: "400px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  return (
    <>
      <BookGrid books={books} emptyMessage={emptyMessage} />
      {/* Infinite scroll sentinel */}
      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-8">
          {isLoadingMore && <LoadingSpinner />}
        </div>
      )}
      {!hasMore && books.length > BOOKS_PER_PAGE && (
        <p className="text-center text-foreground-muted py-8 text-sm">
          Showing all {totalCount} books
        </p>
      )}
    </>
  );
}
