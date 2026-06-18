/**
 * Concept-substrate admin + query routes. Runs ALONGSIDE the old substrate so
 * the two can be compared before any cutover. The backfill yields to the event
 * loop between books so a full-library ingest never blocks the HTTP server.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { rawDb } from "../../app/lib/db";
import { ingestAllBooks, conceptIngestStats } from "../../app/lib/concept/ingest";
import { rebuildTopics } from "../../app/lib/concept/graph";
import {
  conceptStop,
  conceptStartRandom,
  conceptTopics,
  refreshJourneyReadModel,
  enqueueTopicNaming,
} from "../../app/lib/concept/wander";
import "../../app/lib/fabric/kinds"; // side-effect: register name-topic kind

const app = new Hono();

/* eslint-disable @typescript-eslint/no-explicit-any */
let state: {
  running: boolean;
  phase: string;
  books: number;
  totalBooks: number;
  passages: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
} = {
  running: false,
  phase: "idle",
  books: 0,
  totalBooks: 0,
  passages: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
};

/**
 * Run a concept job on a worker thread so synchronous better-sqlite3 work never
 * blocks the HTTP server. Falls back to inline (dev/tests where the bundle is
 * absent) — still correct, just blocking.
 */
async function runConceptWorker(
  cmd: "backfill" | "topics",
  onProgress: (m: any) => void,
): Promise<any> {
  const workerPath = join(process.cwd(), "dist/worker/concept-ingest-worker.mjs");
  if (!existsSync(workerPath)) {
    return cmd === "backfill"
      ? ingestAllBooks((p) => onProgress(p))
      : rebuildTopics((line) => onProgress({ line }));
  }
  const { Worker } = await import("node:worker_threads");
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { resourceLimits: { maxOldGenerationSizeMb: 1024 } });
    worker.on("message", (m: any) => {
      if (m?.type === "progress") onProgress(m);
      else if (m?.type === "done") {
        worker.terminate();
        resolve(m);
      } else if (m?.type === "error") {
        worker.terminate();
        reject(new Error(m.error));
      }
    });
    worker.on("error", reject);
    worker.postMessage({ cmd });
  });
}

app.post("/api/admin/concept/backfill", (c) => {
  if (state.running) return c.json({ started: false, reason: "already running", state });
  const remaining = (
    rawDb
      .prepare("SELECT COUNT(*) AS n FROM books WHERE id NOT IN (SELECT book_id FROM cs_ingested)")
      .get() as { n: number }
  ).n;
  state = {
    running: true,
    phase: "ingest",
    books: 0,
    totalBooks: remaining,
    passages: 0,
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
  };
  void runConceptWorker("backfill", (m) => {
    if (typeof m.books === "number") {
      state.books = m.books;
      state.passages = m.passages;
      if (typeof m.total === "number") state.totalBooks = m.total;
    }
  })
    .then(() => {
      state.phase = "done";
      state.finishedAt = Date.now();
    })
    .catch((e) => {
      state.error = e instanceof Error ? e.message : String(e);
      state.phase = "error";
    })
    .finally(() => {
      state.running = false;
    });
  return c.json({ started: true, totalBooks: remaining });
});

app.post("/api/admin/concept/rebuild-topics", (c) => {
  if (state.running) return c.json({ started: false, reason: "already running", state });
  state = {
    running: true,
    phase: "topics",
    books: 0,
    totalBooks: 0,
    passages: 0,
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
  };
  void runConceptWorker("topics", () => {})
    .then(() => {
      state.phase = "done";
      state.finishedAt = Date.now();
    })
    .catch((e) => {
      state.error = e instanceof Error ? e.message : String(e);
      state.phase = "error";
    })
    .finally(() => {
      state.running = false;
    });
  return c.json({ started: true });
});

// Refresh the journeys read-model (nonfiction gate + distinctive labels) without
// a graph rebuild. Detached — chunked + yields keep the box responsive.
let journeyRefresh: { running: boolean; result: unknown; error: string | null } = {
  running: false,
  result: null,
  error: null,
};
app.post("/api/admin/concept/journeys/refresh", (c) => {
  if (journeyRefresh.running) return c.json({ started: false, reason: "already running" });
  journeyRefresh = { running: true, result: null, error: null };
  void refreshJourneyReadModel()
    .then((r) => {
      journeyRefresh.result = r;
    })
    .catch((e) => {
      journeyRefresh.error = e instanceof Error ? e.message : String(e);
    })
    .finally(() => {
      journeyRefresh.running = false;
    });
  return c.json({ started: true });
});
app.get("/api/admin/concept/journeys/refresh/status", (c) => c.json(journeyRefresh));

// Enqueue fleet `name-topic` jobs to give journeys human shelf-card names.
let journeyNaming: { running: boolean; result: unknown; error: string | null } = {
  running: false,
  result: null,
  error: null,
};
app.post("/api/admin/concept/journeys/name", async (c) => {
  if (journeyNaming.running) return c.json({ started: false, reason: "already running" });
  let body: { limit?: number } = {};
  try {
    body = await c.req.json();
  } catch {
    /* empty body fine */
  }
  const limit = typeof body.limit === "number" && body.limit > 0 ? body.limit : 600;
  journeyNaming = { running: true, result: null, error: null };
  void enqueueTopicNaming({ limit })
    .then((r) => {
      journeyNaming.result = r;
    })
    .catch((e) => {
      journeyNaming.error = e instanceof Error ? e.message : String(e);
    })
    .finally(() => {
      journeyNaming.running = false;
    });
  return c.json({ started: true });
});
app.get("/api/admin/concept/journeys/name/status", (c) => c.json(journeyNaming));

app.get("/api/admin/concept/stats", (c) =>
  c.json({
    state,
    stats: conceptIngestStats(),
    topicCount: (rawDb.prepare("SELECT COUNT(*) AS n FROM cs_topics").get() as { n: number }).n,
  }),
);

app.get("/api/admin/concept/topics", (c) => c.json({ topics: conceptTopics(60) }));

app.get("/api/admin/concept/sample", (c) => {
  const pid = conceptStartRandom();
  return c.json({ stop: pid ? conceptStop(pid) : null });
});

export const conceptRoutes = app;
