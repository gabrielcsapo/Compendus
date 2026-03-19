import { getBook } from "../actions/books";
import { ReaderShell } from "../components/reader/ReaderShell";

export default async function BookReader({ params }: { params?: Record<string, string> }) {
  const id = params?.id as string;
  const book = await getBook(id);
  if (!book) {
    throw new Response("Book not found", { status: 404 });
  }

  return (
    <ReaderShell
      bookId={book.id}
      initialPosition={book.readingProgress || 0}
      returnUrl={`/book/${book.id}`}
      bookFormat={book.format}
    />
  );
}
