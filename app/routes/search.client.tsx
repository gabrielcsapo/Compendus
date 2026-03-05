"use client";

import { useState, useEffect } from "react";
import { Link, useSearchParams, useRouter } from "react-flight-router/client";
import { searchBooks, searchBooksCount, type MissingField } from "../actions/search";
import { getBooks, getBooksCount } from "../actions/books";
import { AuthorLinks } from "../components/AuthorLink";
import type { BookType } from "../lib/book-types";

const RESULTS_PER_PAGE = 20;
const VALID_MISSING_FIELDS: MissingField[] = ["cover", "authors", "tags", "language"];

type SearchData = {
  query: string;
  results: Array<{
    book: {
      id: string;
      title: string;
      authors: string | null;
      format: string;
      coverPath: string | null;
      coverColor: string | null;
      updatedAt: Date | null;
    };
    relevance: number;
    highlights: {
      title?: string;
      subtitle?: string;
      authors?: string;
      description?: string;
      content?: string;
      chapterTitle?: string;
    };
  }>;
  searchIn: string[];
  type: BookType | "all";
  missing: MissingField[];
  currentPage: number;
  totalPages: number;
  totalCount: number;
};

export default function Search() {
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<SearchData | null>(null);
  const [loading, setLoading] = useState(true);

  const query = searchParams.get("q") || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const typeParam = searchParams.get("type") as BookType | null;
  const type = typeParam && ["ebook", "audiobook", "comic"].includes(typeParam) ? typeParam : undefined;
  const missingParam = searchParams.get("missing");
  const missing = missingParam
    ? (missingParam.split(",").filter((f) => VALID_MISSING_FIELDS.includes(f as MissingField)) as MissingField[])
    : [];
  const hasQuery = query.trim().length >= 2;
  const hasMissing = missing.length > 0;
  const searchIn = searchParams.get("in")?.split(",") || ["title", "authors", "description"];
  const offset = (page - 1) * RESULTS_PER_PAGE;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function loadData(): Promise<SearchData> {
      // No query and no missing filters — show all books
      if (!hasQuery && !hasMissing) {
        const [allBooks, totalCount] = await Promise.all([
          getBooks({ limit: RESULTS_PER_PAGE, offset, type }),
          getBooksCount(type),
        ]);

        const results = allBooks.map((book) => ({
          book,
          relevance: 0,
          highlights: {
            title: book.title,
            subtitle: book.subtitle ?? undefined,
            authors: book.authors ?? undefined,
            description: book.description ?? undefined,
          },
        }));

        const totalPages = Math.ceil(totalCount / RESULTS_PER_PAGE);

        return {
          query,
          results,
          searchIn,
          type: type ?? ("all" as const),
          missing,
          currentPage: page,
          totalPages,
          totalCount,
        };
      }

      // Filter out "content" for the search API (handled separately) and cast to valid types
      const validSearchIn = searchIn.filter(
        (s): s is "title" | "subtitle" | "authors" | "description" => ["title", "subtitle", "authors", "description"].includes(s)
      );
      const searchOpts = {
        searchIn: validSearchIn.length > 0 ? validSearchIn : undefined,
        type,
        missing: hasMissing ? missing : undefined,
      };

      const [results, totalCount] = await Promise.all([
        searchBooks(query, { ...searchOpts, limit: RESULTS_PER_PAGE, offset }),
        searchBooksCount(query, searchOpts),
      ]);

      const totalPages = Math.ceil(totalCount / RESULTS_PER_PAGE);

      return { query, results, searchIn, type: type ?? ("all" as const), missing, currentPage: page, totalPages, totalCount };
    }

    loadData().then(result => {
      if (!cancelled) {
        setData(result);
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [searchParams.toString()]);

  if (loading || !data) {
    return (
      <main className="container my-8 px-6 mx-auto">
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </main>
    );
  }

  const { results, totalCount, currentPage, totalPages } = data;

  return (
    <main className="container my-8 px-6 mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-4 mb-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <Link
              to="/library"
              className="text-primary hover:text-primary-hover text-sm font-medium transition-colors"
            >
              &larr; Back to Library
            </Link>
            <h1 className="text-2xl font-bold mt-2 text-foreground">Search</h1>
            <p className="text-foreground-muted">
              {totalCount} result{totalCount !== 1 ? "s" : ""}
              {query ? ` for "${query}"` : ""}
              {missing.length > 0 ? ` missing ${missing.join(", ")}` : ""}
            </p>
          </div>
        </div>
        <InlineSearchInput defaultValue={query} missing={missing} type={type ?? "all"} />
      </div>

      {/* Search filters */}
      <div className="mb-6 bg-surface border border-border rounded-xl p-4 space-y-3">
        <div>
          <span className="text-sm text-foreground-muted mr-4">Type:</span>
          <div className="inline-flex gap-1 p-1 bg-surface-elevated rounded-lg">
            {(
              [
                { value: "all", label: "All" },
                { value: "ebook", label: "Ebooks" },
                { value: "audiobook", label: "Audiobooks" },
                { value: "comic", label: "Comics" },
              ] as const
            ).map((option) => {
              const isActive = (type ?? "all") === option.value;
              return (
                <TypeFilterLink
                  key={option.value}
                  label={option.label}
                  value={option.value}
                  query={query}
                  searchIn={searchIn}
                  missing={missing}
                  active={isActive}
                />
              );
            })}
          </div>
        </div>
        {query && (
          <div>
            <span className="text-sm text-foreground-muted mr-4">Search in:</span>
            <div className="inline-flex gap-2 flex-wrap">
              <FilterLink
                label="Title"
                field="title"
                query={query}
                active={searchIn.includes("title")}
                searchIn={searchIn}
                type={type ?? "all"}
                missing={missing}
              />
              <FilterLink
                label="Authors"
                field="authors"
                query={query}
                active={searchIn.includes("authors")}
                searchIn={searchIn}
                type={type ?? "all"}
                missing={missing}
              />
              <FilterLink
                label="Description"
                field="description"
                query={query}
                active={searchIn.includes("description")}
                searchIn={searchIn}
                type={type ?? "all"}
                missing={missing}
              />
              <FilterLink
                label="Full Text"
                field="content"
                query={query}
                active={searchIn.includes("content")}
                searchIn={searchIn}
                type={type ?? "all"}
                missing={missing}
              />
            </div>
          </div>
        )}
        <div>
          <span className="text-sm text-foreground-muted mr-4">Missing:</span>
          <div className="inline-flex gap-2 flex-wrap">
            {(
              [
                { value: "cover", label: "Cover" },
                { value: "authors", label: "Author" },
                { value: "tags", label: "Category" },
                { value: "language", label: "Language" },
              ] as const
            ).map((option) => (
              <MissingFilterLink
                key={option.value}
                label={option.label}
                field={option.value}
                query={query}
                active={missing.includes(option.value)}
                searchIn={searchIn}
                type={type ?? "all"}
                missing={missing}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Results */}
      {results.length > 0 ? (
        <div className="space-y-4">
          {results.map((result) => (
            <SearchResultCard key={result.book.id} result={result} />
          ))}
          <SearchPagination
            currentPage={currentPage}
            totalPages={totalPages}
            query={query}
            searchIn={searchIn}
            type={type ?? "all"}
            missing={missing}
          />
        </div>
      ) : (
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
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <p className="text-foreground-muted mb-2">
            {query ? `No books found matching "${query}"` : missing.length > 0 ? "No books found with missing fields" : "No books in your library"}
          </p>
          <p className="text-foreground-muted/60 text-sm">
            {query ? "Try different keywords or enable Full Text search" : missing.length > 0 ? "All your books have complete metadata!" : ""}
          </p>
        </div>
      )}
    </main>
  );
}

function InlineSearchInput({
  defaultValue,
  missing,
  type,
}: {
  defaultValue: string;
  missing: string[];
  type: string;
}) {
  const router = useRouter();
  const [inputValue, setInputValue] = useState(defaultValue);

  useEffect(() => {
    setInputValue(defaultValue);
  }, [defaultValue]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (inputValue) params.set("q", inputValue);
    if (missing.length > 0) params.set("missing", missing.join(","));
    if (type !== "all") params.set("type", type);
    router.navigate(`/search?${params.toString()}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <div className="relative flex-1">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground-muted pointer-events-none"
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
          type="text"
          name="q"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Search books..."
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-surface-elevated text-foreground placeholder:text-foreground-muted outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
        />
      </div>
      <button
        type="submit"
        className="px-4 py-2.5 rounded-xl bg-primary text-white font-medium hover:bg-primary-hover transition-colors"
      >
        Search
      </button>
    </form>
  );
}

function buildSearchUrl(query: string, searchIn: string[], type?: string, missing?: string[], page?: number) {
  const params = new URLSearchParams();
  if (query) {
    params.set("q", query);
    params.set("in", searchIn.join(","));
  }
  if (type && type !== "all") {
    params.set("type", type);
  }
  if (missing && missing.length > 0) {
    params.set("missing", missing.join(","));
  }
  if (page && page > 1) {
    params.set("page", String(page));
  }
  return `/search?${params.toString()}`;
}

function TypeFilterLink({
  label,
  value,
  query,
  searchIn,
  missing,
  active,
}: {
  label: string;
  value: string;
  query: string;
  searchIn: string[];
  missing: string[];
  active: boolean;
}) {
  return (
    <Link
      to={buildSearchUrl(query, searchIn, value, missing)}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
        active
          ? "bg-primary text-white shadow-sm"
          : "text-foreground-muted hover:text-foreground hover:bg-surface"
      }`}
    >
      {label}
    </Link>
  );
}

function FilterLink({
  label,
  field,
  query,
  active,
  searchIn,
  type,
  missing,
}: {
  label: string;
  field: string;
  query: string;
  active: boolean;
  searchIn: string[];
  type?: string;
  missing: string[];
}) {
  const newSearchIn = active ? searchIn.filter((s) => s !== field) : [...searchIn, field];

  // Ensure at least one filter is active
  if (newSearchIn.length === 0) {
    newSearchIn.push("title");
  }

  return (
    <Link
      to={buildSearchUrl(query, newSearchIn, type, missing)}
      className={`px-3 py-1.5 text-sm rounded-full font-medium transition-all duration-200 ${
        active
          ? "bg-primary text-white"
          : "bg-surface-elevated text-foreground-muted hover:bg-primary-light hover:text-primary"
      }`}
    >
      {label}
    </Link>
  );
}

function MissingFilterLink({
  label,
  field,
  query,
  active,
  searchIn,
  type,
  missing,
}: {
  label: string;
  field: string;
  query: string;
  active: boolean;
  searchIn: string[];
  type?: string;
  missing: string[];
}) {
  const newMissing = active ? missing.filter((m) => m !== field) : [...missing, field];

  return (
    <Link
      to={buildSearchUrl(query, searchIn, type, newMissing)}
      className={`px-3 py-1.5 text-sm rounded-full font-medium transition-all duration-200 ${
        active
          ? "bg-warning text-white"
          : "bg-surface-elevated text-foreground-muted hover:bg-warning-light hover:text-warning"
      }`}
    >
      {label}
    </Link>
  );
}

function SearchPagination({
  currentPage,
  totalPages,
  query,
  searchIn,
  type,
  missing,
}: {
  currentPage: number;
  totalPages: number;
  query: string;
  searchIn: string[];
  type?: string;
  missing: string[];
}) {
  if (totalPages <= 1) return null;

  const pages: (number | "...")[] = [];

  pages.push(1);
  if (currentPage > 3) {
    pages.push("...");
  }
  for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
    if (!pages.includes(i)) {
      pages.push(i);
    }
  }
  if (currentPage < totalPages - 2) {
    pages.push("...");
  }
  if (totalPages > 1 && !pages.includes(totalPages)) {
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center justify-center gap-2 mt-8">
      {currentPage > 1 ? (
        <Link
          to={buildSearchUrl(query, searchIn, type, missing, currentPage - 1)}
          className="px-3 py-2 rounded-lg border border-border hover:bg-surface-elevated text-foreground transition-colors"
        >
          &larr; Prev
        </Link>
      ) : (
        <span className="px-3 py-2 rounded-lg border border-border text-foreground-muted opacity-50">
          &larr; Prev
        </span>
      )}

      <div className="flex items-center gap-1">
        {pages.map((page, index) =>
          page === "..." ? (
            <span key={`ellipsis-${index}`} className="px-2 text-foreground-muted">
              ...
            </span>
          ) : (
            <Link
              key={page}
              to={buildSearchUrl(query, searchIn, type, missing, page)}
              className={`px-3 py-2 rounded-lg border transition-colors ${
                page === currentPage
                  ? "bg-primary text-white border-primary"
                  : "border-border hover:bg-surface-elevated text-foreground"
              }`}
            >
              {page}
            </Link>
          ),
        )}
      </div>

      {currentPage < totalPages ? (
        <Link
          to={buildSearchUrl(query, searchIn, type, missing, currentPage + 1)}
          className="px-3 py-2 rounded-lg border border-border hover:bg-surface-elevated text-foreground transition-colors"
        >
          Next &rarr;
        </Link>
      ) : (
        <span className="px-3 py-2 rounded-lg border border-border text-foreground-muted opacity-50">
          Next &rarr;
        </span>
      )}
    </div>
  );
}

function SearchResultCard({
  result,
}: {
  result: {
    book: {
      id: string;
      title: string;
      authors: string | null;
      format: string;
      coverPath: string | null;
      coverColor: string | null;
      updatedAt: Date | null;
    };
    highlights: {
      title?: string;
      authors?: string;
      description?: string;
      content?: string;
      chapterTitle?: string;
    };
  };
}) {
  const { book, highlights } = result;
  const authors = book.authors ? JSON.parse(book.authors) : [];

  return (
    <Link
      to={`/book/${book.id}`}
      className="bg-surface border border-border rounded-xl p-5 flex gap-4 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
    >
      {/* Cover thumbnail */}
      <div
        className="w-16 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-surface-elevated"
        style={{ backgroundColor: book.coverColor || undefined }}
      >
        {book.coverPath ? (
          <img src={`/covers/${book.id}.thumb.jpg?v=${book.updatedAt?.getTime() || ""}`} alt="" className="w-full h-full object-cover" />
        ) : null}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <h3
          className="font-semibold mb-1 text-foreground"
          dangerouslySetInnerHTML={{
            __html: highlights.title || book.title,
          }}
        />
        {authors.length > 0 && (
          <p className="text-sm text-foreground-muted mb-2">
            {highlights.authors ? (
              <span dangerouslySetInnerHTML={{ __html: highlights.authors }} />
            ) : (
              <AuthorLinks authors={authors} asSpan />
            )}
          </p>
        )}
        {highlights.description && (
          <p
            className="text-sm text-foreground-muted line-clamp-2"
            dangerouslySetInnerHTML={{ __html: highlights.description }}
          />
        )}
        {highlights.content && (
          <div className="mt-2 text-sm">
            {highlights.chapterTitle && (
              <span className="text-foreground-muted/60">In "{highlights.chapterTitle}": </span>
            )}
            <span
              className="text-foreground-muted"
              dangerouslySetInnerHTML={{ __html: highlights.content }}
            />
          </div>
        )}
        <span className="inline-block mt-3 px-2.5 py-1 text-xs font-medium rounded-full bg-primary-light text-primary uppercase">
          {book.format}
        </span>
      </div>
    </Link>
  );
}
