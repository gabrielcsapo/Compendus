import { Suspense } from "react";
import { getRequest } from "react-flight-router/server";
import { searchBooks, searchBooksCount, type MissingField } from "../actions/search";
import { getBooks, getBooksCount } from "../actions/books";
import type { BookType } from "../lib/book-types";
import SearchClient from "./search.client";

const RESULTS_PER_PAGE = 20;
const VALID_MISSING_FIELDS: MissingField[] = ["cover", "authors", "tags", "language"];

export default function Search() {
  return (
    <Suspense fallback={<SearchSkeleton />}>
      <SearchData />
    </Suspense>
  );
}

async function SearchData() {
  const request = getRequest()!;
  const url = new URL(request.url);
  const searchParams = url.searchParams;

  const query = searchParams.get("q") || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const typeParam = searchParams.get("type") as BookType | null;
  const type =
    typeParam && ["ebook", "audiobook", "comic"].includes(typeParam) ? typeParam : undefined;
  const missingParam = searchParams.get("missing");
  const missing = missingParam
    ? (missingParam
        .split(",")
        .filter((f) => VALID_MISSING_FIELDS.includes(f as MissingField)) as MissingField[])
    : [];
  const hasQuery = query.trim().length >= 2;
  const hasMissing = missing.length > 0;
  const searchIn = searchParams.get("in")?.split(",") || ["title", "authors", "description"];
  const offset = (page - 1) * RESULTS_PER_PAGE;

  let data;

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

    data = {
      query,
      results,
      searchIn,
      type: type ?? ("all" as const),
      missing,
      currentPage: page,
      totalPages,
      totalCount,
    };
  } else {
    const validSearchIn = searchIn.filter(
      (s): s is "title" | "subtitle" | "authors" | "description" =>
        ["title", "subtitle", "authors", "description"].includes(s),
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

    data = {
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

  return <SearchClient initialData={data} initialSearchParamsKey={searchParams.toString()} />;
}

function SearchSkeleton() {
  return (
    <main className="container my-8 px-6 mx-auto">
      <div className="animate-pulse">
        <div className="h-4 bg-surface-elevated rounded w-24 mb-2" />
        <div className="h-8 bg-surface-elevated rounded w-32 mb-2" />
        <div className="h-4 bg-surface-elevated rounded w-40 mb-8" />
        <div className="h-12 bg-surface-elevated rounded-xl mb-6" />
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-28 bg-surface-elevated rounded-xl" />
          ))}
        </div>
      </div>
    </main>
  );
}
