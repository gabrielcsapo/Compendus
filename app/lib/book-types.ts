import { CCD_VERSION } from "./content-ast/types";

export type BookType = "audiobook" | "ebook" | "comic";
export type ReadingState = "in-progress" | "unread" | "finished";

const AUDIOBOOK_FORMATS = ["m4b", "mp3", "m4a"];
const COMIC_FORMATS = ["cbr", "cbz"];
const EBOOK_FORMATS = ["pdf", "epub", "mobi", "azw3"];

/**
 * CCD (canonical content document) readiness for reading.
 *   ready      — converted at the current CCD version; readable
 *   processing — supported format whose CCD isn't ready yet (backfill in flight)
 *   failed     — conversion errored (corrupt/DRM/unsupported/no content)
 *   null       — format doesn't use CCD (comics/audio render natively)
 */
export type CcdStatus = "ready" | "processing" | "failed" | null;

/** Reflowable formats whose reading goes through CCD. */
const REFLOWABLE_CCD_FORMATS = ["epub", "mobi", "azw3", "lit"];

/**
 * Formats whose READING goes through CCD (keep in sync with CCD_FORMATS in
 * processing/ccd.ts and CCD_READ_FORMATS in lib/api/search.ts).
 */
const CCD_READ_FORMATS = [...REFLOWABLE_CCD_FORMATS, "pdf"];

/** True for reflowable formats (epub/mobi/azw3/lit) that must be CCD-ready to read. */
export function isReflowableFormat(format: string): boolean {
  return REFLOWABLE_CCD_FORMATS.includes(format.toLowerCase());
}

/**
 * Derive a book's CCD reading status from its stored conversion fields.
 * Mirrors `ccdStatusOf` in lib/api/search.ts (kept in sync so web components
 * that consume the raw DB Book row get the same status the API exposes).
 */
export function ccdStatusOf(book: {
  format: string;
  ccdPath?: string | null;
  ccdVersion?: string | null;
  ccdError?: string | null;
}): CcdStatus {
  if (!CCD_READ_FORMATS.includes(book.format.toLowerCase())) return null;
  if (book.ccdPath && book.ccdVersion === CCD_VERSION) return "ready";
  if (book.ccdError) return "failed";
  return "processing";
}

/** Formats that can be read directly without conversion */
const NATIVE_FORMATS = ["pdf", "epub", "cbz", "m4b", "mp3", "m4a"];

/** Formats that need conversion before reading, mapped to their target format */
const CONVERTIBLE_FORMAT_MAP: Record<string, string> = {
  mobi: "epub",
  azw: "epub",
  azw3: "epub",
  cbr: "cbz",
};

export function isNativeFormat(format: string): boolean {
  return NATIVE_FORMATS.includes(format.toLowerCase());
}

export function isConvertibleFormat(format: string): boolean {
  return format.toLowerCase() in CONVERTIBLE_FORMAT_MAP;
}

export function getConversionTarget(format: string): string | null {
  return CONVERTIBLE_FORMAT_MAP[format.toLowerCase()] ?? null;
}

export function getFormatsByType(type: BookType): string[] {
  switch (type) {
    case "audiobook":
      return AUDIOBOOK_FORMATS;
    case "comic":
      return COMIC_FORMATS;
    case "ebook":
      return EBOOK_FORMATS;
  }
}

/**
 * Get the book type for a given format, with optional override
 * @param format - The file format (e.g., 'epub', 'pdf', 'cbz')
 * @param bookTypeOverride - Optional override to treat the book as a different type
 */
export function getBookType(format: string, bookTypeOverride?: string | null): BookType {
  // If an override is set, use it (after validating it's a valid BookType)
  if (bookTypeOverride && isValidBookType(bookTypeOverride)) {
    return bookTypeOverride;
  }
  // Otherwise, derive from format
  if (AUDIOBOOK_FORMATS.includes(format)) return "audiobook";
  if (COMIC_FORMATS.includes(format)) return "comic";
  return "ebook";
}

/**
 * Check if a string is a valid BookType
 */
function isValidBookType(value: string): value is BookType {
  return value === "audiobook" || value === "ebook" || value === "comic";
}
