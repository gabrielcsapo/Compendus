import { Link, type LoaderFunctionArgs } from "react-router";
import { getBook, getLinkedFormats } from "../actions/books";
import { getTagsForBook } from "../actions/tags";
import { getCollectionsForBook } from "../actions/collections";
import { MetadataRefreshButton } from "../components/MetadataRefreshButton";
import { CoverUploadButton } from "../components/CoverUploadButton";
import { BookCollectionsManager } from "../components/BookCollectionsManager";
import { EditBookButton } from "../components/EditBookButton";
import { DeleteBookButton } from "../components/DeleteBookButton";

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
  const authors = book.authors ? JSON.parse(book.authors) : [];
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

      <div className="grid md:grid-cols-[300px_1fr] gap-8">
        {/* Cover */}
        <div>
          <div
            className="aspect-[2/3] w-full overflow-hidden rounded-xl bg-surface-elevated"
            style={{ backgroundColor: book.coverColor || undefined }}
          >
            {book.coverPath ? (
              <img
                src={`/covers/${book.id}.jpg`}
                alt={book.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center p-8 bg-gradient-to-br from-primary-light to-accent-light">
                <span className="text-center text-foreground-muted text-lg font-medium">
                  {book.title}
                </span>
              </div>
            )}
          </div>

          {/* Cover upload */}
          <CoverUploadButton bookId={book.id} hasCover={!!book.coverPath} />

          {/* Read button */}
          <Link
            to={`/book/${book.id}/read`}
            className="btn btn-primary w-full mt-4 text-center justify-center text-foreground"
          >
            {progressPercent > 0 ? "Continue Reading" : "Start Reading"}
          </Link>

          {/* Download button */}
          <a
            href={`/books/${book.id}.${book.format}`}
            download={book.fileName}
            className="btn btn-secondary w-full mt-2 text-center justify-center"
          >
            Download {book.format.toUpperCase()}
          </a>

          {/* Linked formats (same ISBN, different format) */}
          {linkedFormats.length > 0 && (
            <div className="mt-4 p-3 bg-surface-elevated rounded-lg border border-border">
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

          {/* Edit button */}
          <EditBookButton book={book} tags={tags} />

          {/* Delete button */}
          <DeleteBookButton book={book} />

          {/* Progress */}
          {progressPercent > 0 && (
            <div className="mt-4">
              <div className="flex justify-between text-sm text-foreground-muted mb-1">
                <span>Progress</span>
                <span>{progressPercent}%</span>
              </div>
              <div className="h-2 bg-surface-elevated rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary to-accent rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Details */}
        <div className="bg-surface border border-border rounded-xl p-6">
          <h1 className="text-2xl font-bold mb-2 text-foreground">{book.title}</h1>
          {book.subtitle && <p className="text-lg text-foreground-muted mb-4">{book.subtitle}</p>}

          {authors.length > 0 && (
            <p className="text-foreground-muted mb-4">by {authors.join(", ")}</p>
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
            <MetadataRefreshButton bookId={book.id} bookTitle={book.title} bookAuthors={authors} />
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
