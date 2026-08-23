import { Suspense } from "react";
import { Link } from "react-flight-router/client";
import { buttonStyles, badgeStyles } from "../lib/styles";
import { getCoverUrl } from "../lib/cover";
import { getBook, getLinkedFormats, getRelatedBooks } from "../actions/books";
import { getDeviceReadingProgress } from "../actions/reader";
import { OtherDevices } from "../components/OtherDevices";
import { getTagsForBook } from "../actions/tags";
import { getCollectionsForBook } from "../actions/collections";
import { getSeriesDetails } from "../actions/series";
import { SeriesSection } from "../components/SeriesSection";
import { CoverDropZone } from "../components/CoverDropZone";
import { BookCover } from "../components/BookCover";
import { BookObject } from "../components/BookObject";
import { BookCollectionsManager } from "../components/BookCollectionsManager";
import { BookActionsMenu } from "../components/BookActionsMenu";
import { AuthorLinks } from "../components/AuthorLink";
import { ConvertToEpubButton } from "../components/ConvertToEpubButton";
import { TranscribeButton } from "../components/TranscribeButton";
import { ToggleReadButton } from "../components/ToggleReadButton";
import { BookRating } from "../components/BookRating";
import { BookInfoButton } from "../components/BookInfoButton";
import { CollapsibleDescription } from "../components/CollapsibleDescription";
import { getCurrentProfile } from "../actions/profiles";
import { ccdStatusOf, getBookType, isReflowableFormat } from "../lib/book-types";

export default async function BookDetail({ params }: { params?: Record<string, string> }) {
  const id = params?.id as string;
  const [book, tags, currentProfile, deviceProgress] = await Promise.all([
    getBook(id),
    getTagsForBook(id),
    getCurrentProfile(),
    getDeviceReadingProgress(id),
  ]);
  if (!book) {
    throw new Response("Book not found", { status: 404 });
  }
  const isAdmin = currentProfile?.isAdmin ?? false;

  // Parse authors with defensive handling for corrupted data
  const rawAuthors = book.authors ? JSON.parse(book.authors) : [];
  const authors = Array.isArray(rawAuthors)
    ? rawAuthors.filter((a): a is string => typeof a === "string")
    : [];
  const progressPercent = Math.round((book.readingProgress || 0) * 100);
  const coverUrl = getCoverUrl(book, "full") ?? undefined;

  return (
    <main className="pb-16">
      <section>
        <div className="mx-auto max-w-7xl px-5 pt-8 sm:px-8 lg:px-11">
          <Link
            to="/library"
            className="inline-flex items-center gap-1.5 text-sm text-foreground-muted hover:text-primary transition-colors group"
          >
            <svg
              className="w-4 h-4 transition-transform group-hover:-translate-x-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back to Library
          </Link>

          <div className="mt-8 grid items-start gap-8 sm:grid-cols-[12rem_minmax(0,1fr)] lg:grid-cols-[minmax(13rem,17rem)_minmax(0,1fr)_15rem] lg:gap-12">
            {/* Cover */}
            <div className="mx-auto w-40 shrink-0 sm:mx-0 sm:w-full">
              <BookObject type={getBookType(book.format, book.bookTypeOverride)}>
                <CoverDropZone
                  bookId={book.id}
                  coverPath={book.coverPath}
                  coverColor={book.coverColor}
                  title={book.title}
                  updatedAt={book.updatedAt}
                />
              </BookObject>
            </div>

            {/* Title, metadata & actions */}
            <div className="min-w-0 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <h1 className="break-words text-4xl font-extrabold leading-[.98] tracking-[-.055em] text-foreground md:text-5xl lg:text-6xl">
                  {book.title}
                </h1>
                <div className="flex items-center gap-2 shrink-0 pt-1">
                  <BookActionsMenu
                    book={book}
                    tags={tags}
                    authors={authors}
                    coverUrl={coverUrl}
                    isAdmin={isAdmin}
                  />
                </div>
              </div>

              {book.subtitle && (
                <p className="text-lg sm:text-xl text-foreground-muted font-light break-words">
                  {book.subtitle}
                </p>
              )}

              {authors.length > 0 && (
                <p className="text-lg text-foreground-muted">
                  by{" "}
                  <AuthorLinks
                    authors={authors}
                    className="text-primary hover:text-primary-hover font-medium"
                  />
                </p>
              )}

              {book.series && (
                <p className="text-base text-foreground-muted">
                  {book.seriesNumber && <span>Book {book.seriesNumber} in </span>}
                  <Link
                    to={`/library?series=${encodeURIComponent(book.series)}`}
                    className="text-primary hover:text-primary-hover font-medium"
                  >
                    {book.series}
                  </Link>
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                {book.isRead && (
                  <span className={`${badgeStyles.base} ${badgeStyles.success}`}>Completed</span>
                )}
                <span className={`${badgeStyles.base} ${badgeStyles.primary} uppercase`}>
                  {book.format}
                </span>
                {book.language && (
                  <span className={`${badgeStyles.base} ${badgeStyles.neutral}`}>
                    {book.language}
                  </span>
                )}
                {book.pageCount && (
                  <span className={`${badgeStyles.base} ${badgeStyles.neutral}`}>
                    {book.pageCount} pages
                  </span>
                )}
              </div>

              {/* Tags & collections */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {tags.map((tag) => (
                  <Link
                    key={tag.id}
                    to={`/tags?tag=${tag.id}`}
                    className="inline-block px-3 py-1 text-sm rounded-full bg-secondary-light text-secondary hover:opacity-80 transition-opacity"
                    style={
                      tag.color
                        ? { backgroundColor: tag.color + "20", color: tag.color }
                        : undefined
                    }
                  >
                    {tag.name}
                  </Link>
                ))}
                <Suspense>
                  <CollectionsInline bookId={id} />
                </Suspense>
              </div>

              {/* Rating — inline stars, opens a modal to edit rating & review */}
              <div className="pt-1">
                <BookRating book={book} />
              </div>

              {/* Reading progress — compact inline bar */}
              {progressPercent > 0 && (
                <div className="max-w-xs pt-1">
                  <div className="flex justify-between text-xs text-foreground-muted mb-1">
                    <span>Reading progress</span>
                    <span className="font-medium text-foreground">{progressPercent}%</span>
                  </div>
                  <div className="h-1.5 bg-surface-elevated rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-primary to-accent rounded-full transition-all duration-300"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Per-device reading positions (other devices) */}
              <OtherDevices devices={deviceProgress} />

              {/* Primary action + quiet secondary actions */}
              <div className="flex flex-wrap items-center gap-2 pt-4">
                <PrimaryAction book={book} progressPercent={progressPercent} className="" />
                <a
                  href={`/books/${book.id}.${book.format}`}
                  download={book.fileName}
                  className={`${buttonStyles.base} ${buttonStyles.ghost} gap-1.5`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                  Download
                </a>
                <ToggleReadButton book={book} className="" variant="ghost" />
                <BookInfoButton book={book} />
              </div>

              {/* Format conversion / transcription — reading-relevant alternatives */}
              {(book.format === "pdf" || ["m4b", "mp3", "m4a"].includes(book.format)) && (
                <div className="flex flex-col gap-2 pt-1 max-w-sm">
                  {/* PDF "Read as text" goes through the CCD reflow — only offer it
                      once the CCD is ready (native PDF reading stays available above). */}
                  {book.format === "pdf" && ccdStatusOf(book) === "ready" && (
                    <Link
                      to={`/book/${book.id}/read?format=epub`}
                      className={`${buttonStyles.base} ${buttonStyles.secondary} text-center justify-center gap-2`}
                    >
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 6h16M4 12h16M4 18h7"
                        />
                      </svg>
                      Read as text
                    </Link>
                  )}
                  {["m4b", "mp3", "m4a"].includes(book.format) && (
                    <TranscribeButton bookId={book.id} hasTranscript={!!book.transcriptPath} />
                  )}
                </div>
              )}

              {/* Linked formats — streamed via Suspense */}
              <Suspense>
                <LinkedFormatsSection bookId={id} book={book} />
              </Suspense>
            </div>

            <aside className="hidden border-l border-border pl-7 lg:block">
              <p className="mb-5 text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
                About this edition
              </p>
              <dl className="space-y-0">
                <div className="border-t border-border py-4">
                  <dt className="text-xs text-foreground-muted">Format</dt>
                  <dd className="mt-1 text-sm font-semibold uppercase text-foreground">
                    {book.format}
                  </dd>
                </div>
                {book.pageCount && (
                  <div className="border-t border-border py-4">
                    <dt className="text-xs text-foreground-muted">Length</dt>
                    <dd className="mt-1 text-sm font-semibold text-foreground">
                      {book.pageCount.toLocaleString()} pages
                    </dd>
                  </div>
                )}
                <div className="border-t border-border py-4">
                  <dt className="text-xs text-foreground-muted">Progress</dt>
                  <dd className="mt-1 text-sm font-semibold text-foreground">
                    {progressPercent > 0 ? `${progressPercent}% read` : "Not started"}
                  </dd>
                </div>
                {book.language && (
                  <div className="border-y border-border py-4">
                    <dt className="text-xs text-foreground-muted">Language</dt>
                    <dd className="mt-1 text-sm font-semibold uppercase text-foreground">
                      {book.language}
                    </dd>
                  </div>
                )}
              </dl>
            </aside>
          </div>
        </div>
      </section>

      {/* ── Content sections ──────────────────────────────────────────── */}
      <div className="mx-auto mt-12 max-w-7xl space-y-6 px-5 sm:px-8 lg:px-11">
        {/* Description */}
        {book.description && (
          <section className="max-w-4xl border-t border-border py-8">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted mb-3">
              Description
            </h2>
            <CollapsibleDescription text={book.description} />
          </section>
        )}

        {/* Series — streamed via Suspense, only shown when book belongs to a series */}
        {book.series && (
          <Suspense fallback={<SectionSkeleton title="In this series" />}>
            <SeriesSectionData book={book} />
          </Suspense>
        )}

        {/* Related Books — streamed via Suspense */}
        <Suspense fallback={<SectionSkeleton title="Related Books" />}>
          <RelatedBooksSection book={book} />
        </Suspense>
      </div>
    </main>
  );
}

// Async server component — streams linked formats after book header renders
async function LinkedFormatsSection({
  bookId,
  book,
}: {
  bookId: string;
  book: Awaited<ReturnType<typeof getBook>>;
}) {
  const linkedFormats = await getLinkedFormats(bookId, book!);
  if (linkedFormats.length === 0) return null;

  return (
    <div className="p-3 bg-surface-elevated rounded-lg border border-border">
      <p className="text-xs text-foreground-muted mb-2">Also available as:</p>
      <div className="flex flex-wrap gap-2">
        {linkedFormats.map((linked) => (
          <Link
            key={linked.id}
            to={`/book/${linked.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full bg-primary-light text-primary hover:bg-primary hover:text-white transition-colors"
          >
            {linked.format === "m4b" || linked.format === "mp3" || linked.format === "m4a" ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15z"
                />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              </svg>
            )}
            {linked.format.toUpperCase()}
          </Link>
        ))}
      </div>
    </div>
  );
}

// Async server component — streams collection chips + "add to collection" control
// inline in the hero (collections require a DB query).
async function CollectionsInline({ bookId }: { bookId: string }) {
  const collections = await getCollectionsForBook(bookId);
  return (
    <BookCollectionsManager bookId={bookId} currentCollections={collections} variant="inline" />
  );
}

// Async server component — streams series section (only rendered when book.series is set)
async function SeriesSectionData({ book }: { book: Awaited<ReturnType<typeof getBook>> }) {
  if (!book?.series) return null;
  const details = await getSeriesDetails(book.series);
  // Only show if there's more than just this book (otherwise no value)
  if (details.ownedBooks.length <= 1 && details.wantedBooks.length === 0) return null;
  return <SeriesSection currentBookId={book.id} details={details} />;
}

// Async server component — streams related books (requires DB query for related books)
async function RelatedBooksSection({ book }: { book: Awaited<ReturnType<typeof getBook>> }) {
  if (!book) return null;
  const relatedBooks = await getRelatedBooks(book);
  // Series books are shown in SeriesSectionData — exclude them here to avoid duplication
  const filtered = book.series
    ? relatedBooks.filter((r) => r.series !== book.series)
    : relatedBooks;
  if (filtered.length === 0) return null;

  return (
    <section className="bg-surface border border-border rounded-xl p-6 shadow-paper">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted mb-4">
        Related Books
      </h2>
      <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1">
        {relatedBooks.map((related) => {
          const relatedAuthors = (() => {
            try {
              const parsed = related.authors ? JSON.parse(related.authors) : [];
              return Array.isArray(parsed)
                ? parsed.filter((a: unknown): a is string => typeof a === "string")
                : [];
            } catch {
              return [];
            }
          })();
          return (
            <Link
              key={related.id}
              to={`/book/${related.id}`}
              className="flex-shrink-0 w-[100px] group"
            >
              <div className="w-[100px] aspect-[2/3] rounded-lg overflow-hidden shadow-md group-hover:shadow-lg transition-shadow">
                <BookCover
                  book={related}
                  fallback={
                    <div className="w-full h-full bg-surface-elevated border border-border flex items-center justify-center">
                      <svg
                        className="w-8 h-8 text-foreground-muted"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                        />
                      </svg>
                    </div>
                  }
                />
              </div>
              <p className="mt-2 text-sm font-medium text-foreground line-clamp-2 leading-tight group-hover:text-primary transition-colors">
                {related.title}
              </p>
              {relatedAuthors.length > 0 && (
                <p className="mt-0.5 text-xs text-foreground-muted line-clamp-1">
                  {relatedAuthors.join(", ")}
                </p>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function SectionSkeleton({ title }: { title: string }) {
  return (
    <section className="bg-surface border border-border rounded-xl p-6 shadow-paper animate-pulse">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted mb-4">
        {title}
      </h2>
      <div className="space-y-3">
        <div className="h-4 bg-surface-elevated rounded w-3/4" />
        <div className="h-4 bg-surface-elevated rounded w-1/2" />
      </div>
    </section>
  );
}

// Disabled affordance shown in place of "Read" when a reflowable book's CCD
// isn't ready: a quiet spinner while it's being prepared, a muted/destructive
// note when the conversion failed.
function CcdGatedAction({
  state,
  className = "w-full",
}: {
  state: "processing" | "failed";
  className?: string;
}) {
  if (state === "processing") {
    return (
      <div
        className={`${buttonStyles.base} ${className} text-center justify-center gap-2 opacity-70 cursor-default pointer-events-none`}
        role="status"
        aria-live="polite"
      >
        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        Preparing for reading…
      </div>
    );
  }
  return (
    <div
      className={`${buttonStyles.base} ${buttonStyles.danger} ${className} text-center justify-center gap-2 opacity-70 cursor-not-allowed pointer-events-none`}
      role="status"
      title="This book couldn't be converted for reading (it may be corrupt, DRM-protected, or unsupported)."
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
      Couldn&apos;t be prepared for reading
    </div>
  );
}

function PrimaryAction({
  book,
  progressPercent,
  className = "w-full",
}: {
  book: Awaited<ReturnType<typeof getBook>>;
  progressPercent: number;
  className?: string;
}) {
  if (!book) return null;

  // Reflowable formats (epub/mobi/azw3) read through CCD — gate on its readiness
  // so users don't open a not-yet-converted or unconvertable book to a blank screen.
  if (isReflowableFormat(book.format)) {
    const ccdStatus = ccdStatusOf(book);
    if (ccdStatus === "processing") {
      return <CcdGatedAction state="processing" className={className} />;
    }
    if (ccdStatus === "failed") {
      return <CcdGatedAction state="failed" className={className} />;
    }
    // ccdStatus === "ready" — fall through to the normal Read link below.
  }

  if (["mobi", "azw3"].includes(book.format)) {
    return (
      <ConvertToEpubButton
        bookId={book.id}
        hasEpub={!!book.convertedEpubPath}
        progressPercent={progressPercent}
      />
    );
  }
  const isAudio = ["m4b", "m4a", "mp3"].includes(book.format);
  return (
    <Link
      to={`/book/${book.id}/read`}
      className={`${buttonStyles.base} ${buttonStyles.primary} ${className} text-center justify-center gap-2`}
    >
      {isAudio ? (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15z"
          />
        </svg>
      ) : (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
          />
        </svg>
      )}
      {isAudio
        ? progressPercent > 0
          ? "Continue Listening"
          : "Start Listening"
        : progressPercent > 0
          ? "Continue Reading"
          : "Start Reading"}
    </Link>
  );
}
