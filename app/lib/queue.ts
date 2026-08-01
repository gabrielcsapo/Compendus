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
import { eq, asc, sql } from "drizzle-orm";
import { mkdirSync, statSync } from "fs";
import { resolve } from "path";
import { db, backgroundJobs, books } from "./db";
import { transcribeAudio, isTranscriptionAvailable } from "./processing/transcribe";

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
 * Append a line to the job's logs column. BUFFERED: a busy conversion logs
 * hundreds of lines, and the old read-modify-write per line (read full
 * column, split 500 lines, rejoin, write) ate the event loop. Lines collect
 * in memory and flush every FLUSH_EVERY lines or 2s, whichever first; a
 * crash loses at most a couple of seconds of job log (the console mirror
 * still has everything).
 */
const LOG_BUFFERS = new Map<
  string,
  { lines: string[]; timer: ReturnType<typeof setTimeout> | null }
>();
const LOG_FLUSH_EVERY = 20;
const LOG_FLUSH_MS = 2000;
const LOG_MAX_LINES = 500;

function flushJobLog(id: string): void {
  const buf = LOG_BUFFERS.get(id);
  if (!buf || buf.lines.length === 0) return;
  if (buf.timer) clearTimeout(buf.timer);
  LOG_BUFFERS.delete(id);
  const row = db
    .select({ logs: backgroundJobs.logs })
    .from(backgroundJobs)
    .where(eq(backgroundJobs.id, id))
    .get();
  if (!row) return;
  const lines = row.logs ? row.logs.split("\n") : [];
  lines.push(...buf.lines);
  const trimmed = lines.length > LOG_MAX_LINES ? lines.slice(-LOG_MAX_LINES) : lines;
  db.update(backgroundJobs)
    .set({ logs: trimmed.join("\n") })
    .where(eq(backgroundJobs.id, id))
    .run();
}

function appendJobLog(id: string, line: string): void {
  let buf = LOG_BUFFERS.get(id);
  if (!buf) {
    buf = { lines: [], timer: null };
    LOG_BUFFERS.set(id, buf);
  }
  buf.lines.push(line);
  if (buf.lines.length >= LOG_FLUSH_EVERY) {
    flushJobLog(id);
  } else if (!buf.timer) {
    buf.timer = setTimeout(() => {
      try {
        flushJobLog(id);
      } catch (e) {
        // A throw inside a bare timer is an uncaught exception — process
        // death. SQLITE_BUSY here just means the lines flush on the next try.
        console.error("[Queue] log flush failed:", e);
      }
    }, LOG_FLUSH_MS);
  }
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
    // Abort only when this row is the job actually in flight — an orphaned
    // "running" row (previous container died mid-job) shares the status but
    // not the controller, and aborting would kill the unrelated current job.
    const live = currentJobId === id;
    if (live) currentAbortController?.abort();
    updateJobProgress(id, {
      status: "error",
      progress: 0,
      message: live ? "Cancelled by user" : "Cancelled (orphaned by an earlier crash)",
      result: { error: "Cancelled" },
    });
    return { success: true, message: live ? "Running job cancelled" : "Orphaned job cleared" };
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
/** Id of the job the processor is actually executing right now. A DB row can
 *  say "running" while belonging to a dead process (container swap, OOM) —
 *  cancelJob must only abort the controller when the ids MATCH, or cancelling
 *  an orphaned row kills whatever innocent job is currently in flight. */
let currentJobId: string | null = null;

/** Consider the processor stuck only when the running job has reported NO
 *  progress for this long (genuinely hung), not merely run a long time. */
const STUCK_NO_PROGRESS_MS = 3 * 60 * 1000;

// --- user pause -------------------------------------------------------------------
// The grind is throughput work that will happily eat the whole CPU quota for
// days; when the user actually wants to USE the app (matching books, reading)
// they need a way to reclaim the box. Pause stops claiming jobs and aborts +
// requeues the current one (nothing is lost — it re-claims on resume). Always
// auto-resumes so a forgotten pause can't silently freeze the grind forever.

let queuePausedUntil: number | null = null;

export function queuePauseState(): { paused: boolean; until: number | null } {
  const paused = queuePausedUntil !== null && Date.now() < queuePausedUntil;
  return { paused, until: paused ? queuePausedUntil : null };
}

export function pauseQueue(minutes = 60): {
  paused: true;
  until: number;
  requeuedJob: string | null;
} {
  const mins = Math.min(Math.max(minutes, 1), 24 * 60);
  queuePausedUntil = Date.now() + mins * 60_000;
  let requeuedJob: string | null = null;
  if (currentJobId) {
    requeuedJob = currentJobId;
    const jobId = currentJobId;
    currentAbortController?.abort();
    const requeue = () =>
      db
        .update(backgroundJobs)
        .set({ status: "pending", updatedAt: new Date() })
        .where(eq(backgroundJobs.id, jobId))
        .run();
    requeue();
    // A progress callback already in flight can flip the row back to
    // "running" after our write; re-assert once the abort has settled.
    setTimeout(() => {
      try {
        requeue();
      } catch (e) {
        console.error("[Queue] pause requeue retry failed:", e);
      }
    }, 5000);
  }
  console.log(
    `[Queue] PAUSED for ${mins}min by user${requeuedJob ? ` (requeued ${requeuedJob})` : ""}`,
  );
  return { paused: true, until: queuePausedUntil, requeuedJob };
}

export function resumeQueue(): { paused: false } {
  queuePausedUntil = null;
  console.log("[Queue] resumed by user");
  return { paused: false };
}

async function processTranscribeJob(jobId: string, payload: TranscribePayload): Promise<void> {
  const { bookId, bookPath, outputPath } = payload;

  // Ensure transcripts directory exists
  const transcriptsDir = resolve(process.cwd(), "data", "transcripts");
  mkdirSync(transcriptsDir, { recursive: true });

  // Preflight: the Lemonade host must answer and have the ASR model pulled.
  if (!(await isTranscriptionAvailable())) {
    throw new Error(
      "Lemonade ASR is not available. Ensure the lemonade server is reachable (OLLAMA_URL) and `lemonade-server pull whisper-v3-turbo-FLM` has been run.",
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

  // Crash-recovered jobs re-run from the top; don't redo a conversion that
  // already landed (the row can bounce pending↔running across OOM boots even
  // after the EPUB was written). Fresh re-convert flows clear the path first.
  if (book.convertedEpubPath) {
    const { resolveStoragePath } = await import("./storage");
    const { existsSync } = await import("fs");
    if (existsSync(resolveStoragePath(book.convertedEpubPath))) {
      appendJobLog(jobId, "EPUB already converted — skipping");
      return;
    }
  }

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
const CCD_BACKFILL_DELAY_MS = 150;
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
  if (queuePausedUntil) {
    if (Date.now() < queuePausedUntil) return; // user pause — claim nothing
    queuePausedUntil = null;
    console.log("[Queue] pause expired — resuming");
  }
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
      currentJobId = null;
    }
    return; // wait for the next tick before starting another job
  }

  // Find oldest pending job
  const row = db
    .select()
    .from(backgroundJobs)
    .where(eq(backgroundJobs.status, "pending"))
    // Reader-facing work preempts enrichment: a fresh upload's CCD must not
    // sit behind days of queued analysis. Within a tier, FIFO.
    .orderBy(
      sql`CASE ${backgroundJobs.type}
        WHEN 'generate-ccd' THEN 0
        WHEN 'convert' THEN 1
        WHEN 'transcribe' THEN 2
        WHEN 'extract' THEN 3
        ELSE 4 END`,
      asc(backgroundJobs.createdAt),
    )
    .limit(1)
    .get();

  if (!row) return;

  processorRunning = true;
  processorStartedAt = Date.now();
  lastProgressAt = Date.now();
  currentAbortController = new AbortController();
  const jobId = row.id;
  currentJobId = jobId;

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
    // Don't overwrite cancel status (controller may already be cleared by the
    // watchdog that aborted this job — treat that as cancelled too)
    if (!currentAbortController || currentAbortController.signal.aborted) return;

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Queue] Job ${jobId} failed:`, errorMessage);

    updateJobProgress(jobId, {
      status: "error",
      progress: 0,
      message: `Failed: ${errorMessage}`,
      result: { error: errorMessage },
    });
  } finally {
    flushJobLog(jobId);
    currentAbortController = null;
    currentJobId = null;
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

function rawDbPrune(): number {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const res = db
    .delete(backgroundJobs)
    .where(
      sql`${backgroundJobs.status} = 'completed' AND ${backgroundJobs.updatedAt} < ${Math.floor(+cutoff / 1000)}`,
    )
    .run();
  return res.changes;
}

export function startJobProcessor(): void {
  if (processorStarted) {
    console.log("[Queue] Job processor already started, skipping");
    return;
  }
  processorStarted = true;

  // Kill switch for the legacy embedding/GLiNER extraction pipeline while the
  // concept substrate is being parallel-run. A restart resets the in-memory
  // pause, so without this the OOM-prone grind would resume on every boot.
  if (process.env.PAUSE_PROCESSING === "1") {
    console.log("[Queue] PAUSE_PROCESSING=1 — legacy job processor disabled");
    return;
  }

  // Prune completed jobs older than 7 days — they have no value once the
  // book shows its result, and thousands of them turned the admin jobs view
  // into noise (1,759 rows, mostly history).
  try {
    const pruned = rawDbPrune();
    if (pruned > 0) console.log(`[Queue] pruned ${pruned} completed jobs older than 7 days`);
  } catch {
    /* best-effort */
  }

  // Reset stale running jobs (server crashed while processing). ONE strike:
  // a job found "running" at boot took the previous process down with it (OOM,
  // native crash, OOM-kill). Three strikes meant a single poison book (a large
  // book OOMing during embedding was the live case) could reboot the 6GB box
  // FOUR times before parking — minutes of flapping with 100% errors. One retry
  // tolerates the rare clean-restart-caught-mid-job, then parks: anything that
  // crashes the whole container twice is not going to succeed on a third try.
  const MAX_BOOT_RESETS = 1;
  const stale = db.select().from(backgroundJobs).where(eq(backgroundJobs.status, "running")).all();

  // Only reset enqueued job types (not inline jobs like audio merge)
  for (const row of stale) {
    if (
      row.type === "transcribe" ||
      row.type === "convert" ||
      row.type === "extract" ||
      row.type === "generate-ccd"
    ) {
      if (row.attempts >= MAX_BOOT_RESETS) {
        db.update(backgroundJobs)
          .set({
            status: "error",
            message: `Crashed the worker ${row.attempts} times — parked (cancel/re-enqueue to retry)`,
            updatedAt: new Date(),
          })
          .where(eq(backgroundJobs.id, row.id))
          .run();
        console.warn(`[Queue] Job ${row.id} crashed the worker ${row.attempts}x — parked as error`);
        continue;
      }
      db.update(backgroundJobs)
        .set({ status: "pending", attempts: row.attempts + 1, updatedAt: new Date() })
        .where(eq(backgroundJobs.id, row.id))
        .run();
      console.log(
        `[Queue] Reset stale job ${row.id} back to pending (boot reset ${row.attempts + 1}/${MAX_BOOT_RESETS})`,
      );
    }
  }

  // Boot grace before pulling heavy jobs. Right after a restart the container is
  // already near its memory ceiling: the boot build, MiniLM + GLiNER model loads,
  // and the substrate warm-up all peak together. On the old 6GB box a large-book
  // extract landing on top of that tipped it into an OOM crash-loop; the Beelink
  // has real headroom, so a short settle window is enough.
  const BOOT_GRACE_MS = 15_000;
  setTimeout(() => {
    setInterval(() => {
      processNextJob().catch((err) => {
        console.error("[Queue] Processor error:", err);
        processorRunning = false;
      });
    }, 2000);
    console.log("[Queue] polling started (boot grace elapsed)");
  }, BOOT_GRACE_MS);

  console.log(`[Queue] Job processor started (polling in ${BOOT_GRACE_MS / 1000}s)`);
}
