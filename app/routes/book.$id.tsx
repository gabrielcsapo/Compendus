import { Link, type LoaderFunctionArgs } from "react-router";
import { buttonStyles } from "../lib/styles";
import { getBook, getLinkedFormats } from "../actions/books";
import { getTagsForBook } from "../actions/tags";
import { getCollectionsForBook } from "../actions/collections";
import { MetadataRefreshButton } from "../components/MetadataRefreshButton";
import type { BookFormat } from "../lib/types";
import { CoverUploadButton } from "../components/CoverUploadButton";
import { CoverExtractButton } from "../components/CoverExtractButton";
import { CoverDropZone } from "../components/CoverDropZone";
import { BookCollectionsManager } from "../components/BookCollectionsManager";
import { EditBookButton } from "../components/EditBookButton";
import { DeleteBookButton } from "../components/DeleteBookButton";
import { AuthorLinks } from "../components/AuthorLink";
import { ConvertToEpubButton } from "../components/ConvertToEpubButton";

type LoaderData = Awaited<ReturnType<typeof loader>>;

export async function loader({ params }: LoaderFunctionArgs) {
  const id = params.id as string;
  const book = await getBook(id);
  if (!book) {
    throw new Response("Book not found", { status: 404 });
  }

  const [tags, collections, linkedFormats] = await Promise.all([
    getTagsForBook(id),
    getCollectionsForBook(id),
    getLinkedFormats(id),
  ]);

  return { book, tags, collections, linkedFormats };
}

export default function BookDetail({ loaderData }: { loaderData: LoaderData }) {
  const { book, tags, collections, linkedFormats } = loaderData;
  // Parse authors with defensive handling for corrupted data
  const rawAuthors = book.authors ? JSON.parse(book.authors) : [];
  const authors = Array.isArray(rawAuthors)
    ? rawAuthors.filter((a): a is string => typeof a === "string")
    : [];
  const progressPercent = Math.round((book.readingProgress || 0) * 100);

  return (
    <main className="container my-8 px-6 mx-auto">
      <div className="mb-6">
        <Link
          to="/"
          className="text-primary hover:text-primary-hover transition-colors font-medium"
        >
          &larr; Back to Library
        </Link>
      </div>

      <div className="grid md:grid-cols-[280px_1fr] gap-8">
        {/* Cover & Actions */}
        <div className="space-y-4">
          {/* Cover */}
          <div>
            <CoverDropZone
              bookId={book.id}
              coverPath={book.coverPath}
              coverColor={book.coverColor}
              title={book.title}
              updatedAt={book.updatedAt}
            />
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
            <Link
              to={`/book/${book.id}/read`}
              className={`${buttonStyles.base} ${buttonStyles.primary} w-full text-center justify-center gap-2`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              {progressPercent > 0 ? "Continue Reading" : "Start Reading"}
            </Link>
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
          </div>

          {/* Convert PDF to EPUB */}
          {book.format === "pdf" && (
            <ConvertToEpubButton bookId={book.id} hasEpub={!!book.convertedEpubPath} />
          )}

          {/* Linked formats (same ISBN, different format) */}
          {linkedFormats.length > 0 && (
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
          )}

          {/* Secondary Actions - collapsible group */}
          <details className="group">
            <summary className="flex items-center justify-between cursor-pointer p-3 bg-surface-elevated rounded-lg border border-border hover:bg-surface transition-colors text-sm font-medium text-foreground-muted">
              <span>Manage Book</span>
              <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            <div className="mt-2 space-y-1">
              {/* Cover actions */}
              <CoverExtractButton bookId={book.id} bookFormat={book.format} />
              <CoverUploadButton bookId={book.id} hasCover={!!book.coverPath} />
              {/* Edit & Delete */}
              <EditBookButton book={book} tags={tags} />
              {/* Edit EPUB content */}
              {(book.format === "epub" || book.convertedEpubPath) && (
                <Link
                  to={`/book/${book.id}/edit`}
                  className={`${buttonStyles.base} ${buttonStyles.secondary} w-full flex items-center gap-2`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit EPUB Content
                </Link>
              )}
              <DeleteBookButton book={book} />
            </div>
          </details>
        </div>

        {/* Details */}
        <div className="bg-surface border border-border rounded-xl p-6">
          <h1 className="text-2xl font-bold mb-2 text-foreground">{book.title}</h1>
          {book.subtitle && <p className="text-lg text-foreground-muted mb-4">{book.subtitle}</p>}

          {authors.length > 0 && (
            <p className="text-foreground-muted mb-4">
              by <AuthorLinks authors={authors} className="text-primary hover:text-primary-hover" />
            </p>
          )}

          <div className="flex flex-wrap gap-2 mb-6">
            <span className="inline-block px-3 py-1 text-sm font-medium rounded-full bg-primary-light text-primary uppercase">
              {book.format}
            </span>
            {book.language && (
              <span className="inline-block px-3 py-1 text-sm rounded-full bg-surface-elevated text-foreground-muted">
                {book.language}
              </span>
            )}
            {book.pageCount && (
              <span className="inline-block px-3 py-1 text-sm rounded-full bg-surface-elevated text-foreground-muted">
                {book.pageCount} pages
              </span>
            )}
          </div>

          {book.description && (
            <div className="mb-6">
              <h2 className="font-semibold mb-2 text-foreground">Description</h2>
              <p className="text-foreground-muted whitespace-pre-line leading-relaxed">
                {book.description}
              </p>
            </div>
          )}

          {/* Tags */}
          {tags.length > 0 && (
            <div className="mb-6">
              <h2 className="font-semibold mb-2 text-foreground">Tags</h2>
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

          {/* Collections */}
          <BookCollectionsManager bookId={book.id} currentCollections={collections} />

          {/* Metadata */}
          <div className="border-t border-border pt-4 mt-6">
            <h2 className="font-semibold mb-3 text-foreground">Details</h2>
            <dl className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
              {book.pageCount && (
                <>
                  <dt className="text-foreground-muted">Pages</dt>
                  <dd className="text-foreground">{book.pageCount}</dd>
                </>
              )}
              {book.publisher && (
                <>
                  <dt className="text-foreground-muted">Publisher</dt>
                  <dd className="text-foreground">{book.publisher}</dd>
                </>
              )}
              {book.publishedDate && (
                <>
                  <dt className="text-foreground-muted">Published</dt>
                  <dd className="text-foreground">{book.publishedDate}</dd>
                </>
              )}
              {book.isbn && (
                <>
                  <dt className="text-foreground-muted">ISBN</dt>
                  <dd className="text-foreground">{book.isbn}</dd>
                </>
              )}
              <dt className="text-foreground-muted">File Size</dt>
              <dd className="text-foreground">{formatFileSize(book.fileSize)}</dd>
              <dt className="text-foreground-muted">Added</dt>
              <dd className="text-foreground">{book.importedAt?.toLocaleDateString()}</dd>
              <dt className="text-foreground-muted">Filename</dt>
              <dd className="text-foreground break-all">{book.fileName}</dd>
              <dt className="text-foreground-muted">Location</dt>
              <dd className="text-foreground break-all font-mono text-xs">{book.filePath}</dd>
            </dl>

            {/* Metadata refresh */}
            <MetadataRefreshButton bookId={book.id} bookTitle={book.title} bookAuthors={authors} bookFormat={book.format as BookFormat} />
          </div>
        </div>
      </div>
    </main>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
