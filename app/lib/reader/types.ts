import type { BookFormat, AudioChapter } from "../types";

// Viewport configuration from the client
export interface ViewportConfig {
  width: number;
  height: number;
  fontSize?: number;
  lineHeight?: number;
}

// Normalized chapter structure used across all text-based formats
export interface NormalizedChapter {
  id: string;
  title: string;
  html: string;
  text: string;
  characterStart: number;
  characterEnd: number;
}

// Base normalized content structure
interface BaseNormalizedContent {
  bookId: string;
  format: BookFormat;
}

// Text-based content (EPUB, MOBI)
export interface TextContent extends BaseNormalizedContent {
  type: "text";
  chapters: NormalizedChapter[];
  totalCharacters: number;
  toc: TocEntry[];
  // Error message if parsing failed
  error?: string;
}

// PDF content (native pages)
export interface PdfContent extends BaseNormalizedContent {
  type: "pdf";
  pageCount: number;
  toc: TocEntry[];
  // PDF pages are served on-demand via existing endpoint
}

// Comic content (CBR, CBZ)
export interface ComicContent extends BaseNormalizedContent {
  type: "comic";
  pageCount: number;
  pages: ComicPage[];
}

export interface ComicPage {
  index: number;
  name: string;
  mimeType: string;
}

// Audio content (M4B, M4A, MP3)
export interface AudioContent extends BaseNormalizedContent {
  type: "audio";
  duration: number; // Total duration in seconds
  chapters: AudioChapter[];
}

// Union type for all normalized content
export type NormalizedContent = TextContent | PdfContent | ComicContent | AudioContent;

// Table of contents entry with normalized position
export interface TocEntry {
  title: string;
  position: number; // Normalized 0-1
  pageNum?: number; // Calculated for current viewport
  level?: number; // Nesting level (0 = top level)
  children?: TocEntry[];
}

// Page content returned to client
export interface PageContent {
  type: "text" | "image" | "audio";

  // For text-based formats (EPUB, MOBI)
  html?: string;

  // For image-based formats (PDF pages, Comics)
  imageUrl?: string;

  // For audio
  audioUrl?: string;
  startTime?: number;
  endTime?: number;
  chapter?: AudioChapter;

  // Metadata
  chapterTitle?: string;
  position: number; // Start position of this page (0-1)
  endPosition: number; // End position of this page (0-1)
}

// API response types
export interface ReaderInfoResponse {
  id: string;
  title: string;
  format: BookFormat;
  totalPages: number;
  toc: TocEntry[];
  // Audio-specific
  duration?: number;
  chapters?: AudioChapter[];
  // Cover
  coverPath?: string;
  // Error message (when book loads but content parsing failed)
  error?: string;
}

export interface ReaderPageResponse {
  pageNum: number;
  totalPages: number;
  position: number;
  content: PageContent;
  nextPage: number | null;
  prevPage: number | null;
}

export interface ReaderPositionResponse {
  pageNum: number;
  content: PageContent;
  position: number;
}

export interface SearchResult {
  text: string;
  context: string;
  position: number;
  pageNum: number;
  chapterTitle?: string;
}

export interface ReaderSearchResponse {
  query: string;
  results: SearchResult[];
  totalResults: number;
}

// Bookmark with normalized position
export interface ReaderBookmark {
  id: string;
  bookId: string;
  position: number; // Normalized 0-1
  title?: string;
  note?: string;
  color?: string;
  createdAt: Date;
}

// Highlight with normalized positions
export interface ReaderHighlight {
  id: string;
  bookId: string;
  startPosition: number;
  endPosition: number;
  text: string;
  note?: string;
  color: string;
  createdAt: Date;
}

// Reading progress
export interface ReadingProgress {
  bookId: string;
  position: number;
  pageNum?: number;
  updatedAt: Date;
}
