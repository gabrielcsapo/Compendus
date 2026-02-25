"use client";

import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-flight-router/client";
import { getTagsWithCounts, getBooksWithTag } from "../actions/tags";
import { BookGrid } from "../components/BookGrid";

type TagsData = {
  tags: Awaited<ReturnType<typeof getTagsWithCounts>>;
  selectedTag: Awaited<ReturnType<typeof getTagsWithCounts>>[number] | null;
  books: Awaited<ReturnType<typeof getBooksWithTag>>;
};

export default function Tags() {
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<TagsData | null>(null);
  const [loading, setLoading] = useState(true);

  const selectedTagId = searchParams.get("tag");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function loadData(): Promise<TagsData> {
      const tags = await getTagsWithCounts();

      let books: Awaited<ReturnType<typeof getBooksWithTag>> = [];
      let selectedTag = null;

      if (selectedTagId) {
        selectedTag = tags.find((t) => t.id === selectedTagId) || null;
        if (selectedTag) {
          books = await getBooksWithTag(selectedTagId);
        }
      }

      return { tags, selectedTag, books };
    }

    loadData().then(result => {
      if (!cancelled) {
        setData(result);
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [selectedTagId]);

  if (loading || !data) {
    return (
      <main className="container my-8 px-6 mx-auto">
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </main>
    );
  }

  const { tags, selectedTag, books } = data;

  return (
    <main className="container my-8 px-6 mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Tags</h1>
        <p className="text-foreground-muted">
          {tags.length} {tags.length === 1 ? "tag" : "tags"}
        </p>
      </div>

      {/* Tag cloud */}
      <div className="bg-surface border border-border rounded-xl p-6 mb-8">
        <div className="flex flex-wrap gap-2">
          {tags.length > 0 ? (
            tags.map((tag) => (
              <Link
                key={tag.id}
                to={`/tags?tag=${tag.id}`}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full transition-all duration-200 ${
                  selectedTag?.id === tag.id
                    ? "bg-primary text-white shadow-md"
                    : "bg-surface-elevated text-foreground hover:bg-primary-light hover:text-primary"
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
                {tag.name}
                <span
                  className={`text-xs ${selectedTag?.id === tag.id ? "text-white/70" : "text-foreground-muted"}`}
                >
                  ({tag.count})
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
          <BookGrid books={books} emptyMessage={`No books tagged "${selectedTag.name}"`} />
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
