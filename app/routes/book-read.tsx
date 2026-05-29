import { getRequest } from "react-flight-router/server";
import { getBook } from "../actions/books";
import { ReaderShell } from "../components/reader/ReaderShell";

export default async function BookReader({ params }: { params?: Record<string, string> }) {
  const id = params?.id as string;
  const book = await getBook(id);
  if (!book) {
    throw new Response("Book not found", { status: 404 });
  }

  // A `?position=` query (used by Living Library passage links) jumps straight to
  // that spot; otherwise resume from saved reading progress.
  const raw = new URL(getRequest()!.url).searchParams.get("position");
  const deepLink = raw != null ? Number(raw) : NaN;
  const initialPosition =
    Number.isFinite(deepLink) && deepLink >= 0 && deepLink <= 1
      ? deepLink
      : book.readingProgress || 0;

  return (
    <ReaderShell
      bookId={book.id}
      initialPosition={initialPosition}
      returnUrl={`/book/${book.id}`}
      bookFormat={book.format}
    />
  );
}
