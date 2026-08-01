import { getRequest } from "react-flight-router/server";
import { getBook } from "../actions/books";
import { ReaderShell } from "../components/reader/ReaderShell";
import { parseAudioPosition } from "../lib/audio-position";
import type { AudiobookTrack } from "../components/audio/AudiobookProvider";
import type { AudioChapter } from "../lib/types";

const AUDIOBOOK_FORMATS = ["m4b", "mp3", "m4a"];

function parseJsonArray<T>(json: string | null | undefined): T[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

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
  const hasDeepLink = Number.isFinite(deepLink) && deepLink >= 0 && deepLink <= 1;
  const initialPosition = initialLocator
    ? 0 // locator drives navigation; don't also jump to stale saved progress
    : hasDeepLink
      ? deepLink
      : book.readingProgress || 0;

  // Audiobooks: hand the global player everything it needs (serializable) plus
  // the exact resume second from the iOS-compatible audio lastPosition shape.
  const isAudio = AUDIOBOOK_FORMATS.includes(book.format);
  let audioTrack: AudiobookTrack | undefined;
  let initialAudioTime = 0;
  let forceAudioSeek = false;
  if (isAudio) {
    const duration = book.duration || 0;
    const audioPos = parseAudioPosition(book.lastPosition);
    if (hasDeepLink) {
      initialAudioTime = deepLink * duration;
      forceAudioSeek = true;
    } else if (audioPos) {
      initialAudioTime = audioPos.timestamp;
    } else {
      initialAudioTime = (book.readingProgress || 0) * duration;
    }
    audioTrack = {
      bookId: book.id,
      title: book.title,
      authors: parseJsonArray<string>(book.authors),
      coverUrl: book.coverPath ? `/covers/${book.id}.jpg` : null,
      audioUrl: `/books/${book.id}.${book.format}`,
      format: book.format,
      duration,
      chapters: parseJsonArray<AudioChapter>(book.chapters),
      hasTranscript: Boolean(book.transcriptPath),
      series: book.series,
      seriesNumber: book.seriesNumber,
    };
  }

  return (
    <ReaderShell
      bookId={book.id}
      initialPosition={initialPosition}
      initialLocator={initialLocator}
      returnUrl={`/book/${book.id}`}
      bookFormat={book.format}
      audioTrack={audioTrack}
      initialAudioTime={initialAudioTime}
      forceAudioSeek={forceAudioSeek}
    />
  );
}
