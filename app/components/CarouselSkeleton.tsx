interface CarouselSkeletonProps {
  /** Width of the placeholder title bar, e.g. "w-40". */
  titleWidth?: string;
  /** Number of placeholder cover tiles to render. */
  count?: number;
}

/**
 * Loading placeholder for a single BookCarousel row. Used as the Suspense
 * fallback while an explore section streams in.
 */
export function CarouselSkeleton({ titleWidth = "w-40", count = 8 }: CarouselSkeletonProps) {
  return (
    <section className="animate-pulse">
      <div className={`h-6 ${titleWidth} bg-surface-elevated rounded mb-3`} />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex-none w-28">
            <div className="aspect-[2/3] bg-surface-elevated rounded-lg" />
            <div className="h-3 bg-surface-elevated rounded w-20 mt-1.5" />
          </div>
        ))}
      </div>
    </section>
  );
}
