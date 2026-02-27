import { createHash } from "crypto";
import { basename, extname } from "path";
import { v4 as uuid } from "uuid";
import { lookup } from "mime-types";
import { eq, sql } from "drizzle-orm";

import { db, books } from "../db";
import {
  storeBookFile,
  storeCoverImage,
  storeCoverThumbnail,
  getBookFilePath,
  getBookFileRelativePath,
} from "../storage";
import { extractPdfMetadata } from "./pdf";
import { extractEpubMetadata } from "./epub";
import { extractMobiMetadata } from "./mobi";
import {
  extractAudioMetadata,
  extractAudioCover,
  mergeAudioFiles,
  sortAudioFilesByTrack,
  type AudioMetadata,
  type AudioFileInput,
} from "./audio";
import { extractCover, processAndStoreCover } from "./cover";
import { convertCbrToCbz } from "./comic";
import {
  suppressConsole,
  yieldToEventLoop,
  scheduleBackground,
  runInWorker,
} from "./utils";
import { createJob, updateJobProgress } from "../queue";
import type {
  BookFormat,
  BookMetadata,
  CoverResult,
  ProcessingResult,
  ImportOptions,
} from "../types";

interface ProcessingResultWithJob extends ProcessingResult {
  jobId?: string;
}

// Size threshold for background processing
const BACKGROUND_PROCESSING_THRESHOLD = 5 * 1024 * 1024; // 5MB

export async function processBook(
  buffer: Buffer,
  fileName: string,
  options: ImportOptions = {},
): Promise<ProcessingResult> {
  const startTime = Date.now();

  // Step 1: Compute hash for deduplication (fast)
  const fileHash = createHash("sha256").update(buffer).digest("hex");

  // Step 2: Check for duplicates
  const existing = await db
    .select()
    .from(books)
    .where(eq(books.fileHash, fileHash))
    .get();

  if (existing && !options.overwriteExisting) {
    return {
      success: false,
      error: "duplicate",
      existingBookId: existing.id,
    };
  }

  // Step 3: Detect format (fast)
  const detectedFormat = detectFormat(fileName, buffer);
  if (!detectedFormat) {
    return { success: false, error: "unsupported_format" };
  }

  // Step 3.5: Convert CBR → CBZ at upload time so iOS can read offline
  let format: BookFormat = detectedFormat;
  let processedBuffer = buffer;
  let processedFileName = fileName;
  if (detectedFormat === "cbr") {
    try {
      console.log(
        `[processBook] Converting CBR → CBZ at upload time: ${fileName}`,
      );
      const result = await runInWorker<Uint8Array>(
        "convertCbrToCbz",
        buffer,
        "cbr",
        async () => convertCbrToCbz(buffer),
      );
      processedBuffer = Buffer.from(result);
      format = "cbz";
      processedFileName = fileName.replace(/\.cbr$/i, ".cbz");
    } catch (error) {
      console.error(
        "[processBook] CBR → CBZ conversion failed, storing as CBR:",
        error,
      );
      // Fall back to storing original CBR
    }
  }

  // Step 4: Generate book ID and store file immediately
  const bookId = uuid();
  const storedPath = storeBookFile(processedBuffer, bookId, format);
  const mimeType = lookup(processedFileName) || "application/octet-stream";
  const titleFromFilename = basename(
    processedFileName,
    extname(processedFileName),
  );

  // For large files, save immediately with basic info and process in background
  if (processedBuffer.length > BACKGROUND_PROCESSING_THRESHOLD) {
    // Insert basic entry immediately with any provided metadata overrides
    // Use try-catch to handle race condition where another concurrent upload
    // of the same file inserted between our duplicate check and this insert
    const meta = options.metadata;
    try {
      await db.insert(books).values({
        id: bookId,
        filePath: storedPath,
        fileName: processedFileName,
        fileSize: processedBuffer.length,
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
        const existing = await db
          .select()
          .from(books)
          .where(eq(books.fileHash, fileHash))
          .get();
        return {
          success: false,
          error: "duplicate",
          existingBookId: existing?.id,
        };
      }
      throw error;
    }

    // Queue heavy processing in background
    queueBackgroundProcessing(bookId, processedBuffer, format, options);

    return {
      success: true,
      bookId,
      processingTime: Date.now() - startTime,
    };
  }

  // For smaller files, do full processing synchronously (original behavior)
  let metadata: BookMetadata | AudioMetadata;
  try {
    metadata = await runInWorker<BookMetadata>(
      "extractMetadata",
      processedBuffer,
      format,
      () => suppressConsole(() => extractMetadata(processedBuffer, format)),
    );
  } catch {
    metadata = {
      title: titleFromFilename,
      authors: [],
    };
  }

  // Extract audio-specific fields if present
  const audioMetadata = metadata as AudioMetadata;

  const coverResultRaw = await runInWorker<CoverResult | null>(
    "extractCover",
    processedBuffer,
    format,
    () => suppressConsole(() => extractCover(processedBuffer, format)),
  );
  // Worker returns Uint8Array for buffer, convert back to Buffer
  const coverResult = coverResultRaw
    ? {
        ...coverResultRaw,
        buffer: Buffer.from(coverResultRaw.buffer),
        thumbnail: Buffer.from(coverResultRaw.thumbnail),
      }
    : null;
  const coverPath = coverResult
    ? storeCoverImage(coverResult.buffer, bookId)
    : null;
  if (coverResult) storeCoverThumbnail(coverResult.thumbnail, bookId);

  // Merge extracted metadata with overrides (overrides take precedence)
  const meta = options.metadata;

  // Use try-catch to handle race condition where another concurrent upload
  // of the same file inserted between our duplicate check and this insert
  try {
    await db.insert(books).values({
      id: bookId,
      filePath: storedPath,
      fileName: processedFileName,
      fileSize: processedBuffer.length,
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
      chapters: audioMetadata.chapters
        ? JSON.stringify(audioMetadata.chapters)
        : null,
    });
  } catch (error: unknown) {
    // Handle UNIQUE constraint violation (race condition with duplicate upload)
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "SQLITE_CONSTRAINT_UNIQUE"
    ) {
      const existing = await db
        .select()
        .from(books)
        .where(eq(books.fileHash, fileHash))
        .get();
      return {
        success: false,
        error: "duplicate",
        existingBookId: existing?.id,
      };
    }
    throw error;
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
  if (ext === ".azw") return "mobi";
  if (ext === ".azw3") return "azw3";
  if (ext === ".cbr") return "cbr";
  if (ext === ".cbz") return "cbz";
  if (ext === ".m4b") return "m4b";
  if (ext === ".m4a") return "m4a";
  if (ext === ".mp3") return "mp3";

  // Check by magic bytes
  const header = buffer.subarray(0, 8);

  // PDF: %PDF
  if (
    header[0] === 0x25 &&
    header[1] === 0x50 &&
    header[2] === 0x44 &&
    header[3] === 0x46
  ) {
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
  if (
    header[0] === 0x52 &&
    header[1] === 0x61 &&
    header[2] === 0x72 &&
    header[3] === 0x21
  ) {
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
  if (
    header[4] === 0x66 &&
    header[5] === 0x74 &&
    header[6] === 0x79 &&
    header[7] === 0x70
  ) {
    // Check brand type to distinguish M4B from M4A
    const brand = buffer.subarray(8, 12).toString();
    if (brand === "M4B " || brand === "isom") {
      return "m4b";
    }
    return "m4a";
  }

  return null;
}

async function extractMetadata(
  buffer: Buffer,
  format: BookFormat,
): Promise<BookMetadata> {
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

// Background processing for large files - extracts metadata, cover, and indexes content
function queueBackgroundProcessing(
  bookId: string,
  buffer: Buffer,
  format: BookFormat,
) {
  scheduleBackground(async () => {
    // Extract metadata in worker thread (falls back to main thread)
    let metadata: BookMetadata | AudioMetadata;
    try {
      metadata = await runInWorker<BookMetadata>(
        "extractMetadata",
        buffer,
        format,
        () => suppressConsole(() => extractMetadata(buffer, format)),
      );
    } catch {
      metadata = { title: null, authors: [] };
    }
    const audioMeta = metadata as AudioMetadata;

    // Yield to event loop between heavy operations
    await yieldToEventLoop();

    // Extract cover in worker thread
    const coverResultRaw = await runInWorker<CoverResult | null>(
      "extractCover",
      buffer,
      format,
      () => suppressConsole(() => extractCover(buffer, format)),
    );
    const coverResult = coverResultRaw
      ? {
          ...coverResultRaw,
          buffer: Buffer.from(coverResultRaw.buffer),
          thumbnail: Buffer.from(coverResultRaw.thumbnail),
        }
      : null;
    const coverPath = coverResult
      ? storeCoverImage(coverResult.buffer, bookId)
      : null;
    if (coverResult) storeCoverThumbnail(coverResult.thumbnail, bookId);

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
    if (metadata.publishedDate)
      updateData.publishedDate = metadata.publishedDate;
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
  });
}

/**
 * Process a multi-file audiobook with job progress tracking for SSE streaming
 * @param existingJobId - Optional job ID if already created by caller (for background processing)
 */
export async function processMultiFileAudiobookWithProgress(
  files: Array<{ buffer: Buffer; fileName: string }>,
  folderName: string,
  options: ImportOptions = {},
  existingJobId?: string,
): Promise<ProcessingResultWithJob> {
  const startTime = Date.now();

  // Use existing job ID or create a new one
  const jobId =
    existingJobId ||
    `merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Only create job if we don't have an existing one
  if (!existingJobId) {
    createJob(jobId);
  }
  updateJobProgress(jobId, {
    status: "running",
    message: "Preparing files...",
  });

  if (files.length === 0) {
    updateJobProgress(jobId, {
      status: "error",
      result: { error: "no_files" },
    });
    return { success: false, error: "no_files", jobId };
  }

  // Sort files by track number
  const sortedFiles = sortAudioFilesByTrack(files);

  // Assign track numbers
  const filesWithTracks: AudioFileInput[] = sortedFiles.map((f, i) => ({
    buffer: f.buffer,
    fileName: f.fileName,
    trackNumber: i + 1,
  }));

  // Generate book ID
  const bookId = uuid();

  // Create output path for merged file (absolute for file operations)
  const outputPath = getBookFilePath(bookId, "m4b");
  // Relative path for database storage
  const relativeFilePath = getBookFileRelativePath(bookId, "m4b");

  // Merge all files into single M4B with progress tracking
  updateJobProgress(jobId, {
    status: "running",
    progress: 0,
    message: "Merging audio files...",
  });

  const mergeResult = await mergeAudioFiles(filesWithTracks, outputPath, {
    onProgress: (progress, currentTime, totalDuration) => {
      updateJobProgress(jobId, {
        progress,
        currentTime,
        totalDuration,
        message: `Merging: ${progress}%`,
      });
    },
  });

  if (!mergeResult.success) {
    updateJobProgress(jobId, {
      status: "error",
      result: { error: mergeResult.error || "merge_failed" },
    });
    return {
      success: false,
      error: mergeResult.error || "merge_failed",
      jobId,
    };
  }

  updateJobProgress(jobId, {
    progress: 100,
    message: "Processing metadata...",
  });

  // Compute hash of merged file for deduplication
  const fileHash = createHash("sha256")
    .update(mergeResult.outputBuffer!)
    .digest("hex");

  // Check for duplicates
  const existing = await db
    .select()
    .from(books)
    .where(eq(books.fileHash, fileHash))
    .get();
  if (existing && !options.overwriteExisting) {
    // Clean up the merged file since it's a duplicate
    const { deleteBookFile } = await import("../storage");
    deleteBookFile(outputPath);
    updateJobProgress(jobId, {
      status: "error",
      result: { error: "duplicate" },
    });
    return {
      success: false,
      error: "duplicate",
      existingBookId: existing.id,
      jobId,
    };
  }

  // Extract metadata from first file
  let metadata: AudioMetadata;
  try {
    metadata = await suppressConsole(() =>
      extractAudioMetadata(sortedFiles[0].buffer),
    );
  } catch {
    metadata = { title: null, authors: [] };
  }

  // Extract cover from first file (or try all files until we find one)
  let rawCover = await suppressConsole(() =>
    extractAudioCover(sortedFiles[0].buffer),
  );
  if (!rawCover) {
    for (let i = 1; i < sortedFiles.length && !rawCover; i++) {
      rawCover = await suppressConsole(() =>
        extractAudioCover(sortedFiles[i].buffer),
      );
    }
  }
  const coverResult = rawCover
    ? await processAndStoreCover(rawCover.buffer, bookId)
    : null;
  const coverPath = coverResult?.path || null;

  // Merge metadata with overrides
  const meta = options.metadata;
  const fileName = `${folderName}.m4b`;

  try {
    await db.insert(books).values({
      id: bookId,
      filePath: relativeFilePath,
      fileName,
      fileSize: mergeResult.outputBuffer!.length,
      fileHash,
      mimeType: "audio/mp4",
      title: meta?.title || metadata.title || folderName,
      subtitle: metadata.subtitle,
      authors: meta?.authors
        ? JSON.stringify(meta.authors)
        : JSON.stringify(metadata.authors || []),
      publisher: meta?.publisher || metadata.publisher,
      description: meta?.description || metadata.description,
      language: meta?.language || metadata.language,
      coverPath,
      coverColor: coverResult?.dominantColor,
      duration: mergeResult.duration,
      narrator: metadata.narrator,
      chapters: mergeResult.chapters
        ? JSON.stringify(mergeResult.chapters)
        : null,
    });
  } catch (error: unknown) {
    // Handle UNIQUE constraint violation
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "SQLITE_CONSTRAINT_UNIQUE"
    ) {
      const existing = await db
        .select()
        .from(books)
        .where(eq(books.fileHash, fileHash))
        .get();
      updateJobProgress(jobId, {
        status: "error",
        result: { error: "duplicate" },
      });
      return {
        success: false,
        error: "duplicate",
        existingBookId: existing?.id,
        jobId,
      };
    }
    throw error;
  }

  // Mark job as complete
  updateJobProgress(jobId, {
    status: "completed",
    progress: 100,
    message: "Complete",
    result: { bookId },
  });

  return {
    success: true,
    bookId,
    jobId,
    processingTime: Date.now() - startTime,
  };
}
