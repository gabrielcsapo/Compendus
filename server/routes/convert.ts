import { Hono } from "hono";
import { existsSync } from "fs";
import { resolve, extname } from "path";
import { eq } from "drizzle-orm";
import { db, books } from "../../app/lib/db";
import { enqueueJob, getJob } from "../../app/lib/queue";

const app = new Hono();

const CONVERTIBLE_FORMATS = ["pdf", "mobi", "azw3"];

/**
 * POST /api/books/:id/convert-to-epub
 * Enqueues EPUB conversion as a background job.
 * Supports PDF, MOBI, and AZW3 formats.
 * Returns immediately with a jobId for progress tracking.
 */
app.post("/api/books/:id/convert-to-epub", async (c) => {
  const bookId = c.req.param("id");

  // Look up the book
  const book = await db.query.books.findFirst({
    where: eq(books.id, bookId),
  });

  if (!book) {
    return c.json({ success: false, error: "Book not found" }, 404);
  }

  if (!CONVERTIBLE_FORMATS.includes(book.format)) {
    return c.json({
      success: false,
      error: "not_convertible",
      message: "Only PDF and MOBI/AZW3 books can be converted to EPUB",
    }, 400);
  }

  // Check if already converted (allow force reconversion)
  const body = await c.req.json().catch(() => ({}));
  const force = body?.force === true;

  if (book.convertedEpubPath && !force) {
    return c.json({
      success: true,
      alreadyConverted: true,
      convertedEpubSize: book.convertedEpubSize,
    });
  }

  // Check if a conversion job is already running or queued
  const jobId = `convert-${bookId}`;
  const existingJob = getJob(jobId);
  if (existingJob && (existingJob.status === "pending" || existingJob.status === "running")) {
    return c.json({ success: true, jobId, pending: true });
  }

  // Verify source file exists
  const ext = book.fileName ? extname(book.fileName) : `.${book.format}`;
  const bookPath = resolve(process.cwd(), "data", "books", `${bookId}${ext}`);
  if (!existsSync(bookPath)) {
    return c.json({ success: false, error: "Source file not found on disk" }, 404);
  }

  // Enqueue job for background processing
  enqueueJob(jobId, "convert", {
    bookId,
    bookPath,
    format: book.format,
    title: book.title,
    authors: book.authors ?? "[]",
    language: book.language,
  });

  return c.json({ success: true, jobId, pending: true });
});

/**
 * GET /api/books/:id/epub-status
 * Check if a converted EPUB exists for a book.
 */
app.get("/api/books/:id/epub-status", async (c) => {
  const bookId = c.req.param("id");

  const book = await db.query.books.findFirst({
    where: eq(books.id, bookId),
  });

  if (!book) {
    return c.json({ success: false, error: "Book not found" }, 404);
  }

  if (book.convertedEpubPath) {
    return c.json({
      success: true,
      hasEpub: true,
      convertedEpubSize: book.convertedEpubSize,
    });
  }

  return c.json({ success: true, hasEpub: false });
});

export { app as convertRoutes };
