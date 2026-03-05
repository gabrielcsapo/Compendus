import { Suspense } from "react";
import { Link } from "react-flight-router/client";
import { buttonStyles, badgeStyles } from "../lib/styles";
import { getBook, getLinkedFormats, getRelatedBooks } from "../actions/books";
import { getTagsForBook } from "../actions/tags";
import { getCollectionsForBook } from "../actions/collections";
import { CoverDropZone } from "../components/CoverDropZone";
import { BookCollectionsManager } from "../components/BookCollectionsManager";
import { EditBookButton } from "../components/EditBookButton";
import { RematchButton } from "../components/RematchButton";
import { AuthorLinks } from "../components/AuthorLink";
import type { BookFormat } from "../lib/types";
import { ConvertToEpubButton, ReconvertEpubButton } from "../components/ConvertToEpubButton";
import { TranscribeButton } from "../components/TranscribeButton";
import { ToggleReadButton } from "../components/ToggleReadButton";
import { BookReview } from "../components/BookReview";

export default async function BookDetail({ params }: { params?: Record<string, string> }) {
  const id = params?.id as string;
  const book = await getBook(id);
  if (!book) {
    throw new Response("Book not found", { status: 404 });
  }

  // Tags needed immediately for EditBookButton in header
  const tags = await getTagsForBook(id);

  // Parse authors with defensive handling for corrupted data
  const rawAuthors = book.authors ? JSON.parse(book.authors) : [];
  const authors = Array.isArray(rawAuthors)
    ? rawAuthors.filter((a): a is string => typeof a === "string")
    : [];
  const progressPercent = Math.round((book.readingProgress || 0) * 100);

  // Parse coverColor hex to RGB for gradient
  const heroGradient = (() => {
    const hex = book.coverColor;
    if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return undefined;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `linear-gradient(to bottom, rgba(${r}, ${g}, ${b}, 0.15) 0%, rgba(${r}, ${g}, ${b}, 0.05) 60%, transparent 100%)`;
  })();

  return (
    <main className="max-w-5xl my-8 px-4 sm:px-6 mx-auto">
      {heroGradient && (
        <div
          className="absolute inset-x-0 top-0 h-[420px] -z-10 pointer-events-none"
          style={{ background: heroGradient }}
        />
      )}
      <div className="mb-8">
        <Link
          to="/library"
          className="inline-flex items-center gap-1.5 text-sm text-foreground-muted hover:text-primary transition-colors group"
        >
          <svg
            className="w-4 h-4 transition-transform group-hover:-translate-x-0.5"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Library
        </Link>
      </div>

      <div className="grid md:grid-cols-[280px_1fr] gap-6 md:gap-8 items-start">
        {/* Cover & Actions */}
        <aside className="space-y-4 md:sticky md:top-8 md:self-start max-w-xs mx-auto md:max-w-none md:mx-0">
          {/* Cover */}
          <div>
            <div className="shadow-paper rounded-xl overflow-hidden">
              <CoverDropZone
                bookId={book.id}
                coverPath={book.coverPath}
                coverColor={book.coverColor}
                title={book.title}
                updatedAt={book.updatedAt}
              />
            </div>
            <p className="text-xs text-foreground-muted text-center mt-2">
              Drop image or <kbd className="px-1 py-0.5 bg-surface-elevated rounded text-[10px]">⌘/Ctrl</kbd>+<kbd className="px-1 py-0.5 bg-surface-elevated rounded text-[10px]">V</kbd> to paste
            </p>
          </div>

          {/* Progress - show prominently if reading */}
          {progressPercent > 0 && (
            <div className="p-3 bg-surface-elevated rounded-lg border border-border">
              <div className="flex justify-between text-sm text-foreground-muted mb-2">
                <span>Reading Progress</span>
                <span className="font-medium text-foreground">{progressPercent}%</span>
              </div>
              <div className="h-2 bg-surface rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary to-accent rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* Primary Actions */}
          <div className="space-y-2">
            {["pdf", "mobi", "azw3"].includes(book.format) ? (
              <ConvertToEpubButton bookId={book.id} hasEpub={!!book.convertedEpubPath} progressPercent={progressPercent} />
            ) : (
              <Link
                to={`/book/${book.id}/read`}
                className={`${buttonStyles.base} ${buttonStyles.primary} w-full text-center justify-center gap-2`}
              >
                {["m4b", "m4a", "mp3"].includes(book.format) ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                )}
                {["m4b", "m4a", "mp3"].includes(book.format)
                  ? progressPercent > 0 ? "Continue Listening" : "Start Listening"
                  : progressPercent > 0 ? "Continue Reading" : "Start Reading"}
              </Link>
            )}
            <a
              href={`/books/${book.id}.${book.format}`}
              download={book.fileName}
              className={`${buttonStyles.base} ${buttonStyles.secondary} w-full text-center justify-center gap-2`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download {book.format.toUpperCase()}
            </a>
            <ToggleReadButton book={book} />
          </div>

          {/* Transcribe audiobook */}
          {["m4b", "mp3", "m4a"].includes(book.format) && (
            <TranscribeButton bookId={book.id} hasTranscript={!!book.transcriptPath} />
          )}

          {/* Linked formats — streamed via Suspense */}
          <Suspense>
            <LinkedFormatsSection bookId={id} />
          </Suspense>

        </aside>

        {/* Content */}
        <div className="space-y-6 min-w-0">
          {/* Header — no card background, page-level prominence */}
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-foreground leading-tight break-words">
                {book.title}
              </h1>
              <div className="flex items-center gap-2 shrink-0 pt-1">
                <RematchButton
                  bookId={book.id}
                  bookTitle={book.title}
                  bookAuthors={authors}
                  bookFormat={book.format as BookFormat}
                  hasCover={!!book.coverPath}
                  coverUrl={book.coverPath ? `/covers/${book.id}.jpg?v=${book.updatedAt?.getTime() || ""}` : undefined}
                />
                <EditBookButton
                  book={book}
                  tags={tags}
                  bookFormat={book.format}
                  hasCover={!!book.coverPath}
                  coverUrl={book.coverPath ? `/covers/${book.id}.jpg?v=${book.updatedAt?.getTime() || ""}` : undefined}
                  bookAuthors={authors}
                  hasConvertedEpub={!!book.convertedEpubPath}
                />
                {(book.format === "epub" || book.convertedEpubPath) && (
                  <Link
                    to={`/book/${book.id}/edit`}
                    className={`${buttonStyles.base} ${buttonStyles.ghost} px-2.5`}
                    title="Edit EPUB Content"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                    </svg>
                  </Link>
                )}
              </div>
            </div>

            {book.subtitle && (
              <p className="text-lg sm:text-xl text-foreground-muted font-light break-words">{book.subtitle}</p>
            )}

            {authors.length > 0 && (
              <p className="text-lg text-foreground-muted">
                by <AuthorLinks authors={authors} className="text-primary hover:text-primary-hover font-medium" />
              </p>
            )}

            {book.series && (
              <p className="text-base text-foreground-muted">
                {book.seriesNumber && (
                  <span>Book {book.seriesNumber} in </span>
                )}
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
                <span className={`${badgeStyles.base} ${badgeStyles.success}`}>
                  Completed
                </span>
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
          </div>

          {/* Description */}
          {book.description && (
            <section className="bg-surface border border-border rounded-xl p-6 shadow-paper">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted mb-3">
                Description
              </h2>
              <p className="text-foreground whitespace-pre-line leading-relaxed break-words">
                {book.description}
              </p>
            </section>
          )}

          {/* Rating & Review */}
          <section className="bg-surface border border-border rounded-xl p-6 shadow-paper">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted mb-3">
              Rating & Review
            </h2>
            <BookReview book={book} />
          </section>

          {/* Tags & Collections — streamed via Suspense */}
          <Suspense fallback={<SectionSkeleton title="Organization" />}>
            <OrganizationSection bookId={id} tags={tags} />
          </Suspense>

          {/* Details */}
          <section className="bg-surface border border-border rounded-xl p-6 shadow-paper">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted mb-4">
              Details
            </h2>
            <dl className="divide-y divide-border text-sm">
              {book.pageCount && (
                <div className="flex justify-between gap-4 py-3">
                  <dt className="text-foreground-muted shrink-0">Pages</dt>
                  <dd className="font-medium text-foreground text-right">{book.pageCount}</dd>
                </div>
              )}
              {book.publisher && (
                <div className="flex justify-between gap-4 py-3">
                  <dt className="text-foreground-muted shrink-0">Publisher</dt>
                  <dd className="font-medium text-foreground text-right truncate">{book.publisher}</dd>
                </div>
              )}
              {book.publishedDate && (
                <div className="flex justify-between gap-4 py-3">
                  <dt className="text-foreground-muted shrink-0">Published</dt>
                  <dd className="font-medium text-foreground text-right">{book.publishedDate}</dd>
                </div>
              )}
              {book.isbn && (
                <div className="flex justify-between gap-4 py-3">
                  <dt className="text-foreground-muted shrink-0">ISBN</dt>
                  <dd className="font-medium text-foreground font-mono text-right break-all">{book.isbn}</dd>
                </div>
              )}
              <div className="flex justify-between gap-4 py-3">
                <dt className="text-foreground-muted shrink-0">File Size</dt>
                <dd className="font-medium text-foreground text-right">{formatFileSize(book.fileSize)}</dd>
              </div>
              <div className="flex justify-between gap-4 py-3">
                <dt className="text-foreground-muted shrink-0">Added</dt>
                <dd className="font-medium text-foreground text-right">{book.importedAt?.toLocaleDateString()}</dd>
              </div>
              <div className="flex justify-between gap-4 py-3">
                <dt className="text-foreground-muted shrink-0">Filename</dt>
                <dd className="font-medium text-foreground break-all text-right min-w-0">{book.fileName}</dd>
              </div>
              <div className="flex justify-between gap-4 py-3">
                <dt className="text-foreground-muted shrink-0">Location</dt>
                <dd className="text-foreground break-all font-mono text-xs text-right min-w-0">{book.filePath}</dd>
              </div>
              {book.convertedEpubPath && (
                <div className="flex justify-between items-center gap-4 py-3">
                  <dt className="text-foreground-muted shrink-0">Converted EPUB</dt>
                  <dd className="flex items-center gap-3">
                    <a
                      href={`/books/${book.id}/as-epub`}
                      download={`${book.id}.epub`}
                      className="text-sm text-primary hover:text-primary-hover transition-colors"
                    >
                      Download
                    </a>
                    <ReconvertEpubButton bookId={book.id} />
                  </dd>
                </div>
              )}
            </dl>

          </section>

          {/* Related Books — streamed via Suspense */}
          <Suspense fallback={<SectionSkeleton title="Related Books" />}>
            <RelatedBooksSection book={book} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

// Async server component — streams linked formats after book header renders
async function LinkedFormatsSection({ bookId }: { bookId: string }) {
  const linkedFormats = await getLinkedFormats(bookId);
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
            {linked.format === "m4b" ||
            linked.format === "mp3" ||
            linked.format === "m4a" ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            )}
            {linked.format.toUpperCase()}
          </Link>
        ))}
      </div>
    </div>
  );
}

// Async server component — streams organization section (collections require DB query)
async function OrganizationSection({ bookId, tags }: { bookId: string; tags: Awaited<ReturnType<typeof getTagsForBook>> }) {
  const collections = await getCollectionsForBook(bookId);

  return (
    <section className="bg-surface border border-border rounded-xl p-6 shadow-paper">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted mb-4">
        Organization
      </h2>

      {tags.length > 0 && (
        <div className="mb-5">
          <h3 className="text-xs font-medium text-foreground-muted mb-2">Tags</h3>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <Link
                key={tag.id}
                to={`/tags?tag=${tag.id}`}
                className="inline-block px-3 py-1 text-sm rounded-full bg-secondary-light text-secondary hover:opacity-80 transition-opacity"
                style={
                  tag.color
                    ? {
                        backgroundColor: tag.color + "20",
                        color: tag.color,
                      }
                    : undefined
                }
              >
                {tag.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      <BookCollectionsManager bookId={bookId} currentCollections={collections} />
    </section>
  );
}

// Async server component — streams related books (requires DB query for related books)
async function RelatedBooksSection({ book }: { book: Awaited<ReturnType<typeof getBook>> }) {
  if (!book) return null;
  const relatedBooks = await getRelatedBooks(book);
  if (relatedBooks.length === 0) return null;

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
              return Array.isArray(parsed) ? parsed.filter((a: unknown): a is string => typeof a === "string") : [];
            } catch {
              return [];
            }
          })();
          const coverUrl = related.coverPath
            ? `/covers/${related.id}.jpg?v=${related.updatedAt?.getTime() || ""}`
            : null;

          return (
            <Link
              key={related.id}
              to={`/book/${related.id}`}
              className="flex-shrink-0 w-[100px] group"
            >
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt={related.title}
                  className="w-[100px] aspect-[2/3] object-cover rounded-lg shadow-md group-hover:shadow-lg transition-shadow"
                />
              ) : (
                <div className="w-[100px] aspect-[2/3] rounded-lg shadow-md bg-surface-elevated border border-border flex items-center justify-center">
                  <svg className="w-8 h-8 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
              )}
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
