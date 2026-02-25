import { getBook } from "../actions/books";
import { EpubEditorShell } from "../components/editor/EpubEditorShell";

export default async function BookEditor({ params }: { params?: Record<string, string> }) {
  const id = params?.id as string;
  const book = await getBook(id);
  if (!book) {
    throw new Response("Book not found", { status: 404 });
  }
  if (book.format !== "epub" && !book.convertedEpubPath) {
    throw new Response("Only EPUB books can be edited", { status: 400 });
  }

  return (
    <EpubEditorShell
      bookId={book.id}
      bookTitle={book.title || "Untitled"}
      returnUrl={`/book/${book.id}`}
    />
  );
}
