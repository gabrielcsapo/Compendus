"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { Link, useSearchParams } from "react-flight-router/client";
import { getTagsWithCounts, getBooksWithTag } from "../actions/tags";
import { BookGrid } from "../components/BookGrid";

type TagItem = Awaited<ReturnType<typeof getTagsWithCounts>>[number];

export default function Tags({
  initialTags,
  initialSelectedTagId,
  booksSlot,
}: {
  initialTags?: TagItem[];
  initialSelectedTagId?: string | null;
  /** Server-streamed books grid for the initially-selected tag. */
  booksSlot?: ReactNode;
}) {
  const [searchParams] = useSearchParams();
  const [tags, setTags] = useState<TagItem[] | null>(initialTags ?? null);
  const [books, setBooks] = useState<Awaited<ReturnType<typeof getBooksWithTag>>>([]);
  const [tagsLoading, setTagsLoading] = useState(!initialTags);
  const [booksLoading, setBooksLoading] = useState(false);
  const hadInitialTags = useRef(!!initialTags);
  // While true, the initially-selected tag's books are served by the streamed
  // booksSlot; a client-side tag change flips this off and fetches inline.
  const [showSlot, setShowSlot] = useState(initialSelectedTagId != null);

  const selectedTagId = searchParams.get("tag");
  const selectedTag = tags?.find((t) => t.id === selectedTagId) ?? null;
  const showBooksSlot = showSlot && selectedTagId === initialSelectedTagId;

  // Load tags once on mount (not on every tag selection)
  useEffect(() => {
    if (hadInitialTags.current) {
      hadInitialTags.current = false;
      return;
    }
    let cancelled = false;
    getTagsWithCounts().then((result) => {
      if (!cancelled) {
        setTags(result);
        setTagsLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load books only when selected tag changes
  useEffect(() => {
    if (!selectedTagId || !tags) {
      setBooks([]);
      return;
    }
    // The initially-selected tag is served by the streamed booksSlot — don't refetch.
    if (showSlot && selectedTagId === initialSelectedTagId) {
      return;
    }
    let cancelled = false;
    setBooksLoading(true);
    getBooksWithTag(selectedTagId).then((result) => {
      if (!cancelled) {
        setBooks(result);
        setBooksLoading(false);
        setShowSlot(false);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTagId, tags]);

  if (tagsLoading || !tags) {
    return (
      <main className="container my-8 px-6 mx-auto">
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto my-10 w-full max-w-[90rem] px-5 sm:my-14 sm:px-8 lg:px-11">
      <div className="mb-9 border-b border-border pb-8">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
          {tags.length} {tags.length === 1 ? "tag" : "tags"}
        </p>
        <h1 className="text-5xl font-extrabold leading-[.95] tracking-[-.06em] text-foreground sm:text-6xl">
          Browse by subject.
        </h1>
        <p className="mt-3 text-base text-foreground-muted">
          Follow a thread across formats, authors, and shelves.
        </p>
      </div>

      {/* Tag cloud */}
      <div className="mb-10">
        <div className="grid grid-cols-1 overflow-hidden rounded-2xl border border-border bg-surface sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tags.length > 0 ? (
            tags.map((tag) => (
              <Link
                key={tag.id}
                to={`/tags?tag=${tag.id}`}
                className={`flex min-w-0 items-center justify-between gap-4 border-b border-border px-4 py-3 text-sm transition-colors last:border-b-0 sm:border-r ${
                  selectedTag?.id === tag.id
                    ? "bg-primary text-white"
                    : "text-foreground hover:bg-primary-light hover:text-primary"
                }`}
                style={
                  tag.color && selectedTag?.id !== tag.id
                    ? {
                        backgroundColor: tag.color + "20",
                        color: tag.color,
                      }
                    : undefined
                }
              >
                <span className="truncate font-medium">{tag.name}</span>
                <span
                  className={`shrink-0 text-xs tabular-nums ${selectedTag?.id === tag.id ? "text-white/70" : "text-foreground-muted"}`}
                >
                  {tag.count}
                </span>
              </Link>
            ))
          ) : (
            <p className="text-foreground-muted py-4">
              No tags yet. Add tags to your books to organize them.
            </p>
          )}
        </div>
      </div>

      {/* Books with selected tag */}
      {selectedTag && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">
              Books tagged "{selectedTag.name}"
            </h2>
            <Link
              to="/tags"
              className="text-primary hover:text-primary-hover text-sm font-medium transition-colors"
            >
              Clear selection
            </Link>
          </div>
          {showBooksSlot ? (
            booksSlot
          ) : booksLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <BookGrid books={books} emptyMessage={`No books tagged "${selectedTag.name}"`} />
          )}
        </section>
      )}

      {/* Show prompt when no tag selected */}
      {!selectedTag && tags.length > 0 && (
        <div className="text-center py-12 text-foreground-muted">
          Select a tag above to see books
        </div>
      )}
    </main>
  );
}
