import { Link, type LoaderFunctionArgs } from "react-router";
import { searchBooks } from "../actions/search";
import { SearchInput } from "../components/SearchInput";
import { AuthorLinks } from "../components/AuthorLink";
import type { BookType } from "../lib/book-types";

type LoaderData = Awaited<ReturnType<typeof loader>>;

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";

  const typeParam = url.searchParams.get("type") as BookType | null;
  const type = typeParam && ["ebook", "audiobook", "comic"].includes(typeParam) ? typeParam : undefined;

  if (!query) {
    return {
      query,
      results: [] as Awaited<ReturnType<typeof searchBooks>>,
      searchIn: [] as string[],
      type: type ?? ("all" as const),
    };
  }

  const searchIn = url.searchParams.get("in")?.split(",") || ["title", "authors", "description"];

  const results = await searchBooks(query, {
    searchIn: searchIn as ("title" | "authors" | "description" | "content")[],
    limit: 50,
    type,
  });

  return { query, results, searchIn, type: type ?? ("all" as const) };
}

export default function Search({ loaderData }: { loaderData: LoaderData }) {
  const { query, results, searchIn, type } = loaderData;

  return (
    <main className="container my-8 px-6 mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <Link
            to="/"
            className="text-primary hover:text-primary-hover text-sm font-medium transition-colors"
          >
            &larr; Back to Library
          </Link>
          <h1 className="text-2xl font-bold mt-2 text-foreground">Search Results</h1>
          {query && (
            <p className="text-foreground-muted">
              {results.length} result{results.length !== 1 ? "s" : ""} for "{query}"
            </p>
          )}
        </div>
        <SearchInput />
      </div>

      {/* Search filters */}
      {query && (
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
                const isActive = type === option.value;
                return (
                  <TypeFilterLink
                    key={option.value}
                    label={option.label}
                    value={option.value}
                    query={query}
                    searchIn={searchIn}
                    active={isActive}
                  />
                );
              })}
            </div>
          </div>
          <div>
            <span className="text-sm text-foreground-muted mr-4">Search in:</span>
            <div className="inline-flex gap-2 flex-wrap">
              <FilterLink
                label="Title"
                field="title"
                query={query}
                active={searchIn.includes("title")}
                searchIn={searchIn}
                type={type}
              />
              <FilterLink
                label="Authors"
                field="authors"
                query={query}
                active={searchIn.includes("authors")}
                searchIn={searchIn}
                type={type}
              />
              <FilterLink
                label="Description"
                field="description"
                query={query}
                active={searchIn.includes("description")}
                searchIn={searchIn}
                type={type}
              />
              <FilterLink
                label="Full Text"
                field="content"
                query={query}
                active={searchIn.includes("content")}
                searchIn={searchIn}
                type={type}
              />
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {results.length > 0 ? (
        <div className="space-y-4">
          {results.map((result) => (
            <SearchResultCard key={result.book.id} result={result} />
          ))}
        </div>
      ) : query ? (
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
          <p className="text-foreground-muted mb-2">No books found matching "{query}"</p>
          <p className="text-foreground-muted/60 text-sm">
            Try different keywords or enable Full Text search
          </p>
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
          <p className="text-foreground-muted">Enter a search term to find books</p>
        </div>
      )}
    </main>
  );
}

function buildSearchUrl(query: string, searchIn: string[], type?: string) {
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("in", searchIn.join(","));
  if (type && type !== "all") {
    params.set("type", type);
  }
  return `/search?${params.toString()}`;
}

function TypeFilterLink({
  label,
  value,
  query,
  searchIn,
  active,
}: {
  label: string;
  value: string;
  query: string;
  searchIn: string[];
  active: boolean;
}) {
  return (
    <Link
      to={buildSearchUrl(query, searchIn, value)}
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
}: {
  label: string;
  field: string;
  query: string;
  active: boolean;
  searchIn: string[];
  type?: string;
}) {
  const newSearchIn = active ? searchIn.filter((s) => s !== field) : [...searchIn, field];

  // Ensure at least one filter is active
  if (newSearchIn.length === 0) {
    newSearchIn.push("title");
  }

  return (
    <Link
      to={buildSearchUrl(query, newSearchIn, type)}
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
          <img src={`/covers/${book.id}.jpg?v=${book.updatedAt?.getTime() || ""}`} alt="" className="w-full h-full object-cover" />
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
