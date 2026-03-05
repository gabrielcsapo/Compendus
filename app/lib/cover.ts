export type CoverSize = "thumb" | "full";

/**
 * Build the URL for a book's cover image.
 * Returns null when the book has no cover.
 *
 * @param size - "thumb" (200×300, default) or "full" (600×900)
 */
/** Simple string hash for stable cache keys */
function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

export function getCoverUrl(
  book: { id: string; coverPath: string | null; updatedAt?: Date | null },
  size: CoverSize = "thumb",
): string | null {
  if (!book.coverPath) return null;
  const suffix = size === "thumb" ? ".thumb.jpg" : ".jpg";
  // Use coverPath hash so URL only changes when the actual cover changes
  return `/covers/${book.id}${suffix}?v=${stableHash(book.coverPath)}`;
}
