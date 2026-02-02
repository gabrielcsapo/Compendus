import { createHash } from "crypto";
import { basename, extname } from "path";
import { v4 as uuid } from "uuid";
import { lookup } from "mime-types";
import { eq, sql } from "drizzle-orm";

import { db, books } from "../db";
import { storeBookFile, storeCoverImage } from "../storage";
import { extractPdfMetadata, extractPdfContent } from "./pdf";
import { extractEpubMetadata, extractEpubContent } from "./epub";
import { extractMobiMetadata, extractMobiContent } from "./mobi";
import { extractAudioMetadata, extractAudioContent, type AudioMetadata } from "./audio";
import { extractCover } from "./cover";
import { suppressConsole, yieldToEventLoop, scheduleBackground } from "./utils";
import type {
  BookFormat,
  BookMetadata,
  ExtractedContent,
  ProcessingResult,
  ImportOptions,
} from "../types";

// Size threshold for background processing
const BACKGROUND_PROCESSING_THRESHOLD = 5 * 1024 * 1024; // 5MB
const MAX_SIZE_FOR_CONTENT_INDEXING = 20 * 1024 * 1024; // 20MB

export async function processBook(
  buffer: Buffer,
  fileName: string,
  options: ImportOptions = {},
): Promise<ProcessingResult> {
  const startTime = Date.now();

  // Step 1: Compute hash for deduplication (fast)
  const fileHash = createHash("sha256").update(buffer).digest("hex");

  // Step 2: Check for duplicates
  const existing = await db.select().from(books).where(eq(books.fileHash, fileHash)).get();

  if (existing && !options.overwriteExisting) {
    return {
      success: false,
      error: "duplicate",
      existingBookId: existing.id,
    };
  }

  // Step 3: Detect format (fast)
  const format = detectFormat(fileName, buffer);
  if (!format) {
    return { success: false, error: "unsupported_format" };
  }

  // Step 4: Generate book ID and store file immediately
  const bookId = uuid();
  const storedPath = storeBookFile(buffer, bookId, format);
  const mimeType = lookup(fileName) || "application/octet-stream";
  const titleFromFilename = basename(fileName, extname(fileName));

  // For large files, save immediately with basic info and process in background
  if (buffer.length > BACKGROUND_PROCESSING_THRESHOLD) {
    // Insert basic entry immediately with any provided metadata overrides
    // Use try-catch to handle race condition where another concurrent upload
    // of the same file inserted between our duplicate check and this insert
    const meta = options.metadata;
    try {
      await db.insert(books).values({
        id: bookId,
        filePath: storedPath,
        fileName: fileName,
        fileSize: buffer.length,
        fileHash,
        mimeType,
        title: meta?.title || titleFromFilename,
        authors: meta?.authors ? JSON.stringify(meta.authors) : "[]",
        isbn: meta?.isbn,
        isbn13: meta?.isbn13,
        isbn10: meta?.isbn10,
        publisher: meta?.publisher,
        publishedDate: meta?.publishedDate,
        description: meta?.description,
        language: meta?.language,
        pageCount: meta?.pageCount,
      });
    } catch (error: unknown) {
      // Handle UNIQUE constraint violation (race condition with duplicate upload)
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "SQLITE_CONSTRAINT_UNIQUE"
      ) {
        // Another concurrent upload of the same file succeeded first
        const existing = await db.select().from(books).where(eq(books.fileHash, fileHash)).get();
        return {
          success: false,
          error: "duplicate",
          existingBookId: existing?.id,
        };
      }
      throw error;
    }

    // Queue heavy processing in background
    queueBackgroundProcessing(bookId, buffer, format, options);

    return {
      success: true,
      bookId,
      processingTime: Date.now() - startTime,
    };
  }

  // For smaller files, do full processing synchronously (original behavior)
  let metadata: BookMetadata | AudioMetadata;
  try {
    metadata = await suppressConsole(() => extractMetadata(buffer, format));
  } catch {
    metadata = {
      title: titleFromFilename,
      authors: [],
    };
  }

  // Extract audio-specific fields if present
  const audioMetadata = metadata as AudioMetadata;

  const coverResult = await suppressConsole(() => extractCover(buffer, format));
  const coverPath = coverResult ? storeCoverImage(coverResult.buffer, bookId) : null;

  // Merge extracted metadata with overrides (overrides take precedence)
  const meta = options.metadata;

  // Use try-catch to handle race condition where another concurrent upload
  // of the same file inserted between our duplicate check and this insert
  try {
    await db.insert(books).values({
      id: bookId,
      filePath: storedPath,
      fileName: fileName,
      fileSize: buffer.length,
      fileHash,
      mimeType,
      title: meta?.title || metadata.title || titleFromFilename,
      subtitle: metadata.subtitle,
      authors: meta?.authors
        ? JSON.stringify(meta.authors)
        : JSON.stringify(metadata.authors || []),
      publisher: meta?.publisher || metadata.publisher,
      publishedDate: meta?.publishedDate || metadata.publishedDate,
      description: meta?.description || metadata.description,
      isbn: meta?.isbn || metadata.isbn,
      isbn13: meta?.isbn13 || metadata.isbn13,
      isbn10: meta?.isbn10,
      language: meta?.language || metadata.language,
      pageCount: meta?.pageCount || metadata.pageCount,
      coverPath,
      coverColor: coverResult?.dominantColor,
      // Audio-specific fields
      duration: audioMetadata.duration,
      narrator: audioMetadata.narrator,
      chapters: audioMetadata.chapters ? JSON.stringify(audioMetadata.chapters) : null,
    });
  } catch (error: unknown) {
    // Handle UNIQUE constraint violation (race condition with duplicate upload)
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "SQLITE_CONSTRAINT_UNIQUE"
    ) {
      const existing = await db.select().from(books).where(eq(books.fileHash, fileHash)).get();
      return {
        success: false,
        error: "duplicate",
        existingBookId: existing?.id,
      };
    }
    throw error;
  }

  // Queue content indexing for small files
  if (!options.skipContentIndexing) {
    queueContentIndexing(bookId, buffer, format);
  }

  return {
    success: true,
    bookId,
    processingTime: Date.now() - startTime,
  };
}

function detectFormat(fileName: string, buffer: Buffer): BookFormat | null {
  const ext = extname(fileName).toLowerCase();

  // Check by extension first
  if (ext === ".pdf") return "pdf";
  if (ext === ".epub") return "epub";
  if (ext === ".mobi") return "mobi";
  if (ext === ".azw3") return "azw3";
  if (ext === ".cbr") return "cbr";
  if (ext === ".cbz") return "cbz";
  if (ext === ".m4b") return "m4b";
  if (ext === ".m4a") return "m4a";
  if (ext === ".mp3") return "mp3";

  // Check by magic bytes
  const header = buffer.subarray(0, 8);

  // PDF: %PDF
  if (header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46) {
    return "pdf";
  }

  // EPUB: PK (ZIP file) with application/epub mimetype
  if (header[0] === 0x50 && header[1] === 0x4b) {
    // Could be EPUB, CBZ, or other ZIP - check for mimetype
    const mimetypeCheck = buffer.subarray(30, 58).toString();
    if (mimetypeCheck.includes("application/epub")) {
      return "epub";
    }
    // If it's a ZIP but not EPUB, could be CBZ (but we rely on extension for that)
  }

  // CBR: RAR archive (Rar!)
  if (header[0] === 0x52 && header[1] === 0x61 && header[2] === 0x72 && header[3] === 0x21) {
    return "cbr";
  }

  // MOBI: check for BOOKMOBI or PDB header
  const mobiCheck = buffer.subarray(60, 68).toString();
  if (mobiCheck === "BOOKMOBI") {
    return "mobi";
  }

  // MP3: starts with ID3 tag or sync bytes (0xFF 0xFB/0xFA/0xF3/0xF2)
  if (
    (header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) || // ID3
    (header[0] === 0xff && (header[1] & 0xe0) === 0xe0) // Sync bytes
  ) {
    return "mp3";
  }

  // M4B/M4A: MP4 container with 'ftyp' atom
  if (header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70) {
    // Check brand type to distinguish M4B from M4A
    const brand = buffer.subarray(8, 12).toString();
    if (brand === "M4B " || brand === "isom") {
      return "m4b";
    }
    return "m4a";
  }

  return null;
}

async function extractMetadata(buffer: Buffer, format: BookFormat): Promise<BookMetadata> {
  switch (format) {
    case "pdf":
      return extractPdfMetadata(buffer);
    case "epub":
      return extractEpubMetadata(buffer);
    case "mobi":
    case "azw3":
      return extractMobiMetadata(buffer);
    case "cbr":
    case "cbz":
      // Comic book archives don't have embedded metadata
      // Title will be derived from filename
      return { title: null, authors: [] };
    case "m4b":
    case "m4a":
    case "mp3":
      return extractAudioMetadata(buffer);
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

export async function extractContent(
  buffer: Buffer,
  format: BookFormat,
): Promise<ExtractedContent> {
  switch (format) {
    case "pdf":
      return extractPdfContent(buffer);
    case "epub":
      return extractEpubContent(buffer);
    case "mobi":
    case "azw3":
      return extractMobiContent(buffer);
    case "cbr":
    case "cbz":
      // Comic book archives are image-based, no text content to extract
      return { fullText: "", chapters: [], toc: [] };
    case "m4b":
    case "m4a":
    case "mp3":
      // Audio files don't have text content to extract
      return extractAudioContent();
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

// Background processing for large files - extracts metadata, cover, and indexes content
function queueBackgroundProcessing(
  bookId: string,
  buffer: Buffer,
  format: BookFormat,
  options: ImportOptions,
) {
  scheduleBackground(async () => {
    // Extract metadata with console suppression (EPUB parser is verbose)
    let metadata: BookMetadata | AudioMetadata;
    try {
      metadata = await suppressConsole(() => extractMetadata(buffer, format));
    } catch {
      metadata = { title: null, authors: [] };
    }
    const audioMeta = metadata as AudioMetadata;

    // Yield to event loop between heavy operations
    await yieldToEventLoop();

    // Extract cover
    const coverResult = await suppressConsole(() => extractCover(buffer, format));
    const coverPath = coverResult ? storeCoverImage(coverResult.buffer, bookId) : null;

    // Yield again before database operations
    await yieldToEventLoop();

    // Update database with extracted metadata
    const updateData: Record<string, unknown> = {
      updatedAt: sql`(unixepoch())`,
    };

    if (metadata.title) updateData.title = metadata.title;
    if (metadata.subtitle) updateData.subtitle = metadata.subtitle;
    if (metadata.authors && metadata.authors.length > 0) {
      updateData.authors = JSON.stringify(metadata.authors);
    }
    if (metadata.publisher) updateData.publisher = metadata.publisher;
    if (metadata.publishedDate) updateData.publishedDate = metadata.publishedDate;
    if (metadata.description) updateData.description = metadata.description;
    if (metadata.isbn) updateData.isbn = metadata.isbn;
    if (metadata.isbn13) updateData.isbn13 = metadata.isbn13;
    if (metadata.language) updateData.language = metadata.language;
    if (metadata.pageCount) updateData.pageCount = metadata.pageCount;
    if (coverPath) {
      updateData.coverPath = coverPath;
      if (coverResult?.dominantColor) {
        updateData.coverColor = coverResult.dominantColor;
      }
    }

    // Audio-specific fields
    if (audioMeta.duration) updateData.duration = audioMeta.duration;
    if (audioMeta.narrator) updateData.narrator = audioMeta.narrator;
    if (audioMeta.chapters && audioMeta.chapters.length > 0) {
      updateData.chapters = JSON.stringify(audioMeta.chapters);
    }

    await db.update(books).set(updateData).where(eq(books.id, bookId));

    // Yield before search indexing
    await yieldToEventLoop();

    // Index metadata for search
    const { indexBookMetadata } = await import("../search/indexer");
    const book = await db.select().from(books).where(eq(books.id, bookId)).get();
    if (book) {
      await indexBookMetadata(book.id, book.title, book.subtitle, book.authors || "[]", book.description);
    }

    // Content indexing for files under the size limit
    if (!options.skipContentIndexing && buffer.length <= MAX_SIZE_FOR_CONTENT_INDEXING) {
      await yieldToEventLoop();
      const { indexContent } = await import("../search/indexer");
      const content = await suppressConsole(() => extractContent(buffer, format));
      await indexContent(bookId, content);
    }
  });
}

// Background content indexing for small files
function queueContentIndexing(bookId: string, buffer: Buffer, format: BookFormat) {
  scheduleBackground(async () => {
    const { indexContent } = await import("../search/indexer");
    const content = await suppressConsole(() => extractContent(buffer, format));
    await indexContent(bookId, content);
  });
}

export { detectFormat, extractMetadata };
