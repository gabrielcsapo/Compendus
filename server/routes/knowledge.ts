import { randomUUID } from "crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, rawDb, books, bookAnalysis, wanderSessions } from "../../app/lib/db";
import { enqueueJob, getJob } from "../../app/lib/queue";
import { listEntities, getEntityDetail } from "../../app/lib/knowledge/graph";
import {
  rebuildCanonicalMapping,
  listCandidateLinks,
  setCandidateStatus,
  undoCandidateReview,
} from "../../app/lib/knowledge/resolution";
import { requireAdmin } from "../middleware/profile";

const app = new Hono();

// Analysis mutates the shared library graph — admin only (like transcription).
app.use("/api/books/:id/analyze", requireAdmin);
app.use("/api/graph/consolidate", requireAdmin);
app.use("/api/graph/candidates", requireAdmin);
app.use("/api/graph/candidates/:id/:verdict", requireAdmin);

/**
 * POST /api/graph/consolidate
 * Rebuild the canonical identity mapping (merge variants, flag noise) from the
 * immutable extraction layer. Non-destructive and idempotent — only rewrites the
 * derived mapping; re-runnable after tuning. Returns the rebuild counts.
 */
app.post("/api/graph/consolidate", (c) => {
  const result = rebuildCanonicalMapping();
  return c.json({ success: true, result });
});

/**
 * GET /api/graph/candidates?status=open — probable-duplicate links for human
 * review. Heuristics propose; a person confirms/rejects (identity is never
 * asserted automatically).
 */
app.get("/api/graph/candidates", (c) => {
  const status = c.req.query("status") || "open";
  const limit = parseInt(c.req.query("limit") || "100", 10);
  return c.json({ success: true, candidates: listCandidateLinks(status, limit) });
});

/**
 * POST /api/graph/candidates/:id/:verdict — record a human verdict on a candidate
 * link. `confirmed` pins the merge; `rejected` suppresses re-proposal; `undo`
 * reverts a prior verdict back to open (and unpins a confirmed merge).
 */
app.post("/api/graph/candidates/:id/:verdict", (c) => {
  const verdict = c.req.param("verdict");
  const id = c.req.param("id");
  if (verdict === "undo") {
    const ok = undoCandidateReview(id);
    if (!ok) return c.json({ success: false, error: "Candidate link not found" }, 404);
    return c.json({ success: true });
  }
  if (verdict !== "confirmed" && verdict !== "rejected") {
    return c.json(
      { success: false, error: "verdict must be 'confirmed', 'rejected', or 'undo'" },
      400,
    );
  }
  const ok = setCandidateStatus(id, verdict);
  if (!ok) return c.json({ success: false, error: "Candidate link not found" }, 404);
  return c.json({ success: true });
});

/**
 * POST /api/books/:id/analyze
 * Enqueue Living Library analysis (extract entities + relationships) as a job.
 * Returns immediately with a jobId; progress streams over /api/jobs/:id/progress.
 */
app.post("/api/books/:id/analyze", async (c) => {
  const bookId = c.req.param("id");
  const book = await db.query.books.findFirst({ where: eq(books.id, bookId) });
  if (!book) return c.json({ success: false, error: "Book not found" }, 404);

  const jobId = `extract-${bookId}`;
  const existing = getJob(jobId);
  if (existing && (existing.status === "pending" || existing.status === "running")) {
    return c.json({ success: true, jobId, pending: true });
  }

  enqueueJob(jobId, "extract", { bookId });
  return c.json({ success: true, jobId, pending: true });
});

/**
 * GET /api/books/:id/analysis
 * Current analysis status + counts for a book.
 */
app.get("/api/books/:id/analysis", async (c) => {
  const bookId = c.req.param("id");
  const row = db.select().from(bookAnalysis).where(eq(bookAnalysis.bookId, bookId)).get();
  return c.json({ success: true, analysis: row ?? null });
});

/**
 * GET /api/graph/analysis/summary — corpus-wide analysis progress (drives the
 * bulk-analyze monitor): counts by status + completed book ids.
 */
app.get("/api/graph/analysis/summary", (c) => {
  const byStatus = Object.fromEntries(
    (
      rawDb.prepare("SELECT status, COUNT(*) AS n FROM book_analysis GROUP BY status").all() as {
        status: string;
        n: number;
      }[]
    ).map((r) => [r.status, r.n]),
  );
  const completedIds = (
    rawDb.prepare("SELECT book_id AS id FROM book_analysis WHERE status = 'completed'").all() as {
      id: string;
    }[]
  ).map((r) => r.id);
  const passages = (rawDb.prepare("SELECT COUNT(*) AS n FROM passages").get() as { n: number }).n;
  return c.json({ success: true, byStatus, completedIds, passages });
});

// --- knowledge graph (read) ----------------------------------------------------

/** GET /api/graph/entities?type=&q=&limit=&offset= — entity browser, ranked by reach. */
app.get("/api/graph/entities", (c) => {
  const type = c.req.query("type") || undefined;
  const q = c.req.query("q") || undefined;
  const limit = parseInt(c.req.query("limit") || "50", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  return c.json({ success: true, entities: listEntities({ type, q, limit, offset }) });
});

/** GET /api/graph/entities/:id — entity detail: cross-book mentions + relationships. */
app.get("/api/graph/entities/:id", (c) => {
  const detail = getEntityDetail(c.req.param("id"));
  if (!detail) return c.json({ success: false, error: "Entity not found" }, 404);
  return c.json({ success: true, entity: detail });
});

/**
 * POST /api/wander/sessions — log a completed wander session for activity tracking,
 * mirroring reading sessions. Body: { startedAt (epoch ms), ideasVisited }.
 * Called on exit from the wander surface (web via sendBeacon, iOS via onDisappear).
 */
app.post("/api/wander/sessions", async (c) => {
  const profileId = c.get("profileId");
  if (!profileId) return c.json({ success: false, error: "Profile required" }, 401);

  const body = await c.req.json().catch(() => null);
  const now = Date.now();
  const startedMs = Number(body?.startedAt);
  // Reject nonsense timestamps (future, or >24h ago); fall back to a 0-length session.
  const startedAt =
    Number.isFinite(startedMs) && startedMs <= now && now - startedMs <= 86_400_000
      ? new Date(startedMs)
      : new Date(now);
  const ideasVisited = Math.max(1, Math.min(10_000, Math.floor(Number(body?.ideasVisited) || 1)));
  // Wander v2 interaction log: the visited path and which step kinds were
  // clicked — the data that lets step ranking be tuned from real behavior.
  const path = Array.isArray(body?.path)
    ? body.path.filter((x: unknown) => typeof x === "string").slice(0, 500)
    : null;
  const stepsTaken = Array.isArray(body?.stepsTaken)
    ? body.stepsTaken.filter((x: unknown) => typeof x === "string").slice(0, 500)
    : null;

  db.insert(wanderSessions)
    .values({
      id: randomUUID(),
      profileId,
      startedAt,
      endedAt: new Date(now),
      ideasVisited,
      pathJson: path ? JSON.stringify(path) : null,
      stepsTakenJson: stepsTaken ? JSON.stringify(stepsTaken) : null,
    })
    .run();

  return c.json({ success: true });
});

export { app as knowledgeRoutes };
