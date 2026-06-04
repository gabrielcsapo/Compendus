import { Suspense } from "react";
import { Link } from "react-flight-router/client";
import { getBooksByAuthor } from "../actions/books";
import { BookGrid } from "../components/BookGrid";
import { BookGridSkeleton } from "../components/BookGridSkeleton";

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

      <Suspense fallback={<BookGridSkeleton countLineClassName="-mt-6 mb-6" />}>
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
