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
import { mkdirSync, statSync } from "fs";
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
  // Legacy fields kept for backward compatibility with already-queued jobs; the
  // processor now reads everything it needs from the book row via convertBookToEpub.
  bookPath?: string;
  format?: string;
  title?: string;
  authors?: string;
  language?: string | null;
}

interface ExtractPayload {
  bookId: string;
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

export function subscribeToJob(id: string, callback: (progress: JobProgress) => void): () => void {
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

  lastProgressAt = Date.now(); // heartbeat for the stuck-job detector
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
 * Append a line to the job's logs column. Keeps the last 500 lines max.
 */
function appendJobLog(id: string, line: string): void {
  const row = db
    .select({ logs: backgroundJobs.logs })
    .from(backgroundJobs)
    .where(eq(backgroundJobs.id, id))
    .get();
  if (!row) return;

  const existing = row.logs ?? "";
  const lines = existing ? existing.split("\n") : [];
  lines.push(line);
  // Keep last 500 lines to prevent unbounded growth
  const trimmed = lines.length > 500 ? lines.slice(-500) : lines;
  db.update(backgroundJobs)
    .set({ logs: trimmed.join("\n") })
    .where(eq(backgroundJobs.id, id))
    .run();
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
    notifySubscribers(id, {
      id,
      status: "error",
      progress: 0,
      message: "Cancelled",
      updatedAt: Date.now(),
    });
    return { success: true, message: "Pending job cancelled" };
  }

  if (row.status === "running") {
    // Signal the running job to abort
    currentAbortController?.abort();
    updateJobProgress(id, {
      status: "error",
      progress: 0,
      message: "Cancelled by user",
      result: { error: "Cancelled" },
    });
    return { success: true, message: "Running job cancelled" };
  }

  // completed or error — just delete it
  db.delete(backgroundJobs).where(eq(backgroundJobs.id, id)).run();
  return { success: true, message: "Job cleared" };
}

/**
 * Cancel/clear every job at once: aborts the running job, drops all pending jobs,
 * and clears finished (completed/error) rows. Use to stop a runaway batch (e.g. a
 * large graph backfill) and empty the queue.
 */
export function cancelAllJobs(): { success: boolean; message: string; cancelled: number } {
  const rows = db.select().from(backgroundJobs).all();

  // Signal the in-flight job to stop at its next checkpoint.
  currentAbortController?.abort();

  // Remove every row regardless of status.
  db.delete(backgroundJobs).run();

  // Settle any open UIs/SSE subscribers watching active jobs.
  for (const r of rows) {
    if (r.status === "pending" || r.status === "running") {
      notifySubscribers(r.id, {
        id: r.id,
        status: "error",
        progress: 0,
        message: "Cancelled",
        updatedAt: Date.now(),
      });
    }
  }

  return {
    success: true,
    message: `Cancelled ${rows.length} job${rows.length === 1 ? "" : "s"}`,
    cancelled: rows.length,
  };
}

// ---------------------------------------------------------------------------
// Job processor — runs one job at a time
// ---------------------------------------------------------------------------

let processorRunning = false;
let processorStartedAt: number | null = null;
/** Heartbeat: updated on every job-progress write. A job that keeps reporting
 *  progress is NOT stuck, however long it runs (big books take many minutes). */
let lastProgressAt: number | null = null;
let currentAbortController: AbortController | null = null;

/** Consider the processor stuck only when the running job has reported NO
 *  progress for this long (genuinely hung), not merely run a long time. */
const STUCK_NO_PROGRESS_MS = 3 * 60 * 1000;

async function processTranscribeJob(jobId: string, payload: TranscribePayload): Promise<void> {
  const { bookId, bookPath, outputPath } = payload;

  // Ensure transcripts directory exists
  const transcriptsDir = resolve(process.cwd(), "data", "transcripts");
  mkdirSync(transcriptsDir, { recursive: true });

  // Check whisper availability
  if (!(await isWhisperAvailable())) {
    throw new Error(
      "whisper-cli is not available. Ensure whisper.cpp is built and whisper-cli is on PATH.",
    );
  }

  await transcribeAudio(bookPath, outputPath, {
    onProgress: (progress, message) => {
      updateJobProgress(jobId, { status: "running", progress, message });
    },
    onLog: (line) => {
      appendJobLog(jobId, line);
    },
  });

  // Update DB with transcript path
  await db
    .update(books)
    .set({ transcriptPath: `data/transcripts/${payload.bookId}.json` })
    .where(eq(books.id, bookId));
}

async function processConvertJob(jobId: string, payload: ConvertPayload): Promise<void> {
  const { bookId } = payload;
  const book = db.select().from(books).where(eq(books.id, bookId)).get();
  if (!book) throw new Error("Book not found");

  // Shared with the knowledge pipeline's on-demand conversion (single source of
  // truth for "turn this book into an EPUB and record it on the book row").
  const { convertBookToEpub } = await import("./processing/ensure-epub");
  const epubPath = await convertBookToEpub(book, {
    onProgress: (percent, message) =>
      updateJobProgress(jobId, { status: "running", progress: percent, message }),
  });

  const epubSize = statSync(epubPath).size;
  console.log(
    `[Queue] ${book.format.toUpperCase()} → EPUB conversion complete for ${bookId} (${(epubSize / 1024).toFixed(1)} KB)`,
  );
}

async function processExtractJob(jobId: string, payload: ExtractPayload): Promise<void> {
  // Dynamic import keeps the LLM/embeddings deps out of the queue's static graph.
  const { analyzeBook } = await import("./knowledge/pipeline");
  await analyzeBook(payload.bookId, {
    signal: currentAbortController?.signal,
    onProgress: (progress, message) =>
      updateJobProgress(jobId, { status: "running", progress, message }),
    onLog: (line) => appendJobLog(jobId, line),
  });
}

// Backfill CCD bundles for the whole library — idempotent (skips books already
// at the current CCD version). Dynamic import keeps pdfjs/epub deps out of the
// queue's static graph.
const CCD_BACKFILL_DELAY_MS = 750;
// Per-book hard cap. > the worker's 120s task timeout, so the worker recovers
// worker-side hangs first; this catches main-thread hangs (e.g. ensureEpub).
const CCD_BOOK_TIMEOUT_MS = 180_000;

async function processCcdBackfillJob(jobId: string): Promise<void> {
  const { generateCcd, needsCcd } = await import("./processing/ccd");
  const all = db.select().from(books).all();
  const todo = all.filter((b) => needsCcd(b));
  let done = 0,
    failed = 0;
  for (const book of todo) {
    if (currentAbortController?.signal.aborted) return;
    try {
      // Per-book hard timeout. The worker step has its own 120s cap, but the
      // upstream ensureEpub (mobi/azw3→EPUB) runs on the main thread with no
      // timeout — a single book whose conversion never settles (a hang that
      // yields, so the host stays responsive but the await never returns) would
      // otherwise wedge the entire backfill. This fails that one book and moves on.
      await Promise.race([
        generateCcd(book),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`generateCcd timed out after ${CCD_BOOK_TIMEOUT_MS}ms`)),
            CCD_BOOK_TIMEOUT_MS,
          ),
        ),
      ]);
    } catch (e) {
      failed++;
      appendJobLog(
        jobId,
        `${book.id} (${book.format}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    done++;
    updateJobProgress(jobId, {
      status: "running",
      progress: Math.round((done / Math.max(1, todo.length)) * 100),
      message: `CCD ${done}/${todo.length} (${failed} failed)`,
    });
    // CPU-polite throttle: pause between books so the conversion loop doesn't
    // starve the event loop / peg the shared host (which makes the site
    // unusable). The await yields the loop; the delay leaves headroom.
    await new Promise((r) => setTimeout(r, CCD_BACKFILL_DELAY_MS));
  }
  updateJobProgress(jobId, {
    status: "completed",
    progress: 100,
    message: `CCD backfill complete: ${todo.length - failed}/${todo.length}`,
    result: { total: todo.length, failed },
  });
}

// Durable single-book CCD generation, enqueued at upload. Being a real queue job
// (not the old fire-and-forget chain) means it survives a restart: an interrupted
// run is reset to pending on boot and retried, so a book uploaded near a redeploy
// can't get stranded in "processing" with no CCD.
async function processGenerateCcdJob(jobId: string, payload: { bookId?: string }): Promise<void> {
  const bookId = payload.bookId;
  if (!bookId) throw new Error("generate-ccd: missing bookId");
  const { generateCcd, needsCcd } = await import("./processing/ccd");
  const book = db.select().from(books).where(eq(books.id, bookId)).get();
  if (!book) {
    appendJobLog(jobId, `${bookId}: book not found (deleted?) — skipping`);
    return;
  }
  if (!needsCcd(book)) return; // already converted at the current version — nothing to do
  updateJobProgress(jobId, { status: "running", progress: 30, message: "Building CCD…" });
  await generateCcd(book); // persists ccd_path/ccd_version on success, or ccd_error on failure
}

async function processNextJob(): Promise<void> {
  if (processorRunning) {
    // Safety valve: only treat the job as stuck if it has made NO progress for a
    // while (a long-but-progressing job is healthy). Crucially, ABORT the stuck
    // job before resetting — otherwise it keeps running while we start another,
    // piling up concurrent runs that exhaust CPU/RAM.
    const idleMs = Date.now() - (lastProgressAt ?? processorStartedAt ?? Date.now());
    if (idleMs > STUCK_NO_PROGRESS_MS) {
      console.warn(
        `[Queue] Job made no progress for ${Math.round(idleMs / 1000)}s — aborting and resetting`,
      );
      currentAbortController?.abort();
      processorRunning = false;
      processorStartedAt = null;
      lastProgressAt = null;
      currentAbortController = null;
    }
    return; // wait for the next tick before starting another job
  }

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
  processorStartedAt = Date.now();
  lastProgressAt = Date.now();
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
    } else if (row.type === "extract") {
      await processExtractJob(jobId, payload as ExtractPayload);
    } else if (row.type === "ccd-backfill") {
      await processCcdBackfillJob(jobId);
    } else if (row.type === "generate-ccd") {
      await processGenerateCcdJob(jobId, payload as { bookId?: string });
    } else {
      throw new Error(`Unknown job type: ${row.type}`);
    }

    // Check if cancelled during processing
    if (currentAbortController.signal.aborted) return;

    const completionLabel: Record<string, string> = {
      transcribe: "Transcription",
      convert: "Conversion",
      extract: "Analysis",
      "generate-ccd": "Preparation",
    };
    updateJobProgress(jobId, {
      status: "completed",
      progress: 100,
      message: `${completionLabel[row.type] ?? "Job"} complete`,
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
    processorStartedAt = null;
  }
}

/**
 * Start the background job processor. Call once at server startup.
 * - Resets any stale "running" jobs back to "pending" (from a previous crash)
 * - Polls for pending jobs every 2 seconds and processes them sequentially
 */
let processorStarted = false;

export function startJobProcessor(): void {
  if (processorStarted) {
    console.log("[Queue] Job processor already started, skipping");
    return;
  }
  processorStarted = true;

  // Reset stale running jobs (server crashed while processing)
  const stale = db.select().from(backgroundJobs).where(eq(backgroundJobs.status, "running")).all();

  // Only reset enqueued job types (not inline jobs like audio merge)
  for (const row of stale) {
    if (
      row.type === "transcribe" ||
      row.type === "convert" ||
      row.type === "extract" ||
      row.type === "generate-ccd"
    ) {
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
