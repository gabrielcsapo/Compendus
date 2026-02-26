/**
 * Persistent background job queue backed by SQLite.
 *
 * Supports two usage patterns:
 * 1. **Enqueued jobs** (transcription, conversion) — `enqueueJob()` inserts with
 *    status="pending", the processor picks them up sequentially.
 * 2. **Inline jobs** (audio merge during upload) — `createJob()` inserts with
 *    status="running", code updates progress directly via `updateJobProgress()`.
 *
 * Both patterns persist to SQLite and notify SSE subscribers in real time.
 */
import { eq, asc } from "drizzle-orm";
import { readFile } from "fs/promises";
import { mkdirSync, statSync, writeFileSync } from "fs";
import { resolve } from "path";
import { db, backgroundJobs, books } from "./db";
import { transcribeAudio, isWhisperAvailable } from "./processing/transcribe";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape returned by getJob / sent to SSE subscribers (matches old in-memory format) */
export interface JobProgress {
  id: string;
  status: "pending" | "running" | "completed" | "error";
  progress: number;
  currentTime?: number;
  totalDuration?: number;
  message?: string;
  result?: { bookId?: string; error?: string };
  updatedAt: number;
}

interface TranscribePayload {
  bookId: string;
  bookPath: string;
  outputPath: string;
}

interface ConvertPayload {
  bookId: string;
  bookPath: string;
  format: string;
  title: string;
  authors: string;
  language: string | null;
}

// ---------------------------------------------------------------------------
// In-memory pub/sub for SSE (ephemeral — doesn't need persistence)
// ---------------------------------------------------------------------------

const subscribers = new Map<string, Set<(progress: JobProgress) => void>>();

function notifySubscribers(id: string, job: JobProgress): void {
  const subs = subscribers.get(id);
  if (subs) {
    for (const cb of subs) cb(job);
  }
}

export function subscribeToJob(
  id: string,
  callback: (progress: JobProgress) => void,
): () => void {
  let subs = subscribers.get(id);
  if (!subs) {
    subs = new Set();
    subscribers.set(id, subs);
  }
  subs.add(callback);

  return () => {
    subs?.delete(callback);
    if (subs?.size === 0) subscribers.delete(id);
  };
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function rowToJob(row: typeof backgroundJobs.$inferSelect): JobProgress {
  const result = row.result ? JSON.parse(row.result) : undefined;
  const payload = row.payload ? JSON.parse(row.payload) : undefined;
  return {
    id: row.id,
    status: row.status as JobProgress["status"],
    progress: row.progress ?? 0,
    message: row.message ?? undefined,
    result,
    currentTime: payload?.currentTime,
    totalDuration: payload?.totalDuration,
    updatedAt: row.updatedAt ? row.updatedAt.getTime() : Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a job with status="running" (for inline progress tracking, e.g. audio merge).
 */
export function createJob(id: string): JobProgress {
  const now = new Date();
  db.insert(backgroundJobs)
    .values({
      id,
      type: "inline",
      status: "running",
      progress: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: backgroundJobs.id,
      set: { status: "running", progress: 0, message: null, result: null, updatedAt: now },
    })
    .run();

  return { id, status: "running", progress: 0, updatedAt: now.getTime() };
}

/**
 * Enqueue a job for background processing. Status starts as "pending".
 */
export function enqueueJob(
  id: string,
  type: string,
  payload: Record<string, unknown>,
): JobProgress {
  const now = new Date();
  db.insert(backgroundJobs)
    .values({
      id,
      type,
      status: "pending",
      progress: 0,
      payload: JSON.stringify(payload),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: backgroundJobs.id,
      set: {
        type,
        status: "pending",
        progress: 0,
        message: null,
        result: null,
        payload: JSON.stringify(payload),
        updatedAt: now,
      },
    })
    .run();

  const job: JobProgress = { id, status: "pending", progress: 0, updatedAt: now.getTime() };
  notifySubscribers(id, job);
  return job;
}

/**
 * Get current job state.
 */
export function getJob(id: string): JobProgress | null {
  const row = db.select().from(backgroundJobs).where(eq(backgroundJobs.id, id)).get();
  if (!row) return null;
  return rowToJob(row);
}

/**
 * Update job progress. Writes to SQLite and notifies SSE subscribers.
 */
export function updateJobProgress(
  id: string,
  updates: Partial<Omit<JobProgress, "id" | "updatedAt">>,
): JobProgress | null {
  const row = db.select().from(backgroundJobs).where(eq(backgroundJobs.id, id)).get();
  if (!row) return null;

  const now = new Date();
  const set: Record<string, unknown> = { updatedAt: now };

  if (updates.status !== undefined) set.status = updates.status;
  if (updates.progress !== undefined) set.progress = updates.progress;
  if (updates.message !== undefined) set.message = updates.message;
  if (updates.result !== undefined) set.result = JSON.stringify(updates.result);

  // Persist currentTime/totalDuration in payload JSON
  if (updates.currentTime !== undefined || updates.totalDuration !== undefined) {
    const existingPayload = row.payload ? JSON.parse(row.payload) : {};
    if (updates.currentTime !== undefined) existingPayload.currentTime = updates.currentTime;
    if (updates.totalDuration !== undefined) existingPayload.totalDuration = updates.totalDuration;
    set.payload = JSON.stringify(existingPayload);
  }

  db.update(backgroundJobs).set(set).where(eq(backgroundJobs.id, id)).run();

  // Build updated job for subscribers
  const job = getJob(id)!;
  notifySubscribers(id, job);
  return job;
}

/**
 * Cancel a job. Pending jobs are marked as error immediately.
 * Running jobs are signalled to abort — the processor will stop them.
 * Completed/error jobs are deleted from the database.
 */
export function cancelJob(id: string): { success: boolean; message: string } {
  const row = db.select().from(backgroundJobs).where(eq(backgroundJobs.id, id)).get();
  if (!row) return { success: false, message: "Job not found" };

  if (row.status === "pending") {
    db.delete(backgroundJobs).where(eq(backgroundJobs.id, id)).run();
    notifySubscribers(id, { id, status: "error", progress: 0, message: "Cancelled", updatedAt: Date.now() });
    return { success: true, message: "Pending job cancelled" };
  }

  if (row.status === "running") {
    // Signal the running job to abort
    currentAbortController?.abort();
    updateJobProgress(id, { status: "error", progress: 0, message: "Cancelled by user", result: { error: "Cancelled" } });
    return { success: true, message: "Running job cancelled" };
  }

  // completed or error — just delete it
  db.delete(backgroundJobs).where(eq(backgroundJobs.id, id)).run();
  return { success: true, message: "Job cleared" };
}

// ---------------------------------------------------------------------------
// Job processor — runs one job at a time
// ---------------------------------------------------------------------------

let processorRunning = false;
let currentAbortController: AbortController | null = null;

async function processTranscribeJob(jobId: string, payload: TranscribePayload): Promise<void> {
  const { bookId, bookPath, outputPath } = payload;

  // Ensure transcripts directory exists
  const transcriptsDir = resolve(process.cwd(), "data", "transcripts");
  mkdirSync(transcriptsDir, { recursive: true });

  // Check whisper availability
  if (!(await isWhisperAvailable())) {
    throw new Error("whisper-cli is not available. Ensure whisper.cpp is built and whisper-cli is on PATH.");
  }

  await transcribeAudio(bookPath, outputPath, {
    onProgress: (progress, message) => {
      updateJobProgress(jobId, { status: "running", progress, message });
    },
  });

  // Update DB with transcript path
  await db
    .update(books)
    .set({ transcriptPath: `data/transcripts/${payload.bookId}.json` })
    .where(eq(books.id, bookId));
}

async function processConvertJob(jobId: string, payload: ConvertPayload): Promise<void> {
  const { bookId, bookPath, format } = payload;

  updateJobProgress(jobId, {
    status: "running",
    progress: 1,
    message: `Reading ${format.toUpperCase()} file...`,
  });

  const fileBuffer = await readFile(bookPath);

  const authors = payload.authors ? JSON.parse(payload.authors) : [];
  const metadata = {
    title: payload.title,
    authors: Array.isArray(authors) ? authors : [],
    language: payload.language ?? undefined,
  };

  const onProgress = (percent: number, message: string) => {
    updateJobProgress(jobId, { status: "running", progress: percent, message });
  };

  let epubBuffer: Buffer;
  if (format === "pdf") {
    const { convertPdfToEpub } = await import("./processing/pdf-to-epub");
    epubBuffer = await convertPdfToEpub(fileBuffer, metadata, { onProgress });
  } else {
    const { convertMobiToEpub } = await import("./processing/mobi-to-epub");
    epubBuffer = await convertMobiToEpub(fileBuffer, metadata, { onProgress });
  }

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

  console.log(`[Queue] ${format.toUpperCase()} → EPUB conversion complete for ${bookId} (${(epubSize / 1024).toFixed(1)} KB)`);
}

async function processNextJob(): Promise<void> {
  if (processorRunning) return;

  // Find oldest pending job
  const row = db
    .select()
    .from(backgroundJobs)
    .where(eq(backgroundJobs.status, "pending"))
    .orderBy(asc(backgroundJobs.createdAt))
    .limit(1)
    .get();

  if (!row) return;

  processorRunning = true;
  currentAbortController = new AbortController();
  const jobId = row.id;

  try {
    console.log(`[Queue] Processing job ${jobId} (type: ${row.type})`);
    updateJobProgress(jobId, {
      status: "running",
      progress: 1,
      message: "Starting...",
    });

    const payload = row.payload ? JSON.parse(row.payload) : {};

    if (row.type === "transcribe") {
      await processTranscribeJob(jobId, payload as TranscribePayload);
    } else if (row.type === "convert") {
      await processConvertJob(jobId, payload as ConvertPayload);
    } else {
      throw new Error(`Unknown job type: ${row.type}`);
    }

    // Check if cancelled during processing
    if (currentAbortController.signal.aborted) return;

    updateJobProgress(jobId, {
      status: "completed",
      progress: 100,
      message: `${row.type === "transcribe" ? "Transcription" : "Conversion"} complete`,
      result: { bookId: payload.bookId },
    });

    console.log(`[Queue] Job ${jobId} completed`);
  } catch (error) {
    // Don't overwrite cancel status
    if (currentAbortController.signal.aborted) return;

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Queue] Job ${jobId} failed:`, errorMessage);

    updateJobProgress(jobId, {
      status: "error",
      progress: 0,
      message: `Failed: ${errorMessage}`,
      result: { error: errorMessage },
    });
  } finally {
    currentAbortController = null;
    processorRunning = false;
  }
}

/**
 * Start the background job processor. Call once at server startup.
 * - Resets any stale "running" jobs back to "pending" (from a previous crash)
 * - Polls for pending jobs every 2 seconds and processes them sequentially
 */
export function startJobProcessor(): void {
  // Reset stale running jobs (server crashed while processing)
  const stale = db
    .select()
    .from(backgroundJobs)
    .where(eq(backgroundJobs.status, "running"))
    .all();

  // Only reset enqueued job types (not inline jobs like audio merge)
  for (const row of stale) {
    if (row.type === "transcribe" || row.type === "convert") {
      db.update(backgroundJobs)
        .set({ status: "pending", updatedAt: new Date() })
        .where(eq(backgroundJobs.id, row.id))
        .run();
      console.log(`[Queue] Reset stale job ${row.id} back to pending`);
    }
  }

  // Start polling loop
  setInterval(() => {
    processNextJob().catch((err) => {
      console.error("[Queue] Processor error:", err);
      processorRunning = false;
    });
  }, 2000);

  console.log("[Queue] Job processor started");
}
