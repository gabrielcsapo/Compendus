"use server";

import { db, books } from "../lib/db";
import { eq, sql } from "drizzle-orm";
import { processBook } from "../lib/processing";
import { processAndStoreCover } from "../lib/processing/cover";
import { indexBookMetadata } from "../lib/search/indexer";
import { getBook } from "./books";
import type { ProcessingResult } from "../lib/types";

export interface ImportResult extends ProcessingResult {
  book?: {
    id: string;
    title: string;
    format: string;
  };
}

const validTypes = [
  "application/pdf",
  "application/epub+zip",
  "application/x-mobipocket-ebook",
  "application/vnd.comicbook-rar",
  "application/vnd.comicbook+zip",
  "application/x-cbr",
  "application/x-cbz",
  "audio/mp4",
  "audio/x-m4b",
  "audio/mpeg",
  "audio/mp3",
];

const validExtensions = [
  ".pdf",
  ".epub",
  ".mobi",
  ".azw",
  ".azw3",
  ".cbr",
  ".cbz",
  ".m4b",
  ".m4a",
  ".mp3",
];

export async function importBook(formData: FormData): Promise<ImportResult> {
  const file = formData.get("file") as File | null;

  if (!file) {
    return { success: false, error: "no_file" };
  }

  const hasValidType = validTypes.includes(file.type);
  const hasValidExtension = validExtensions.some((ext) => file.name.toLowerCase().endsWith(ext));

  if (!hasValidType && !hasValidExtension) {
    return { success: false, error: "invalid_format" };
  }

  // Extract optional metadata overrides from form data
  const metadata: Record<string, unknown> = {};
  const metadataFields = [
    "title",
    "isbn",
    "isbn13",
    "isbn10",
    "publisher",
    "publishedDate",
    "description",
    "language",
  ];
  for (const field of metadataFields) {
    const value = formData.get(field);
    if (value && typeof value === "string") {
      metadata[field] = value;
    }
  }
  // Handle authors as JSON array
  const authorsStr = formData.get("authors");
  if (authorsStr && typeof authorsStr === "string") {
    try {
      metadata.authors = JSON.parse(authorsStr);
    } catch {
      metadata.authors = [authorsStr];
    }
  }
  // Handle pageCount as number
  const pageCountStr = formData.get("pageCount");
  if (pageCountStr && typeof pageCountStr === "string") {
    metadata.pageCount = parseInt(pageCountStr, 10);
  }

  // Convert File to Buffer
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Process the book with metadata overrides
  const result = await processBook(buffer, file.name, {
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  });

  if (result.success && result.bookId) {
    // Index metadata in FTS
    const book = await getBook(result.bookId);
    if (book) {
      await indexBookMetadata(book.id, book.title, book.subtitle, book.authors || "[]", book.description);

      return {
        ...result,
        book: {
          id: book.id,
          title: book.title,
          format: book.format,
        },
      };
    }
  }

  return result;
}

export async function importMultipleBooks(formData: FormData): Promise<ImportResult[]> {
  const files = formData.getAll("files") as File[];
  const results: ImportResult[] = [];

  for (const file of files) {
    const singleFormData = new FormData();
    singleFormData.set("file", file);
    const result = await importBook(singleFormData);
    results.push(result);
  }

  return results;
}

// ============================================
// COVER UPLOAD
// ============================================

export interface CoverUploadResult {
  success: boolean;
  error?: string;
  coverPath?: string;
  coverColor?: string;
}

export async function uploadCover(bookId: string, formData: FormData): Promise<CoverUploadResult> {
  // Check if book exists
  const book = await db.select().from(books).where(eq(books.id, bookId)).get();
  if (!book) {
    return { success: false, error: "book_not_found" };
  }

  const file = formData.get("cover") as File | null;

  if (!file) {
    return { success: false, error: "no_file" };
  }

  // Validate file type (images only)
  const validImageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!validImageTypes.includes(file.type)) {
    return { success: false, error: "invalid_format" };
  }

  // Convert File to Buffer
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Process and store the cover
  const result = await processAndStoreCover(buffer, bookId);

  if (result.path) {
    // Update book record with new cover
    await db
      .update(books)
      .set({
        coverPath: result.path,
        coverColor: result.dominantColor,
        updatedAt: sql`(unixepoch())`,
      })
      .where(eq(books.id, bookId));

    return {
      success: true,
      coverPath: result.path,
      coverColor: result.dominantColor ?? undefined,
    };
  }

  return { success: false, error: "processing_failed" };
}
