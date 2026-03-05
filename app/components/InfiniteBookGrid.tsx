"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { BookCard } from "./BookCard";
import type { Book } from "../lib/db/schema";
import type { SortOption } from "./SortDropdown";
import type { TypeFilter } from "./TypeTabs";

const BOOKS_PER_PAGE = 24;
const GAP = 20; // matches gap-5 (1.25rem = 20px)

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

function useColumns(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [columns, setColumns] = useState(6);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function update(width: number) {
      // Match BookGrid breakpoints: grid-cols-2 sm:3 md:4 lg:5 xl:6
      if (width >= 1280) setColumns(6);
      else if (width >= 1024) setColumns(5);
      else if (width >= 768) setColumns(4);
      else if (width >= 640) setColumns(3);
      else setColumns(2);
    }

    const observer = new ResizeObserver(([entry]) => {
      update(entry.contentRect.width);
    });
    observer.observe(el);
    update(el.clientWidth);
    return () => observer.disconnect();
  }, [containerRef]);

  return columns;
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
  emptyMessage = "No books found",
}: InfiniteBookGridProps) {
  const [books, setBooks] = useState<Book[]>(initialBooks);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(initialBooks.length < totalCount);
  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const columns = useColumns(containerRef);

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

  // Build rows from flat book list
  const rows = useMemo(() => {
    const result: Book[][] = [];
    for (let i = 0; i < books.length; i += columns) {
      result.push(books.slice(i, i + columns));
    }
    return result;
  }, [books, columns]);

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => 380, // approximate row height (card aspect-ratio 2/3 + info)
    overscan: 3,
  });

  if (books.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-elevated flex items-center justify-center">
          <svg
            className="w-8 h-8 text-foreground-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
            />
          </svg>
        </div>
        <p className="text-foreground-muted">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <>
      <div ref={containerRef}>
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            return (
              <div
                key={virtualRow.index}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    gap: `${GAP}px`,
                    paddingBottom: `${GAP}px`,
                  }}
                >
                  {row.map((book) => (
                    <BookCard key={book.id} book={book} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
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
