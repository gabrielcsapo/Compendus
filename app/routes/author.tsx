import { Suspense } from "react";
import { Link } from "react-flight-router/client";
import { getBooksByAuthor } from "../actions/books";
import { BookGrid } from "../components/BookGrid";

export default function AuthorPage({ params }: { params?: Record<string, string> }) {
  const name = decodeURIComponent(params?.name as string);

  return (
    <main className="container my-8 px-8 mx-auto">
      <div className="mb-6">
        <Link to="/library" className="text-primary hover:underline">
          &larr; Back to Library
        </Link>
      </div>

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">{name}</h1>
      </div>

      <Suspense fallback={<BookGridSkeleton />}>
        <AuthorBooks name={name} />
      </Suspense>
    </main>
  );
}

async function AuthorBooks({ name }: { name: string }) {
  const books = await getBooksByAuthor(name);
  return (
    <>
      <p className="text-foreground-muted -mt-6 mb-6">
        {books.length} {books.length === 1 ? "book" : "books"}
      </p>
      <BookGrid books={books} emptyMessage={`No books found by ${name}`} />
    </>
  );
}

function BookGridSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-4 bg-surface-elevated rounded w-24 -mt-6 mb-6" />
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="aspect-[2/3] bg-surface-elevated rounded-lg" />
            <div className="h-3 bg-surface-elevated rounded w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}
