import { getCoverUrl } from "../lib/cover";
import type { CoverSize } from "../lib/cover";

interface BookCoverProps {
  /** Must have at least { id, title, coverPath }. coverColor and updatedAt are optional. */
  book: {
    id: string;
    title: string;
    coverPath: string | null;
    coverColor?: string | null;
    updatedAt?: Date | null;
  };
  /** "thumb" (200×300, default) or "full" (600×900) */
  size?: CoverSize;
  /** Alt text for the img. Defaults to book.title. Pass "" for decorative images. */
  alt?: string;
  /** Extra className applied to the <img> element (e.g. hover effects, lazy loading) */
  imgClassName?: string;
  /** Override the default gradient+title fallback. Pass null for no fallback content. */
  fallback?: React.ReactNode;
}

/**
 * Renders a book cover image with fallback.
 * Fills its container — parent controls width, height, aspect-ratio, border-radius, and overflow.
 */
export function BookCover({
  book,
  size = "thumb",
  alt,
  imgClassName,
  fallback,
}: BookCoverProps) {
  const url = getCoverUrl(book, size);

  if (url) {
    return (
      <img
        src={url}
        alt={alt ?? book.title}
        className={`w-full h-full object-cover${imgClassName ? ` ${imgClassName}` : ""}`}
      />
    );
  }

  if (fallback !== undefined) return <>{fallback}</>;

  return (
    <div className="w-full h-full flex items-center justify-center p-4 bg-gradient-to-br from-primary-light to-accent-light">
      <span className="text-center text-foreground-muted text-sm font-medium line-clamp-4">
        {book.title}
      </span>
    </div>
  );
}
