import { Link } from "react-flight-router/client";

interface SeriesCoverBook {
  id: string;
  coverUrl: string | null;
}

interface SeriesCardProps {
  name: string;
  bookCount: number;
  coverBooks: SeriesCoverBook[];
  currentType?: string;
}

export function SeriesCard({ name, bookCount, coverBooks, currentType }: SeriesCardProps) {
  const rotations = [-6, 0, 6];
  const offsets = [-8, 0, 8];
  const typeParam = currentType && currentType !== "all" ? `&type=${currentType}` : "";

  return (
    <Link
      to={`/?series=${encodeURIComponent(name)}${typeParam}`}
      className="group relative transition-all duration-200 hover:-translate-y-1"
    >
      {/* Fanned covers */}
      <div className="relative aspect-[2/3] w-full flex items-center justify-center mb-3">
        <div className="relative w-4/5 aspect-[2/3]">
          {coverBooks.length === 0 ? (
            <div className="w-full h-full rounded-lg bg-gradient-to-br from-primary-light to-accent-light flex items-center justify-center shadow-md">
              <svg className="w-10 h-10 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
          ) : coverBooks.length === 1 ? (
            <div className="w-full h-full rounded-lg overflow-hidden shadow-lg group-hover:shadow-xl transition-shadow duration-300">
              {coverBooks[0].coverUrl ? (
                <img src={coverBooks[0].coverUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-primary-light to-accent-light" />
              )}
            </div>
          ) : (
            coverBooks.map((book, i) => {
              const rotation = rotations[i] ?? 0;
              const offset = offsets[i] ?? 0;
              const zIndex = i + 1;
              return (
                <div
                  key={book.id}
                  className="absolute inset-0 rounded-lg overflow-hidden shadow-lg transition-all duration-300 group-hover:shadow-xl"
                  style={{
                    transform: `rotate(${rotation}deg) translateX(${offset}px)`,
                    zIndex,
                  }}
                >
                  {book.coverUrl ? (
                    <img src={book.coverUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-primary-light to-accent-light" />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Series name and count */}
      <div className="text-center px-1">
        <h3 className="font-semibold text-sm text-foreground line-clamp-2">{name}</h3>
        <p className="text-xs text-foreground-muted mt-0.5">
          {bookCount} {bookCount === 1 ? "book" : "books"}
        </p>
      </div>
    </Link>
  );
}
