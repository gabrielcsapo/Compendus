"use client";

import { useState, useEffect, useTransition, useRef } from "react";
import { Link } from "react-flight-router/client";
import { getAllHighlights, deleteHighlight, updateHighlightNote } from "../actions/reader";
import { HighlightNote } from "../components/HighlightNote";
import { BookCover } from "../components/BookCover";

type HighlightItem = Awaited<ReturnType<typeof getAllHighlights>>[number];

type HighlightGroup = {
  bookId: string;
  bookTitle: string;
  bookAuthors: string[];
  bookCoverPath?: string;
  bookUpdatedAt?: Date;
  bookFormat: string;
  highlights: HighlightItem[];
};

type HighlightsData = {
  totalCount: number;
  groups: HighlightGroup[];
};

function groupHighlights(highlights: HighlightItem[]): HighlightsData {
  const grouped = new Map<string, HighlightGroup>();
  for (const h of highlights) {
    if (!grouped.has(h.bookId)) {
      grouped.set(h.bookId, {
        bookId: h.bookId,
        bookTitle: h.bookTitle,
        bookAuthors: h.bookAuthors,
        bookCoverPath: h.bookCoverPath,
        bookUpdatedAt: h.bookUpdatedAt,
        bookFormat: h.bookFormat,
        highlights: [],
      });
    }
    grouped.get(h.bookId)!.highlights.push(h);
  }
  return { totalCount: highlights.length, groups: Array.from(grouped.values()) };
}

export default function Highlights({ initialHighlights }: { initialHighlights?: HighlightItem[] }) {
  const [data, setData] = useState<HighlightsData | null>(
    initialHighlights ? groupHighlights(initialHighlights) : null,
  );
  const [loading, setLoading] = useState(!initialHighlights);
  const [isPending, startTransition] = useTransition();
  const hadInitialData = useRef(!!initialHighlights);

  const loadData = async () => {
    const highlights = await getAllHighlights();
    setData(groupHighlights(highlights));
    setLoading(false);
  };

  useEffect(() => {
    if (hadInitialData.current) {
      hadInitialData.current = false;
      return;
    }
    loadData();
  }, []);

  const handleDelete = (highlightId: string) => {
    // Optimistic: remove from local state immediately
    setData((prev) => {
      if (!prev) return prev;
      const newGroups = prev.groups
        .map((g) => ({
          ...g,
          highlights: g.highlights.filter((h) => h.id !== highlightId),
        }))
        .filter((g) => g.highlights.length > 0);
      return { totalCount: prev.totalCount - 1, groups: newGroups };
    });

    startTransition(async () => {
      try {
        await deleteHighlight(highlightId);
      } catch {
        // Revert on error by refetching
        await loadData();
      }
    });
  };

  const handleUpdateNote = (highlightId: string, note: string | null) => {
    // Optimistic: update in local state immediately
    setData((prev) => {
      if (!prev) return prev;
      const newGroups = prev.groups.map((g) => ({
        ...g,
        highlights: g.highlights.map((h) =>
          h.id === highlightId ? { ...h, note: note ?? undefined } : h,
        ),
      }));
      return { ...prev, groups: newGroups };
    });

    startTransition(async () => {
      try {
        await updateHighlightNote(highlightId, note);
      } catch {
        await loadData();
      }
    });
  };

  if (loading || !data) {
    return (
      <main className="container my-8 px-6 mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground">Highlights</h1>
          <p className="text-foreground-muted">Loading...</p>
        </div>
      </main>
    );
  }

  const { totalCount, groups } = data;

  return (
    <main className="container my-8 px-6 mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Highlights</h1>
        <p className="text-foreground-muted">
          {totalCount} {totalCount === 1 ? "highlight" : "highlights"} across {groups.length}{" "}
          {groups.length === 1 ? "book" : "books"}
        </p>
      </div>

      {groups.length > 0 ? (
        <div className="space-y-8">
          {groups.map((group) => (
            <div key={group.bookId}>
              {/* Book header */}
              <Link to={`/book/${group.bookId}`} className="flex items-center gap-4 mb-4 group">
                <div className="w-12 h-[4.5rem] rounded-md shadow-sm overflow-hidden">
                  <BookCover
                    book={{
                      id: group.bookId,
                      title: group.bookTitle,
                      coverPath: group.bookCoverPath ?? null,
                      updatedAt: group.bookUpdatedAt,
                    }}
                  />
                </div>
                <div>
                  <h2 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                    {group.bookTitle}
                  </h2>
                  <p className="text-sm text-foreground-muted">
                    {group.bookAuthors.join(", ") || "Unknown Author"}
                    {" · "}
                    {group.highlights.length}{" "}
                    {group.highlights.length === 1 ? "highlight" : "highlights"}
                  </p>
                </div>
              </Link>

              {/* Highlights list */}
              <div className="space-y-3 pl-4 border-l-2 border-border ml-6">
                {group.highlights.map((highlight) => (
                  <div
                    key={highlight.id}
                    className="bg-surface border border-border rounded-lg p-4 relative group/item"
                  >
                    <div className="flex gap-3">
                      {/* Color indicator */}
                      <div
                        className="w-1 rounded-full flex-shrink-0"
                        style={{ backgroundColor: highlight.color }}
                      />
                      <div className="flex-1 min-w-0">
                        {/* Highlighted text */}
                        <p className="text-foreground italic leading-relaxed">
                          &ldquo;{highlight.text}&rdquo;
                        </p>
                        {/* Note */}
                        <HighlightNote
                          highlightId={highlight.id}
                          note={highlight.note}
                          onUpdateNote={handleUpdateNote}
                        />
                        {/* Metadata */}
                        <div className="flex items-center gap-3 mt-2 text-sm text-foreground-muted">
                          <span>
                            {new Date(highlight.createdAt).toLocaleDateString(undefined, {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        </div>
                      </div>
                      {/* Delete button */}
                      <div className="flex-shrink-0">
                        <button
                          onClick={() => handleDelete(highlight.id)}
                          disabled={isPending}
                          className="opacity-0 group-hover/item:opacity-100 transition-opacity p-1 rounded hover:bg-surface-elevated text-foreground-muted hover:text-red-500"
                          title="Delete highlight"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={1.5}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-16 bg-surface border border-border rounded-xl">
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
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
              />
            </svg>
          </div>
          <p className="text-foreground-muted mb-2">No highlights yet</p>
          <p className="text-foreground-muted/60 text-sm">
            Highlights you create while reading will appear here
          </p>
        </div>
      )}
    </main>
  );
}
