/**
 * Admin workspace data layer — mission-control summary, sidebar counts, and
 * jobs-page operations. Pure functions, NO auth: callers gate access (the
 * /api/admin/* routes via requireAdmin middleware; the server actions via
 * assertAdmin). Lives outside "use server" so plain Hono routes can call it —
 * server-action responses currently hang client-side (react-flight-router
 * stream bug), so the admin UI polls REST instead.
 */
import { eq, sql } from "drizzle-orm";
import { db, rawDb, backgroundJobs } from "./db";
import { pauseQueue, resumeQueue, queuePauseState, enqueueJob, cancelJob, getJob } from "./queue";

export interface JobsSummary {
  paused: boolean;
  pausedUntil: number | null;
  running: {
    id: string;
    type: string;
    progress: number;
    message: string;
    updatedAt: number;
  } | null;
  /** queued/leased work per background-job type. */
  pendingByType: Record<string, number>;
  pendingTotal: number;
  errorCount: number;
  completed24h: number;
  /** Completions per hour, oldest→newest, 24 buckets. */
  hourly: number[];
  /** Jobs/hour over the last 6h (the ETA denominator). */
  throughputPerHour: number;
  /** Hours to drain the pending queue at current throughput (null = unknown). */
  etaHours: number | null;
}

export async function adminJobsSummary(): Promise<JobsSummary> {
  const pause = queuePauseState();

  const running = rawDb
    .prepare(
      "SELECT id, type, progress, message, updated_at AS u FROM background_jobs WHERE status = 'running' ORDER BY updated_at DESC LIMIT 1",
    )
    .get() as
    | { id: string; type: string; progress: number | null; message: string | null; u: number }
    | undefined;

  const pendingByType: Record<string, number> = {};
  let pendingTotal = 0;
  for (const r of rawDb
    .prepare(
      "SELECT type, COUNT(*) AS n FROM background_jobs WHERE status = 'pending' GROUP BY type",
    )
    .all() as Array<{ type: string; n: number }>) {
    pendingByType[r.type] = r.n;
    pendingTotal += r.n;
  }

  const errorCount = (
    rawDb.prepare("SELECT COUNT(*) AS n FROM background_jobs WHERE status = 'error'").get() as {
      n: number;
    }
  ).n;

  const nowSec = Math.floor(Date.now() / 1000);
  const hourly = new Array<number>(24).fill(0);
  for (const r of rawDb
    .prepare(
      `SELECT CAST((? - updated_at) / 3600 AS INTEGER) AS age, COUNT(*) AS n
       FROM background_jobs WHERE status = 'completed' AND updated_at > ? GROUP BY age`,
    )
    .all(nowSec, nowSec - 24 * 3600) as Array<{ age: number; n: number }>) {
    if (r.age >= 0 && r.age < 24) hourly[23 - r.age] = r.n;
  }
  const completed24h = hourly.reduce((s, n) => s + n, 0);
  const last6h = hourly.slice(-6).reduce((s, n) => s + n, 0);
  const throughputPerHour = last6h / 6;
  const etaHours =
    pendingTotal > 0 && throughputPerHour > 0.2 ? pendingTotal / throughputPerHour : null;

  return {
    paused: pause.paused,
    pausedUntil: pause.until,
    running: running
      ? {
          id: running.id,
          type: running.type,
          progress: running.progress ?? 0,
          message: running.message ?? "",
          updatedAt: running.u * 1000,
        }
      : null,
    pendingByType,
    pendingTotal,
    errorCount,
    completed24h,
    hourly,
    throughputPerHour,
    etaHours,
  };
}

export interface SidebarCounts {
  unmatched: number;
  duplicates: number;
  jobErrors: number;
  orphanedFiles: number;
}

export async function adminSidebarCounts(): Promise<SidebarCounts> {
  // Same predicate as getUnmatchedBooksCount (books.ts) — no cover OR no ISBN,
  // and not explicitly skipped.
  const unmatched = (
    rawDb
      .prepare(
        `SELECT COUNT(*) AS n FROM books
         WHERE (cover_path IS NULL OR (isbn IS NULL AND isbn13 IS NULL AND isbn10 IS NULL))
           AND COALESCE(match_skipped, 0) = 0`,
      )
      .get() as { n: number }
  ).n;
  // Duplicate clusters by (title, authors) — the duplicates page's own grouping.
  const duplicates = (
    rawDb
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT 1 FROM books GROUP BY LOWER(title), COALESCE(authors, '') HAVING COUNT(*) > 1
         )`,
      )
      .get() as { n: number }
  ).n;
  const jobErrors = (
    rawDb.prepare("SELECT COUNT(*) AS n FROM background_jobs WHERE status = 'error'").get() as {
      n: number;
    }
  ).n;
  return { unmatched, duplicates, jobErrors, orphanedFiles: 0 };
}

export async function adminPauseQueue(minutes: number) {
  return pauseQueue(minutes);
}

export async function adminResumeQueue() {
  return resumeQueue();
}

/** Re-enqueue an errored/completed job with its original payload. */
export async function adminRetryJob(jobId: string): Promise<{ success: boolean; message: string }> {
  const row = db.select().from(backgroundJobs).where(eq(backgroundJobs.id, jobId)).get();
  if (!row) return { success: false, message: "Job not found" };
  if (row.status === "running" || row.status === "pending") {
    return { success: false, message: "Job is already queued" };
  }
  enqueueJob(row.id, row.type, row.payload ? JSON.parse(row.payload) : {});
  return { success: true, message: "Re-enqueued" };
}

export async function adminDismissJob(jobId: string) {
  return cancelJob(jobId);
}

export async function adminRetryAllErrors(): Promise<{ retried: number }> {
  const rows = db.select().from(backgroundJobs).where(eq(backgroundJobs.status, "error")).all();
  for (const row of rows) {
    enqueueJob(row.id, row.type, row.payload ? JSON.parse(row.payload) : {});
  }
  return { retried: rows.length };
}

export async function adminClearCompleted(): Promise<{ cleared: number }> {
  const res = rawDb.prepare("DELETE FROM background_jobs WHERE status = 'completed'").run();
  return { cleared: res.changes };
}

export async function adminGetJobLogs(jobId: string): Promise<string> {
  const job = getJob(jobId);
  if (!job) return "";
  const row = db
    .select({ logs: backgroundJobs.logs })
    .from(backgroundJobs)
    .where(eq(backgroundJobs.id, jobId))
    .get();
  return row?.logs ?? "";
}

export interface AdminJobRow {
  id: string;
  type: string;
  status: string;
  progress: number;
  message: string;
  updatedAt: number;
}

/** Filtered jobs list for the redesigned jobs page (SQL-side everything). */
export async function adminJobsList(opts: {
  view: "attention" | "active" | "history";
  page: number;
  pageSize: number;
  q?: string;
}): Promise<{ items: AdminJobRow[]; total: number }> {
  const { view, page, pageSize } = opts;
  const search = (opts.q ?? "").trim().toLowerCase();

  const statusCond =
    view === "attention"
      ? sql`${backgroundJobs.status} = 'error'`
      : view === "active"
        ? sql`${backgroundJobs.status} IN ('running', 'pending')`
        : sql`${backgroundJobs.status} = 'completed' AND ${backgroundJobs.updatedAt} > ${Math.floor(Date.now() / 1000) - 24 * 3600}`;

  const where = search
    ? sql`(${statusCond}) AND LOWER(${backgroundJobs.id} || ' ' || ${backgroundJobs.type} || ' ' || COALESCE(${backgroundJobs.message}, '')) LIKE ${`%${search}%`}`
    : statusCond;

  const total =
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(backgroundJobs)
      .where(where)
      .get()?.n ?? 0;

  const items = db
    .select({
      id: backgroundJobs.id,
      type: backgroundJobs.type,
      status: backgroundJobs.status,
      progress: backgroundJobs.progress,
      message: backgroundJobs.message,
      updatedAt: backgroundJobs.updatedAt,
    })
    .from(backgroundJobs)
    .where(where)
    .orderBy(
      // Running first within Active; otherwise newest first.
      sql`CASE ${backgroundJobs.status} WHEN 'running' THEN 0 ELSE 1 END`,
      sql`${backgroundJobs.updatedAt} DESC`,
    )
    .limit(pageSize)
    .offset(Math.max(0, (page - 1) * pageSize))
    .all()
    .map((j) => ({
      id: j.id,
      type: j.type,
      status: j.status,
      progress: j.progress ?? 0,
      message: j.message ?? "",
      updatedAt: j.updatedAt ? j.updatedAt.getTime() : 0,
    }));

  return { items, total };
}
