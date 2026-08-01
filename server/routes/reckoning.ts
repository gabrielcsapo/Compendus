/**
 * Reckoning (prove-or-kill) admin routes. Drives the candidate-tension prototype:
 * mine cross-book passage pairs, judge them with the server's local LLM, and
 * review the judged verdicts for human eval. Mounted behind /api/admin/* like
 * concept.ts, so the existing admin gate is the only auth. LLM batch passes run
 * detached on the serial LLM lane — poll the /status endpoints.
 */
import { Hono } from "hono";
import { rawDb } from "../../app/lib/db";
import { startPass, passStatus } from "../../app/lib/llm/lane";

const app = new Hono();

/** Parse the stored JSON `shared` column into a string[] (best-effort). */
function parseShared(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

// 1. Mine candidate tension pairs (mine.ts authored separately — lazy import).
// Mining is synchronous SQLite that takes a minute+; running it inline holds the
// single web thread past the proxy timeout and wedges the box. So /mine kicks the
// work off DETACHED and returns immediately; poll /mine/status (or watch the
// candidate count via /stats) for completion. mineCandidateTensions yields to the
// event loop periodically so health checks still pass while it runs.
let mineState: {
  running: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  result: unknown;
  error: string | null;
} = { running: false, startedAt: null, finishedAt: null, result: null, error: null };

app.post("/api/admin/reckoning/mine", async (c) => {
  let body: { limit?: number; reset?: boolean } = {};
  try {
    body = await c.req.json();
  } catch {
    /* empty body is fine */
  }
  const limit = typeof body.limit === "number" && body.limit > 0 ? body.limit : 200;

  if (mineState.running) {
    return c.json({ ok: false, error: "a mine is already running", status: mineState }, 409);
  }

  // Optional clean slate: wipe prior candidates (and their judged verdicts) so a
  // re-run with new mining heuristics isn't polluted by stale junk pairs.
  let cleared = 0;
  if (body.reset) {
    cleared = rawDb.prepare("DELETE FROM cs_tension_candidates").run().changes;
  }

  mineState = { running: true, startedAt: Date.now(), finishedAt: null, result: null, error: null };
  // Fire-and-continue: do NOT await — let the request return while the mine runs.
  void (async () => {
    try {
      const { mineCandidateTensions } = await import("../../app/lib/reckoning/mine");
      mineState.result = await mineCandidateTensions({ limit });
    } catch (e) {
      mineState.error = e instanceof Error ? e.message : String(e);
    } finally {
      mineState.running = false;
      mineState.finishedAt = Date.now();
    }
  })();

  return c.json({ ok: true, started: true, cleared });
});

app.get("/api/admin/reckoning/mine/status", (c) => c.json(mineState));

// 1b. Classify every book fiction|nonfiction with the local LLM (mining
// prerequisite — and the nonfiction gate for journeys/wander). A full-library
// run is hours of inference, so it runs DETACHED on the LLM lane — poll
// /classify/enqueue/status (or /classify/stats) for progress. The endpoint
// keeps its historical "enqueue" name for admin muscle memory.
app.post("/api/admin/reckoning/classify/enqueue", async (c) => {
  let body: { limit?: number; reset?: boolean } = {};
  try {
    body = await c.req.json();
  } catch {
    /* empty body is fine */
  }
  const limit = typeof body.limit === "number" && body.limit > 0 ? body.limit : 3000;
  const reset = body.reset === true;

  const started = startPass("classify-books", async (status) => {
    const { runBookClassification } = await import("../../app/lib/reckoning/classify");
    return runBookClassification({ limit, reset }, status);
  });
  if (!started.started) {
    return c.json({ ok: false, error: started.reason, status: passStatus("classify-books") }, 409);
  }
  return c.json({ ok: true, started: true });
});

app.get("/api/admin/reckoning/classify/enqueue/status", (c) =>
  c.json(passStatus("classify-books")),
);

app.get("/api/admin/reckoning/classify/stats", async (c) => {
  const { classifySummary } = await import("../../app/lib/reckoning/classify");
  return c.json(classifySummary());
});

// 2. Judge candidate rows with the local LLM (detached on the LLM lane).
// POST /judge is the canonical route; /enqueue kept as an alias for muscle
// memory from the fleet era.
const startJudging = (limit: number) =>
  startPass("judge-tensions", async (status) => {
    const { runTensionJudging } = await import("../../app/lib/reckoning/judge");
    return runTensionJudging({ limit }, status);
  });

for (const path of ["/api/admin/reckoning/judge", "/api/admin/reckoning/enqueue"]) {
  app.post(path, async (c) => {
    let body: { limit?: number } = {};
    try {
      body = await c.req.json();
    } catch {
      /* empty body is fine */
    }
    const limit = typeof body.limit === "number" && body.limit > 0 ? body.limit : 100;
    const started = startJudging(limit);
    if (!started.started) {
      return c.json(
        { ok: false, error: started.reason, status: passStatus("judge-tensions") },
        409,
      );
    }
    return c.json({ ok: true, started: true });
  });
}

app.get("/api/admin/reckoning/judge/status", (c) => c.json(passStatus("judge-tensions")));

// 2b. Peek raw mined candidates (pre-judging) to eyeball mining quality.
app.get("/api/admin/reckoning/candidates", (c) => {
  const limitParam = Number(c.req.query("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 25;

  const rows = rawDb
    .prepare(
      `SELECT t.id              AS id,
              t.heuristic_score AS score,
              t.shared          AS shared,
              ba.title          AS bookA,
              bb.title          AS bookB,
              pa.text           AS textA,
              pb.text           AS textB
       FROM cs_tension_candidates t
       LEFT JOIN passages pa ON pa.id = t.passage_a
       LEFT JOIN passages pb ON pb.id = t.passage_b
       LEFT JOIN books ba ON ba.id = t.book_a
       LEFT JOIN books bb ON bb.id = t.book_b
       WHERE t.status = 'candidate'
       ORDER BY t.heuristic_score DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string;
    score: number;
    shared: string | null;
    bookA: string | null;
    bookB: string | null;
    textA: string | null;
    textB: string | null;
  }>;

  const snip = (s: string | null) => (s || "").replace(/\s+/g, " ").trim().slice(0, 280);
  const items = rows.map((r) => ({
    id: r.id,
    score: r.score,
    shared: parseShared(r.shared),
    bookA: r.bookA,
    bookB: r.bookB,
    textA: snip(r.textA),
    textB: snip(r.textB),
  }));
  return c.json({ items });
});

// 3. Judged pairs for human review (contradict first, then qualify, then score).
app.get("/api/admin/reckoning/results", (c) => {
  const limitParam = Number(c.req.query("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 40;

  const rows = rawDb
    .prepare(
      `SELECT t.id            AS id,
              t.verdict       AS verdict,
              t.tension       AS tension,
              t.stance_question AS stanceQuestion,
              t.span_a        AS spanA,
              t.span_b        AS spanB,
              ba.title        AS bookA,
              bb.title        AS bookB,
              pa.text         AS textA,
              pb.text         AS textB,
              t.shared        AS shared,
              t.eval_label    AS evalLabel
       FROM cs_tension_candidates t
       LEFT JOIN passages pa ON pa.id = t.passage_a
       LEFT JOIN passages pb ON pb.id = t.passage_b
       LEFT JOIN books ba ON ba.id = t.book_a
       LEFT JOIN books bb ON bb.id = t.book_b
       WHERE t.verdict IS NOT NULL
       ORDER BY
         CASE t.verdict
           WHEN 'contradict' THEN 0
           WHEN 'qualify' THEN 1
           ELSE 2
         END ASC,
         t.heuristic_score DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string;
    verdict: string;
    tension: string | null;
    stanceQuestion: string | null;
    spanA: string | null;
    spanB: string | null;
    bookA: string | null;
    bookB: string | null;
    textA: string | null;
    textB: string | null;
    shared: string | null;
    evalLabel: string | null;
  }>;

  const items = rows.map((r) => ({
    id: r.id,
    verdict: r.verdict,
    tension: r.tension,
    stanceQuestion: r.stanceQuestion,
    spanA: r.spanA,
    spanB: r.spanB,
    bookA: r.bookA,
    bookB: r.bookB,
    textA: r.textA,
    textB: r.textB,
    shared: parseShared(r.shared),
    evalLabel: r.evalLabel,
  }));

  const byStatus: Record<string, number> = {};
  for (const r of rawDb
    .prepare("SELECT status, COUNT(*) AS n FROM cs_tension_candidates GROUP BY status")
    .all() as Array<{ status: string; n: number }>) {
    byStatus[r.status] = r.n;
  }
  const byVerdict: Record<string, number> = {};
  for (const r of rawDb
    .prepare(
      "SELECT verdict, COUNT(*) AS n FROM cs_tension_candidates WHERE verdict IS NOT NULL GROUP BY verdict",
    )
    .all() as Array<{ verdict: string; n: number }>) {
    byVerdict[r.verdict] = r.n;
  }

  return c.json({ items, counts: { byStatus, byVerdict } });
});

// 4. Quick counts.
app.get("/api/admin/reckoning/stats", (c) => {
  const count = (sql: string, ...args: unknown[]) =>
    (rawDb.prepare(sql).get(...args) as { n: number }).n;

  const byVerdict: Record<string, number> = {};
  for (const r of rawDb
    .prepare(
      "SELECT verdict, COUNT(*) AS n FROM cs_tension_candidates WHERE verdict IS NOT NULL GROUP BY verdict",
    )
    .all() as Array<{ verdict: string; n: number }>) {
    byVerdict[r.verdict] = r.n;
  }

  return c.json({
    candidates: count("SELECT COUNT(*) AS n FROM cs_tension_candidates WHERE status = 'candidate'"),
    judged: count("SELECT COUNT(*) AS n FROM cs_tension_candidates WHERE status = 'judged'"),
    byVerdict,
    evalLabeled: count(
      "SELECT COUNT(*) AS n FROM cs_tension_candidates WHERE eval_label IS NOT NULL",
    ),
  });
});

// 5. Human prove-or-kill mark.
const EVAL_LABELS = new Set(["real", "trivial", "false"]);
app.post("/api/admin/reckoning/mark", async (c) => {
  let body: { pairId?: string; label?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* fall through to validation */
  }
  const { pairId, label } = body;
  if (!pairId || !label || !EVAL_LABELS.has(label)) {
    return c.json({ ok: false, error: "pairId and label ∈ {real,trivial,false} required" }, 400);
  }
  rawDb.prepare("UPDATE cs_tension_candidates SET eval_label = ? WHERE id = ?").run(label, pairId);
  return c.json({ ok: true });
});

export const reckoningRoutes = app;
