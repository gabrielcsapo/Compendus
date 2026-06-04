interface BookGridSkeletonProps {
  /** Number of placeholder cover tiles. */
  count?: number;
  /** Show the placeholder "N books" count line above the grid. */
  showCountLine?: boolean;
  /** Margin utilities for the count line (e.g. to tuck it under a header). */
  countLineClassName?: string;
}

/**
 * Loading placeholder for a BookGrid. Shared Suspense fallback for routes that
 * stream a grid of books (author, tags, collection detail).
 */
export function BookGridSkeleton({
  count = 6,
  showCountLine = true,
  countLineClassName = "mb-4",
}: BookGridSkeletonProps) {
  return (
    <div className="animate-pulse">
      {showCountLine && (
        <div className={`h-4 bg-surface-elevated rounded w-24 ${countLineClassName}`} />
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="aspect-[2/3] bg-surface-elevated rounded-lg" />
            <div className="h-3 bg-surface-elevated rounded w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}
