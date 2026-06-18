import { Hono } from "hono";
import { resolve } from "path";
import { BOOKS_DIR } from "../../app/lib/storage";
import { streamFileResponse } from "../lib/file-serving";
import { db, rawDb, bookSubjects, backgroundJobs } from "../../app/lib/db";
import { eq, sql } from "drizzle-orm";
import { findBestMetadata } from "../../app/lib/metadata";
import {
  enqueueJob,
  getJob,
  cancelJob,
  cancelAllJobs,
  pauseQueue,
  resumeQueue,
  queuePauseState,
} from "../../app/lib/queue";
import { CCD_VERSION } from "../../app/lib/content-ast/types";
import { randomUUID } from "crypto";

const app = new Hono();

// Formats the knowledge pipeline can analyze: EPUB directly, plus the formats
// ensureEpub converts to EPUB on demand. Audiobooks and comics are excluded — they
// can't become text, so we never queue or count them.
const ANALYZABLE_FORMATS = ["epub", "pdf", "mobi", "azw3"];
const ANALYZABLE_SQL = `(${ANALYZABLE_FORMATS.map((f) => `'${f}'`).join(", ")})`;

// GET /api/admin/backfill-graph — how much of the analyzable library has a Living
// Library graph, and how much is still pending. Drives the backfill decision.
app.get("/api/admin/backfill-graph", (c) => {
  const total = (
    rawDb.prepare(`SELECT COUNT(*) AS n FROM books WHERE format IN ${ANALYZABLE_SQL}`).get() as {
      n: number;
    }
  ).n;
  const byStatus = rawDb
    .prepare("SELECT status, COUNT(*) AS n FROM book_analysis GROUP BY status")
    .all() as Array<{ status: string; n: number }>;
  const counts = Object.fromEntries(byStatus.map((r) => [r.status, r.n]));
  const completed = counts.completed ?? 0;
  const queued = (
    rawDb
      .prepare(
        "SELECT COUNT(*) AS n FROM background_jobs WHERE type = 'extract' AND status = 'pending'",
      )
      .get() as { n: number }
  ).n;
  return c.json({
    success: true,
    total,
    completed,
    remaining: Math.max(0, total - completed),
    byStatus: counts,
    queuedExtractJobs: queued,
  });
});

// POST /api/admin/backfill-graph — enqueue Living Library extraction for every
// book that hasn't been analyzed yet. The job processor drains these strictly
// one at a time, which is exactly the pacing the shared host needs (the reason
// we use the GLiNER encoder rather than a local LLM). Idempotent: books already
// completed, or with an extract job already pending/running, are skipped.
// `?force=true` re-queues the entire library (e.g. after a pipeline change).
app.post("/api/admin/backfill-graph", (c) => {
  const force = c.req.query("force") === "true";
  const rows = (
    force
      ? rawDb
          .prepare(`SELECT id FROM books WHERE format IN ${ANALYZABLE_SQL} ORDER BY created_at ASC`)
          .all()
      : rawDb
          .prepare(
            `SELECT b.id FROM books b
             LEFT JOIN book_analysis a ON a.book_id = b.id
             WHERE b.format IN ${ANALYZABLE_SQL}
               AND (a.status IS NULL OR a.status NOT IN ('completed', 'running', 'pending'))
             ORDER BY b.created_at ASC`,
          )
          .all()
  ) as Array<{ id: string }>;

  let enqueued = 0;
  let skipped = 0;
  for (const { id } of rows) {
    const jobId = `extract-${id}`;
    const existing = getJob(jobId);
    if (existing && (existing.status === "pending" || existing.status === "running")) {
      skipped++;
      continue;
    }
    enqueueJob(jobId, "extract", { bookId: id });
    enqueued++;
  }

  return c.json({
    success: true,
    enqueued,
    skipped,
    message: `Queued ${enqueued} book${enqueued === 1 ? "" : "s"} for Living Library analysis${
      skipped ? ` (${skipped} already in flight)` : ""
    }. They process one at a time; watch /api/admin/backfill-graph for progress.`,
  });
});

// POST /api/admin/enrich-subjects - Batch enrich books with subjects from external metadata
app.post("/api/admin/enrich-subjects", async (c) => {
  // Find books that have an ISBN but no subjects yet
  const booksNeedingSubjects = rawDb
    .prepare(
      `
    SELECT b.id, b.title, b.authors, b.isbn, b.isbn13, b.isbn10
    FROM books b
    WHERE (b.isbn IS NOT NULL OR b.isbn13 IS NOT NULL OR b.isbn10 IS NOT NULL)
      AND b.id NOT IN (SELECT DISTINCT book_id FROM book_subjects)
  `,
    )
    .all() as Array<{
    id: string;
    title: string;
    authors: string | null;
    isbn: string | null;
    isbn13: string | null;
    isbn10: string | null;
  }>;

  if (booksNeedingSubjects.length === 0) {
    return c.json({ message: "All books with ISBNs already have subjects", count: 0 });
  }

  // Create a background job to track progress
  const jobId = randomUUID();
  await db.insert(backgroundJobs).values({
    id: jobId,
    type: "enrich-subjects",
    status: "running",
    progress: 0,
    message: `Enriching subjects for ${booksNeedingSubjects.length} books...`,
  });

  // Run enrichment in the background
  (async () => {
    let enriched = 0;
    let failed = 0;

    for (let i = 0; i < booksNeedingSubjects.length; i++) {
      const book = booksNeedingSubjects[i];
      try {
        const metadata = await findBestMetadata({
          title: book.title,
          authors: book.authors ? JSON.parse(book.authors) : [],
          isbn: book.isbn13 || book.isbn10 || book.isbn,
        });

        if (metadata && metadata.subjects.length > 0) {
          const subjects = metadata.subjects
            .map((s) => s.toLowerCase().trim())
            .filter((s) => s.length > 0 && s.length < 100)
            .slice(0, 20);

          if (subjects.length > 0) {
            await db.insert(bookSubjects).values(
              subjects.map((subject) => ({
                id: randomUUID(),
                bookId: book.id,
                subject,
              })),
            );
            enriched++;
          }
        }
      } catch {
        failed++;
      }

      // Update progress
      const progress = Math.round(((i + 1) / booksNeedingSubjects.length) * 100);
      await db
        .update(backgroundJobs)
        .set({
          progress,
          message: `Processed ${i + 1}/${booksNeedingSubjects.length} (${enriched} enriched, ${failed} failed)`,
          updatedAt: sql`(unixepoch())`,
        })
        .where(eq(backgroundJobs.id, jobId));

      // Throttle to avoid API rate limits (1 request per second)
      if (i < booksNeedingSubjects.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    await db
      .update(backgroundJobs)
      .set({
        status: "completed",
        progress: 100,
        message: `Done: ${enriched} books enriched, ${failed} failed out of ${booksNeedingSubjects.length}`,
        result: JSON.stringify({ enriched, failed, total: booksNeedingSubjects.length }),
        updatedAt: sql`(unixepoch())`,
      })
      .where(eq(backgroundJobs.id, jobId));
  })();

  return c.json({
    jobId,
    message: `Started enriching ${booksNeedingSubjects.length} books`,
    count: booksNeedingSubjects.length,
  });
});

// GET /api/admin/preview/:filename - Preview an orphaned file from the books directory
app.get("/api/admin/preview/:filename", async (c) => {
  const filename = c.req.param("filename");

  // Security: only allow simple filenames (no path traversal)
  if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    return c.json({ error: "Invalid filename" }, 400);
  }

  const filePath = resolve(BOOKS_DIR, filename);

  // Double-check the resolved path is still within BOOKS_DIR
  if (!filePath.startsWith(BOOKS_DIR)) {
    return c.json({ error: "Invalid filename" }, 400);
  }

  return streamFileResponse(c, filePath, {
    cacheControl: "no-cache",
  });
});

// ── CCD backfill ──
// GET /api/admin/ccd-status — how much of the library has a current-version CCD bundle.
app.get("/api/admin/ccd-status", (c) => {
  const total = (
    rawDb.prepare(`SELECT COUNT(*) AS n FROM books WHERE format IN ${ANALYZABLE_SQL}`).get() as {
      n: number;
    }
  ).n;
  const current = (
    rawDb
      .prepare(
        `SELECT COUNT(*) AS n FROM books WHERE format IN ${ANALYZABLE_SQL} AND ccd_version = ?`,
      )
      .get(CCD_VERSION) as { n: number }
  ).n;
  // Expose the backfill job's recent log lines (per-book failures are logged
  // here as `<bookId> (<format>): <error>`) so failed conversions are diagnosable.
  const logRow = rawDb
    .prepare(`SELECT logs FROM background_jobs WHERE id = 'ccd-backfill'`)
    .get() as { logs?: string } | undefined;
  const logs = logRow?.logs ? logRow.logs.split("\n").slice(-50) : [];
  return c.json({
    success: true,
    total,
    current,
    pending: total - current,
    version: CCD_VERSION,
    job: getJob("ccd-backfill") ?? null,
    logs,
  });
});

// POST /api/admin/backfill-ccd — enqueue a library-wide CCD backfill (idempotent).
app.post("/api/admin/backfill-ccd", (c) => {
  const jobId = "ccd-backfill";
  const existing = getJob(jobId);
  if (existing && existing.status === "running")
    return c.json({ success: true, jobId, alreadyRunning: true });
  enqueueJob(jobId, "ccd-backfill", {});
  return c.json({ success: true, jobId });
});

// POST /api/admin/backfill-ccd/cancel — stop a running/pending CCD backfill.
app.post("/api/admin/backfill-ccd/cancel", (c) => {
  return c.json(cancelJob("ccd-backfill"));
});

// POST /api/admin/jobs/cancel-all — abort the running job AND delete every queued
// job row (so nothing resumes on the next boot). The escape hatch for a runaway
// extract/backfill that's pegging the host.
app.post("/api/admin/jobs/cancel-all", (c) => {
  return c.json(cancelAllJobs());
});

// POST /api/admin/jobs/:id/cancel — surgically park ONE job (pending → deleted,
// running → aborted + error). The scalpel next to cancel-all's hammer: a single
// poison job (e.g. a convert that OOMs the container and resurrects at every
// boot) can be removed without dropping the rest of the queue.
app.post("/api/admin/jobs/:id/cancel", (c) => {
  return c.json(cancelJob(c.req.param("id")));
});

// POST /api/admin/jobs/pause {minutes?} — reclaim the box: stop claiming queue
// jobs and abort+requeue the current one. Auto-resumes (default 60min, max 24h)
// so a forgotten pause can't freeze the grind forever.
app.post("/api/admin/jobs/pause", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const minutes = typeof body?.minutes === "number" ? body.minutes : 60;
  return c.json({ success: true, ...pauseQueue(minutes) });
});

// POST /api/admin/jobs/resume — end a pause early.
app.post("/api/admin/jobs/resume", (c) => {
  return c.json({ success: true, ...resumeQueue() });
});

// GET /api/admin/jobs/pause — current pause state.
app.get("/api/admin/jobs/pause", (c) => {
  return c.json({ success: true, ...queuePauseState() });
});

// --- admin workspace REST (the new sidebar/Overview/jobs UI) ----------------------
// Server-action calls hang client-side under react-flight-router (the action
// executes, the response stream never completes — affects the fleet page's
// polling too); these endpoints keep the admin UI on plain fetch() until the
// framework bug is fixed.

app.get("/api/admin/workspace/summary", async (c) => {
  const { adminJobsSummary } = await import("../../app/lib/admin-workspace");
  return c.json(await adminJobsSummary());
});

app.get("/api/admin/workspace/counts", async (c) => {
  const { adminSidebarCounts } = await import("../../app/lib/admin-workspace");
  return c.json(await adminSidebarCounts());
});

app.get("/api/admin/workspace/jobs", async (c) => {
  const { adminJobsList } = await import("../../app/lib/admin-workspace");
  const view = (c.req.query("view") ?? "active") as "attention" | "active" | "history";
  const page = parseInt(c.req.query("page") ?? "1", 10);
  const pageSize = Math.min(100, parseInt(c.req.query("pageSize") ?? "25", 10));
  const q = c.req.query("q") ?? "";
  return c.json(await adminJobsList({ view, page, pageSize, q }));
});

app.get("/api/admin/workspace/job-logs/:id", async (c) => {
  const { adminGetJobLogs } = await import("../../app/lib/admin-workspace");
  return c.json({ logs: await adminGetJobLogs(c.req.param("id")) });
});

app.post("/api/admin/workspace/jobs/:id/retry", async (c) => {
  const { adminRetryJob } = await import("../../app/lib/admin-workspace");
  return c.json(await adminRetryJob(c.req.param("id")));
});

app.post("/api/admin/workspace/jobs/retry-all-errors", async (c) => {
  const { adminRetryAllErrors } = await import("../../app/lib/admin-workspace");
  return c.json(await adminRetryAllErrors());
});

app.post("/api/admin/workspace/jobs/clear-completed", async (c) => {
  const { adminClearCompleted } = await import("../../app/lib/admin-workspace");
  return c.json(await adminClearCompleted());
});

export const adminRoutes = app;
