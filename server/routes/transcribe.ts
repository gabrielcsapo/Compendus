import { Hono } from "hono";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { resolve, extname } from "path";
import { eq } from "drizzle-orm";
import { db, books } from "../../app/lib/db";
import { enqueueJob, getJob } from "../../app/lib/queue";
import { isWhisperAvailable } from "../../app/lib/processing/transcribe";

const app = new Hono();

const AUDIO_FORMATS = ["m4b", "mp3", "m4a"];

/**
 * POST /api/books/:id/transcribe
 * Enqueues transcription as a background job.
 * Returns immediately with a jobId for progress tracking.
 */
app.post("/api/books/:id/transcribe", async (c) => {
  const bookId = c.req.param("id");

  const book = await db.query.books.findFirst({
    where: eq(books.id, bookId),
  });

  if (!book) {
    return c.json({ success: false, error: "Book not found" }, 404);
  }

  if (!AUDIO_FORMATS.includes(book.format)) {
    return c.json({
      success: false,
      error: "not_audiobook",
      message: "Only audiobooks can be transcribed",
    }, 400);
  }

  // Check if already transcribed (allow force re-transcription)
  const body = await c.req.json().catch(() => ({}));
  const force = body?.force === true;

  if (book.transcriptPath && !force) {
    return c.json({ success: true, alreadyTranscribed: true });
  }

  // Check if a transcription job is already running or queued
  const jobId = `transcribe-${bookId}`;
  const existingJob = getJob(jobId);
  if (existingJob && (existingJob.status === "pending" || existingJob.status === "running")) {
    return c.json({ success: true, jobId, pending: true });
  }

  // Check whisper availability
  if (!(await isWhisperAvailable())) {
    return c.json({
      success: false,
      error: "whisper_not_available",
      message: "whisper-cli is not available. Ensure whisper.cpp is built and whisper-cli is on PATH.",
    }, 400);
  }

  // Verify source file exists
  const ext = book.fileName ? extname(book.fileName) : `.${book.format}`;
  const bookPath = resolve(process.cwd(), "data", "books", `${bookId}${ext}`);
  if (!existsSync(bookPath)) {
    return c.json({ success: false, error: "Source audio file not found on disk" }, 404);
  }

  const outputPath = resolve(process.cwd(), "data", "transcripts", `${bookId}.json`);

  // Enqueue job for background processing
  enqueueJob(jobId, "transcribe", { bookId, bookPath, outputPath });

  return c.json({ success: true, jobId, pending: true });
});

/**
 * GET /api/books/:id/transcript
 * Returns the transcript JSON if available.
 */
app.get("/api/books/:id/transcript", async (c) => {
  const bookId = c.req.param("id");

  const book = await db.query.books.findFirst({
    where: eq(books.id, bookId),
  });

  if (!book) {
    return c.json({ success: false, error: "Book not found" }, 404);
  }

  if (!book.transcriptPath) {
    return c.json({ success: false, error: "no_transcript" }, 404);
  }

  const fullPath = resolve(process.cwd(), book.transcriptPath);
  if (!existsSync(fullPath)) {
    return c.json({ success: false, error: "Transcript file not found on disk" }, 404);
  }

  const data = await readFile(fullPath, "utf-8");
  return c.json({ success: true, transcript: JSON.parse(data) });
});

/**
 * GET /api/books/:id/transcript-status
 * Quick check if transcript exists.
 */
app.get("/api/books/:id/transcript-status", async (c) => {
  const bookId = c.req.param("id");

  const book = await db.query.books.findFirst({
    where: eq(books.id, bookId),
  });

  if (!book) {
    return c.json({ success: false, error: "Book not found" }, 404);
  }

  return c.json({
    success: true,
    hasTranscript: !!book.transcriptPath,
  });
});

export { app as transcribeRoutes };
