import { Hono } from "hono";
import { readFile } from "fs/promises";
import { existsSync, statSync, writeFileSync } from "fs";
import { resolve } from "path";
import { eq } from "drizzle-orm";
import { db, books } from "../../app/lib/db";
import { createJob, updateJobProgress, getJob } from "../../app/lib/jobs";
import { convertPdfToEpub } from "../../app/lib/processing/pdf-to-epub";

const app = new Hono();

/**
 * POST /api/books/:id/convert-to-epub
 * Triggers PDF → EPUB conversion as a background job.
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

  if (book.format !== "pdf") {
    return c.json({ success: false, error: "not_pdf", message: "Only PDF books can be converted to EPUB" }, 400);
  }

  // Check if already converted
  if (book.convertedEpubPath) {
    return c.json({
      success: true,
      alreadyConverted: true,
      convertedEpubSize: book.convertedEpubSize,
    });
  }

  // Check if a conversion job is already running
  const jobId = `convert-${bookId}`;
  const existingJob = getJob(jobId);
  if (existingJob && (existingJob.status === "pending" || existingJob.status === "running")) {
    return c.json({ success: true, jobId, pending: true });
  }

  // Verify PDF file exists
  const pdfPath = resolve(process.cwd(), "data", "books", `${bookId}.pdf`);
  if (!existsSync(pdfPath)) {
    return c.json({ success: false, error: "PDF file not found on disk" }, 404);
  }

  // Create job and return immediately
  createJob(jobId);

  // Run conversion in background
  (async () => {
    try {
      updateJobProgress(jobId, { status: "running", progress: 1, message: "Reading PDF file..." });

      const pdfBuffer = await readFile(pdfPath);

      // Parse metadata from DB
      const authors = book.authors ? JSON.parse(book.authors) : [];
      const metadata = {
        title: book.title,
        authors: Array.isArray(authors) ? authors : [],
        language: book.language ?? undefined,
      };

      const epubBuffer = await convertPdfToEpub(pdfBuffer, metadata, {
        onProgress: (percent, message) => {
          updateJobProgress(jobId, { status: "running", progress: percent, message });
        },
      });

      // Store the converted EPUB
      const epubPath = resolve(process.cwd(), "data", "books", `${bookId}.epub`);
      writeFileSync(epubPath, epubBuffer);
      const epubSize = statSync(epubPath).size;

      // Update DB
      await db
        .update(books)
        .set({
          convertedEpubPath: `data/books/${bookId}.epub`,
          convertedEpubSize: epubSize,
        })
        .where(eq(books.id, bookId));

      updateJobProgress(jobId, {
        status: "completed",
        progress: 100,
        message: "Conversion complete",
        result: { bookId },
      });

      console.log(`[Convert] PDF → EPUB conversion complete for ${bookId} (${(epubSize / 1024).toFixed(1)} KB)`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`[Convert] PDF → EPUB conversion failed for ${bookId}:`, errorMessage);

      updateJobProgress(jobId, {
        status: "error",
        progress: 0,
        message: `Conversion failed: ${errorMessage}`,
        result: { error: errorMessage },
      });
    }
  })();

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
