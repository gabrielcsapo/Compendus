export type BookFormat = "pdf" | "epub" | "mobi" | "cbr" | "cbz";

export interface BookMetadata {
  title: string | null;
  subtitle?: string | null;
  authors: string[];
  publisher?: string | null;
  publishedDate?: string | null;
  description?: string | null;
  isbn?: string | null;
  isbn13?: string | null;
  language?: string | null;
  pageCount?: number | null;
}

export interface Chapter {
  index: number;
  title: string;
  content: string;
}

export interface TocItem {
  title: string;
  href: string;
  index: number;
}

export interface ExtractedContent {
  fullText: string;
  chapters: Chapter[];
  toc: TocItem[];
}

export interface CoverResult {
  buffer: Buffer;
  mimeType: string;
  dominantColor?: string;
}

export interface ProcessingResult {
  success: boolean;
  bookId?: string;
  error?: string;
  existingBookId?: string;
  processingTime?: number;
}

export interface ImportOptions {
  skipContentIndexing?: boolean;
  overwriteExisting?: boolean;
}
