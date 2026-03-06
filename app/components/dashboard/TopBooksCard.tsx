"use client";

function formatTime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

interface TopBooksCardProps {
  books: {
    bookId: string;
    minutes: number;
    sessionCount: number;
    title: string;
    authors: string | null;
    coverUrl: string | null;
  }[];
  onViewAll?: () => void;
}

export function TopBooksCard({ books, onViewAll }: TopBooksCardProps) {
  if (books.length === 0) return null;

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground">Most Read</h2>
        {onViewAll && (
          <button
            onClick={onViewAll}
            className="text-xs text-primary hover:text-primary/80 transition-colors"
          >
            View all &rarr;
          </button>
        )}
      </div>

      <div className="flex gap-4 overflow-x-auto pb-2 pt-2 scrollbar-none">
        {books.map((book, index) => (
          <div key={book.bookId} className="flex-shrink-0 w-20 text-center">
            <div className="relative mb-2">
              <div className="w-16 h-24 mx-auto rounded-md overflow-hidden bg-surface-elevated border border-border">
                {book.coverUrl ? (
                  <img
                    src={book.coverUrl}
                    alt={book.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[8px] text-foreground-muted px-1 leading-tight">
                    {book.title}
                  </div>
                )}
              </div>
              <div className="absolute -top-1.5 -left-0.5 w-5 h-5 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">
                {index + 1}
              </div>
            </div>
            <div className="text-[10px] font-medium text-foreground truncate">{book.title}</div>
            <div className="text-[9px] text-foreground-muted">{formatTime(book.minutes)}</div>
            <div className="text-[9px] text-foreground-muted">
              {book.sessionCount} {book.sessionCount === 1 ? "session" : "sessions"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
