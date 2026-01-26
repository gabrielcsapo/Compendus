"use server";

import { processBook } from "../lib/processing";
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

export async function importBook(formData: FormData): Promise<ImportResult> {
  const file = formData.get("file") as File | null;

  if (!file) {
    return { success: false, error: "no_file" };
  }

  // Validate file type
  const validTypes = [
    "application/pdf",
    "application/epub+zip",
    "application/x-mobipocket-ebook",
    "application/vnd.comicbook-rar",
    "application/vnd.comicbook+zip",
    "application/x-cbr",
    "application/x-cbz",
  ];
  const validExtensions = [".pdf", ".epub", ".mobi", ".azw", ".azw3", ".cbr", ".cbz"];

  const hasValidType = validTypes.includes(file.type);
  const hasValidExtension = validExtensions.some((ext) => file.name.toLowerCase().endsWith(ext));

  if (!hasValidType && !hasValidExtension) {
    return { success: false, error: "invalid_format" };
  }

  // Convert File to Buffer
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Process the book
  const result = await processBook(buffer, file.name);

  if (result.success && result.bookId) {
    // Index metadata in FTS
    const book = await getBook(result.bookId);
    if (book) {
      await indexBookMetadata(book.id, book.title, book.authors || "[]", book.description);

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
