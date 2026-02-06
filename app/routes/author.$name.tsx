import { Link, type LoaderFunctionArgs } from "react-router";
import { getBooksByAuthor } from "../actions/books";
import { BookGrid } from "../components/BookGrid";

type LoaderData = Awaited<ReturnType<typeof loader>>;

export async function loader({ params }: LoaderFunctionArgs) {
  const name = decodeURIComponent(params.name as string);
  const books = await getBooksByAuthor(name);

  return { authorName: name, books };
}

export default function AuthorPage({ loaderData }: { loaderData: LoaderData }) {
  const { authorName, books } = loaderData;

  return (
    <main className="container my-8 px-8 mx-auto">
      <div className="mb-6">
        <Link to="/" className="text-primary hover:underline">
          &larr; Back to Library
        </Link>
      </div>

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">{authorName}</h1>
        <p className="text-foreground-muted mt-1">
          {books.length} {books.length === 1 ? "book" : "books"}
        </p>
      </div>

      <BookGrid books={books} emptyMessage={`No books found by ${authorName}`} />
    </main>
  );
}
