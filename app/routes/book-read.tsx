import { getRequest } from "react-flight-router/server";
import { getBook } from "../actions/books";
import { ReaderShell } from "../components/reader/ReaderShell";

export default async function BookReader({ params }: { params?: Record<string, string> }) {
  const id = params?.id as string;
  const book = await getBook(id);
  if (!book) {
    throw new Response("Book not found", { status: 404 });
  }

  // Living Library passage links deep-link into the reader. The preferred form is
  // a chapter-anchored locator (`?spine=<i>&p=<0-1>`) which survives the char-space
  // mismatch between the knowledge pipeline and the reader; `?position=<0-1>` is the
  // legacy whole-book fraction. With neither, resume from saved reading progress.
  const sp = new URL(getRequest()!.url).searchParams;

  const spineIndex = sp.get("spine") != null ? Number(sp.get("spine")) : NaN;
  const chapterProgress = sp.get("p") != null ? Number(sp.get("p")) : NaN;
  const initialLocator =
    Number.isInteger(spineIndex) &&
    spineIndex >= 0 &&
    Number.isFinite(chapterProgress) &&
    chapterProgress >= 0 &&
    chapterProgress <= 1
      ? { spineIndex, chapterProgress }
      : undefined;

  const deepLink = sp.get("position") != null ? Number(sp.get("position")) : NaN;
  const initialPosition = initialLocator
    ? 0 // locator drives navigation; don't also jump to stale saved progress
    : Number.isFinite(deepLink) && deepLink >= 0 && deepLink <= 1
      ? deepLink
      : book.readingProgress || 0;

  return (
    <ReaderShell
      bookId={book.id}
      initialPosition={initialPosition}
      initialLocator={initialLocator}
      returnUrl={`/book/${book.id}`}
      bookFormat={book.format}
    />
  );
}
