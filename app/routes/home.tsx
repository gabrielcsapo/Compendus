import { Link } from "react-router";
import { getBooks, getBooksCount, getRecentBooks, getUnmatchedBooksCount, getFormatCounts } from "../actions/books";
import { BookGrid } from "../components/BookGrid";
import { SortDropdown, type SortOption } from "../components/SortDropdown";
import { TypeTabs, type TypeFilter } from "../components/TypeTabs";
import { FormatDropdown } from "../components/FormatDropdown";
import type { BookType } from "../lib/book-types";

const BOOKS_PER_PAGE = 24;

function getSortParams(sort: SortOption): {
  orderBy: "title" | "createdAt";
  order: "asc" | "desc";
} {
  switch (sort) {
    case "title-asc":
      return { orderBy: "title", order: "asc" };
    case "title-desc":
      return { orderBy: "title", order: "desc" };
    case "oldest":
      return { orderBy: "createdAt", order: "asc" };
    case "recent":
    default:
      return { orderBy: "createdAt", order: "desc" };
  }
}

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const sort = (url.searchParams.get("sort") as SortOption) || "recent";
  const typeParam = url.searchParams.get("type") as BookType | null;
  const type: TypeFilter = typeParam && ["audiobook", "ebook", "comic"].includes(typeParam) ? typeParam : "all";
  const formatParam = url.searchParams.get("format");
  const format = formatParam ? formatParam.split(",").filter(Boolean) : undefined;
  const offset = (page - 1) * BOOKS_PER_PAGE;
  const { orderBy, order } = getSortParams(sort);

  const typeFilter = type !== "all" ? type : undefined;

  const [books, totalCount, recentBooks, unmatchedCount, formatCounts] = await Promise.all([
    getBooks({ limit: BOOKS_PER_PAGE, offset, orderBy, order, type: typeFilter, format }),
    getBooksCount(typeFilter, format),
    getRecentBooks(5),
    getUnmatchedBooksCount(),
    getFormatCounts(typeFilter),
  ]);

  const totalPages = Math.ceil(totalCount / BOOKS_PER_PAGE);

  return {
    books,
    totalCount,
    recentBooks,
    unmatchedCount,
    currentPage: page,
    totalPages,
    currentSort: sort,
    currentType: type,
    currentFormats: format ?? [],
    formatCounts,
  };
}

type LoaderData = Awaited<ReturnType<typeof loader>>;

function Pagination({
  currentPage,
  totalPages,
  currentSort,
  currentType,
  currentFormats,
}: {
  currentPage: number;
  totalPages: number;
  currentSort: SortOption;
  currentType: TypeFilter;
  currentFormats: string[];
}) {
  if (totalPages <= 1) return null;

  const pages: (number | "...")[] = [];
  const sortParam = currentSort !== "recent" ? `&sort=${currentSort}` : "";
  const typeParam = currentType !== "all" ? `&type=${currentType}` : "";
  const formatParam = currentFormats.length > 0 ? `&format=${currentFormats.join(",")}` : "";

  // Always show first page
  pages.push(1);

  // Show ellipsis if there's a gap after first page
  if (currentPage > 3) {
    pages.push("...");
  }

  // Show pages around current
  for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
    if (!pages.includes(i)) {
      pages.push(i);
    }
  }

  // Show ellipsis if there's a gap before last page
  if (currentPage < totalPages - 2) {
    pages.push("...");
  }

  // Always show last page
  if (totalPages > 1 && !pages.includes(totalPages)) {
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center justify-center gap-2 mt-8">
      {/* Previous button */}
      {currentPage > 1 ? (
        <Link
          to={`/?page=${currentPage - 1}${sortParam}${typeParam}${formatParam}`}
          className="px-3 py-2 rounded-lg border border-border hover:bg-surface-elevated text-foreground transition-colors"
        >
          &larr; Prev
        </Link>
      ) : (
        <span className="px-3 py-2 rounded-lg border border-border text-foreground-muted opacity-50">
          &larr; Prev
        </span>
      )}

      {/* Page numbers */}
      <div className="flex items-center gap-1">
        {pages.map((page, index) =>
          page === "..." ? (
            <span key={`ellipsis-${index}`} className="px-2 text-foreground-muted">
              ...
            </span>
          ) : (
            <Link
              key={page}
              to={`/?page=${page}${sortParam}${typeParam}${formatParam}`}
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

      {/* Next button */}
      {currentPage < totalPages ? (
        <Link
          to={`/?page=${currentPage + 1}${sortParam}${typeParam}${formatParam}`}
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

export default function Home({ loaderData }: { loaderData: LoaderData }) {
  const { books, totalCount, recentBooks, unmatchedCount, currentPage, totalPages, currentSort, currentType, currentFormats, formatCounts } =
    loaderData;

  return (
    <main className="container my-8 px-6 mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-4 mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Library</h1>
            <p className="text-foreground-muted">
              {totalCount} {totalCount === 1 ? "book" : "books"}
              {totalPages > 1 && ` · Page ${currentPage} of ${totalPages}`}
            </p>
          </div>
          {unmatchedCount > 0 && (
            <Link
              to="/unmatched"
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-warning-light text-warning hover:opacity-80 transition-opacity text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <span className="font-medium">{unmatchedCount}</span>
            </Link>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <TypeTabs currentType={currentType} currentSort={currentSort} />
          {formatCounts.length > 1 && (
            <FormatDropdown
              formatCounts={formatCounts}
              selectedFormats={currentFormats}
              currentType={currentType}
              currentSort={currentSort}
            />
          )}
          <div className="ml-auto">
            <SortDropdown currentSort={currentSort} />
          </div>
        </div>
      </div>

      {/* Recently read - only show on first page */}
      {currentPage === 1 && recentBooks.length > 0 && (
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-4 text-foreground">Continue Reading</h2>
          <BookGrid books={recentBooks} />
        </section>
      )}

      {/* Books grid */}
      <section>
        <BookGrid
          books={books}
          emptyMessage="Your library is empty. Drop some books above to get started!"
        />
        <Pagination currentPage={currentPage} totalPages={totalPages} currentSort={currentSort} currentType={currentType} currentFormats={currentFormats} />
      </section>
    </main>
  );
}
