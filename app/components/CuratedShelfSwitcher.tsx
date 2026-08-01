"use client";

import { useState } from "react";
import type { BookWithState } from "../actions/books";
import type { CuratedShelf } from "../lib/discovery/curation";
import { BookCarousel } from "./BookCarousel";

type ShelfWithBooks = CuratedShelf & { books: BookWithState[] };

/** Show one recommendation mode at a time instead of stacking every rail. */
export function CuratedShelfSwitcher({ shelves }: { shelves: ShelfWithBooks[] }) {
  const available = shelves.filter((shelf) => shelf.books.length > 0);
  const [selectedId, setSelectedId] = useState(available[0]?.id ?? "");
  const selected = available.find((shelf) => shelf.id === selectedId) ?? available[0];

  if (!selected) return null;

  return (
    <div className="space-y-4">
      {available.length > 1 && (
        <div
          className="flex gap-2 overflow-x-auto pb-1"
          role="tablist"
          aria-label="For you shelves"
        >
          {available.map((shelf) => {
            const active = shelf.id === selected.id;
            return (
              <button
                key={shelf.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedId(shelf.id)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-primary text-white"
                    : "bg-surface-elevated text-foreground-muted hover:text-foreground"
                }`}
              >
                {shelf.title}
              </button>
            );
          })}
        </div>
      )}
      <BookCarousel
        title={selected.title}
        subtitle={selected.subtitle}
        books={selected.books.slice(0, 10)}
      />
    </div>
  );
}
