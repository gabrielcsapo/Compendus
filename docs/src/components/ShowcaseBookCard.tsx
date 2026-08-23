import { BookObject } from "@app/components/BookObject";

export interface MockBook {
  title: string;
  author: string;
  format: string;
  bookType: "ebook" | "audiobook" | "comic";
  progress: number;
  coverColor: string;
  coverImage?: string;
  series?: string;
  seriesNumber?: number;
  coverMeta?: string;
}

const embeddedLabelShadow = {
  textShadow: "0 1px 3px rgba(0, 0, 0, 0.95), 0 0 8px rgba(0, 0, 0, 0.72)",
};

export function ShowcaseBookCard({ book }: { book: MockBook }) {
  const progressPercent = Math.round(book.progress * 100);
  const carriesJacketMeta = book.bookType !== "ebook";

  return (
    <article className="group min-w-0">
      <a href="#formats" className="relative block" aria-label={`Preview ${book.title}`}>
        <BookObject type={book.bookType} style={{ backgroundColor: book.coverColor }}>
          {book.coverImage ? (
            <img
              src={book.coverImage}
              alt={book.title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary-light to-accent-light p-4">
              <span className="line-clamp-4 text-center text-sm font-medium text-foreground-muted">
                {book.title}
              </span>
            </div>
          )}

          {carriesJacketMeta && (
            <span
              className="absolute right-3 top-3 z-20 text-[9px] font-extrabold uppercase tracking-[0.15em] text-white"
              style={embeddedLabelShadow}
            >
              {book.bookType === "audiobook"
                ? "Audio"
                : book.seriesNumber
                  ? `Issue ${book.seriesNumber}`
                  : "Comic"}
            </span>
          )}

          {book.coverMeta && (
            <span
              className="absolute bottom-3 right-3 z-20 text-[9px] font-bold tracking-[0.08em] text-white tabular-nums"
              style={embeddedLabelShadow}
            >
              {book.coverMeta}
            </span>
          )}
        </BookObject>
      </a>

      <div className="px-0.5 pt-3">
        <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug text-foreground">
          {book.title}
        </h3>
        <p className="mt-1 line-clamp-1 text-xs text-foreground-muted">{book.author}</p>
        {progressPercent > 0 && progressPercent < 100 && (
          <div className="mt-2">
            <div className="h-1 overflow-hidden rounded-full bg-surface-elevated">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className="mt-1 text-[10px] font-medium text-foreground-muted">
              {progressPercent}% read
            </p>
          </div>
        )}
      </div>
    </article>
  );
}
