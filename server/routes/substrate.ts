/**
 * Semantic substrate routes — thin HTTP wrappers (for the iOS app and any
 * non-web client) over the shared atlas/wander2/curriculum libs. The web UI
 * reaches the same functions through server actions (app/actions/substrate.ts);
 * the logic lives in app/lib so there is exactly one implementation.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { Hono } from "hono";
import { rawDb } from "../../app/lib/db";
import {
  getStop,
  startRandom,
  startFromQuery,
  startFromBook,
  cleanPassageText,
} from "../../app/lib/knowledge/wander2";
import { substrateReady, getEmbedding, dequantize } from "../../app/lib/knowledge/substrate";
// Journeys now read the CONCEPT substrate (nonfiction-gated, distinctively/fleet
// labelled) on BOTH web and iOS — the old atlas/curriculum journey path is retired.
import {
  listConceptJourneyTopics,
  buildConceptCurriculum,
  conceptAdjacentTopics,
  conceptSearchJourneys,
} from "../../app/lib/concept/wander";
import { enqueueWork, blobPathFor } from "../../app/lib/fabric";
import "../../app/lib/fabric/kinds";

const resolveDataPath = (rel: string) =>
  resolvePath(process.env.COMPENDUS_DATA_DIR || resolvePath(process.cwd(), "data"), rel);

const app = new Hono();

const requireSubstrate = (c: { json: (o: unknown, s?: number) => Response }) =>
  substrateReady()
    ? null
    : c.json({ success: false, error: "Substrate not built — run analysis first" }, 409);

// --- wander v2 -------------------------------------------------------------------------

/**
 * GET /api/wander2/start?mode=random|query|book&q=&bookId=
 * Seeded entry: aim wander at a question, a book, or serendipity.
 */
app.get("/api/wander2/start", async (c) => {
  const notReady = requireSubstrate(c);
  if (notReady) return notReady;
  const mode = c.req.query("mode") || "random";
  let passageId: string | null = null;
  if (mode === "query" && c.req.query("q")) passageId = await startFromQuery(c.req.query("q")!);
  else if (mode === "book" && c.req.query("bookId"))
    passageId = startFromBook(c.req.query("bookId")!);
  else passageId = startRandom();
  if (!passageId) return c.json({ success: false, error: "No wanderable passages" }, 404);
  const stop = getStop(passageId, { profileId: c.get("profileId") ?? undefined });
  return c.json({ success: true, stop });
});

/** GET /api/wander2/stop/:passageId?visited=id,id — a stop with grounded steps. */
app.get("/api/wander2/stop/:passageId", (c) => {
  const visited = (c.req.query("visited") || "").split(",").filter(Boolean).slice(0, 200);
  const stop = getStop(c.req.param("passageId"), {
    visited,
    profileId: c.get("profileId") ?? undefined,
  });
  if (!stop) return c.json({ success: false, error: "Passage not found" }, 404);
  return c.json({ success: true, stop });
});

// --- topics

// --- topics + realms (atlas) ----------------------------------------------------------

/** GET /api/topics — paged topic list (or ids=csv selection) with coverage. */
app.get("/api/topics", (c) => {
  const ids = (c.req.query("ids") || "").split(",").filter(Boolean);
  const { topics, total } = listConceptJourneyTopics({
    limit: parseInt(c.req.query("limit") || "60", 10),
    offset: parseInt(c.req.query("offset") || "0", 10),
    ids: ids.length ? ids : undefined,
  });
  return c.json({ success: true, topics, total });
});

/** GET /api/realms — the categorical layer (not part of the concept substrate yet). */
app.get("/api/realms", (c) => c.json({ success: true, realms: [] }));

/** GET /api/topics/search?q= — find a road. */
app.get("/api/topics/search", (c) => {
  const q = (c.req.query("q") || "").trim();
  if (!q) return c.json({ success: false, error: "q required" }, 400);
  return c.json({ success: true, topics: conceptSearchJourneys(q) });
});

/** GET /api/topics/:id — core-first passages + books (concept substrate). */
app.get("/api/topics/:id", (c) => {
  const topic = rawDb
    .prepare(
      "SELECT id, COALESCE(fleet_label, display_label) AS label, size, nonfiction_books AS bookCount FROM cs_topics WHERE id = ?",
    )
    .get(c.req.param("id")) as
    | { id: string; label: string | null; size: number; bookCount: number }
    | undefined;
  if (!topic) return c.json({ success: false, error: "Topic not found" }, 404);
  const core = rawDb
    .prepare(
      `SELECT pt.passage_id AS passageId, p.text, p.book_id AS bookId, b.title AS bookTitle
       FROM cs_passage_topics pt
       JOIN passages p ON p.id = pt.passage_id
       JOIN books b ON b.id = p.book_id
       JOIN cs_book_class cc ON cc.book_id = p.book_id AND cc.category = 'nonfiction'
       JOIN cs_passage_salience s ON s.passage_id = pt.passage_id
       WHERE pt.topic_id = ? AND s.prose >= 0.5 ORDER BY s.salience DESC LIMIT 12`,
    )
    .all(topic.id) as { passageId: string; text: string; bookId: string; bookTitle: string }[];
  return c.json({
    success: true,
    topic: {
      ...topic,
      coverage: null,
      core: core.map((p) => ({ ...p, text: cleanPassageText(p.text).slice(0, 300) })),
    },
  });
});

/** GET /api/topics/:id/adjacent — journey forks (concept substrate). */
app.get("/api/topics/:id/adjacent", (c) => {
  return c.json({ success: true, adjacent: conceptAdjacentTopics(c.req.param("id")) });
});

/** GET /api/topics/:id/curriculum — the journey reading path, built on demand. */
app.get("/api/topics/:id/curriculum", (c) => {
  const curriculum = buildConceptCurriculum(c.req.param("id"), c.get("profileId") ?? undefined);
  if (!curriculum) return c.json({ success: false, error: "Topic not found or empty" }, 404);
  return c.json({ success: true, curriculum });
});

// --- frontier --------------------------------------------------------------------------

/**
 * GET /api/frontier — unread books ranked by closeness to the profile's taste
 * vector (centroid of started/finished/rated book centroids). The "books you
 * bought but never opened" surface.
 */
app.get("/api/frontier", (c) => {
  const profileId = c.get("profileId") as string | undefined;
  if (!profileId) return c.json({ success: false, error: "Profile required" }, 401);

  const tasteBooks = rawDb
    .prepare(
      `SELECT book_id AS bookId FROM user_book_state
       WHERE profile_id = ? AND (reading_progress > 0.02 OR is_read = 1 OR rating >= 4)`,
    )
    .all(profileId) as { bookId: string }[];
  const tasteVecs = tasteBooks
    .map((b) => getEmbedding("book", b.bookId))
    .filter((v): v is Float32Array => !!v);
  if (tasteVecs.length === 0) {
    return c.json({ success: true, frontier: [], note: "No reading history yet" });
  }
  const dim = tasteVecs[0].length;
  const taste = new Float32Array(dim);
  for (const v of tasteVecs) for (let d = 0; d < dim; d++) taste[d] += v[d];
  let norm = 0;
  for (let d = 0; d < dim; d++) norm += taste[d] * taste[d];
  norm = Math.sqrt(norm) || 1;
  for (let d = 0; d < dim; d++) taste[d] /= norm;

  const started = new Set(tasteBooks.map((b) => b.bookId));
  const candidates = rawDb
    .prepare(
      `SELECT e.ref_id AS bookId, e.vec, e.scale, b.title FROM embeddings e
       JOIN books b ON b.id = e.ref_id WHERE e.kind = 'book'`,
    )
    .all() as { bookId: string; vec: Buffer; scale: number; title: string }[];
  const frontier = candidates
    .filter((b) => !started.has(b.bookId))
    .map((b) => {
      const v = dequantize(b.vec, b.scale);
      let s = 0;
      for (let d = 0; d < Math.min(dim, v.length); d++) s += taste[d] * v[d];
      return { bookId: b.bookId, title: b.title, score: s };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  return c.json({ success: true, frontier });
});

// --- perspectives -------------------------------------------------------------------------

/**
 * GET /api/graph/entities/:id/perspectives — the two most semantically distant
 * treatments of an entity, ideally from different books ("these two books say
 * very different things about X").
 */
app.get("/api/graph/entities/:id/perspectives", (c) => {
  const entityId = c.req.param("id");
  const mentions = rawDb
    .prepare(
      `SELECT DISTINCT m.passage_id AS pid, p.book_id AS bookId, b.title AS bookTitle, p.text
       FROM canonical_mentions m
       JOIN passages p ON p.id = m.passage_id JOIN books b ON b.id = p.book_id
       WHERE m.entity_id = ? LIMIT 60`,
    )
    .all(entityId) as { pid: string; bookId: string; bookTitle: string; text: string }[];
  if (mentions.length < 2) {
    return c.json({ success: false, error: "Not enough grounded mentions" }, 404);
  }
  const withVecs = mentions
    .map((m) => ({ ...m, vec: getEmbedding("passage", m.pid) }))
    .filter((m): m is typeof m & { vec: Float32Array } => !!m.vec);
  let best: { a: (typeof withVecs)[0]; b: (typeof withVecs)[0]; s: number } | null = null;
  for (let i = 0; i < withVecs.length; i++) {
    for (let j = i + 1; j < withVecs.length; j++) {
      const crossBook = withVecs[i].bookId !== withVecs[j].bookId;
      let s = 0;
      const vi = withVecs[i].vec;
      const vj = withVecs[j].vec;
      for (let d = 0; d < Math.min(vi.length, vj.length); d++) s += vi[d] * vj[d];
      const adjusted = crossBook ? s - 0.15 : s; // prefer cross-book contrasts
      if (!best || adjusted < best.s) best = { a: withVecs[i], b: withVecs[j], s: adjusted };
    }
  }
  if (!best) return c.json({ success: false, error: "No embedded mentions" }, 404);
  const view = (m: { pid: string; bookId: string; bookTitle: string; text: string }) => ({
    passageId: m.pid,
    bookId: m.bookId,
    bookTitle: m.bookTitle,
    snippet: m.text.trim().replace(/\s+/g, " ").slice(0, 320),
  });
  return c.json({ success: true, perspectives: [view(best.a), view(best.b)] });
});

// --- trails ---------------------------------------------------------------------------------

/** POST /api/trails {title?, path: passageId[]} — save a wander path. */
app.post("/api/trails", async (c) => {
  const profileId = c.get("profileId") as string | undefined;
  if (!profileId) return c.json({ success: false, error: "Profile required" }, 401);
  const body = await c.req.json().catch(() => null);
  const path = Array.isArray(body?.path)
    ? body.path.filter((x: unknown) => typeof x === "string")
    : [];
  if (path.length === 0) return c.json({ success: false, error: "path required" }, 400);
  const id = randomUUID();
  const title =
    typeof body?.title === "string" && body.title.trim()
      ? body.title.trim().slice(0, 120)
      : `Trail of ${path.length} ideas`;
  rawDb
    .prepare("INSERT INTO trails (id, profile_id, title, path_json) VALUES (?, ?, ?, ?)")
    .run(id, profileId, title, JSON.stringify(path.slice(0, 500)));
  return c.json({ success: true, id, title });
});

/** GET /api/trails — the profile's saved trails. */
app.get("/api/trails", (c) => {
  const profileId = c.get("profileId") as string | undefined;
  if (!profileId) return c.json({ success: false, error: "Profile required" }, 401);
  const rows = rawDb
    .prepare(
      "SELECT id, title, path_json AS pathJson, created_at AS createdAt FROM trails WHERE profile_id = ? ORDER BY created_at DESC LIMIT 50",
    )
    .all(profileId) as { id: string; title: string; pathJson: string; createdAt: number }[];
  return c.json({
    success: true,
    trails: rows.map((t) => ({
      id: t.id,
      title: t.title,
      length: JSON.parse(t.pathJson).length,
      createdAt: t.createdAt,
    })),
  });
});

/**
 * POST /api/trails/:id/render — enqueue narration of this trail as a fabric
 * job for a Kokoro-capable device (audio wander, S5).
 */
app.post("/api/trails/:id/render", async (c) => {
  const profileId = c.get("profileId") as string | undefined;
  const row = rawDb
    .prepare("SELECT id, profile_id AS profileId, path_json AS pathJson FROM trails WHERE id = ?")
    .get(c.req.param("id")) as { id: string; profileId: string; pathJson: string } | undefined;
  if (!row || row.profileId !== profileId) {
    return c.json({ success: false, error: "Trail not found" }, 404);
  }
  const body = await c.req.json().catch(() => ({}));
  const textOf = rawDb.prepare("SELECT text FROM passages WHERE id = ?");
  const segments = (JSON.parse(row.pathJson) as string[])
    .map((pid) => ({
      passageId: pid,
      text: ((textOf.get(pid) as { text: string } | undefined)?.text ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 1600),
    }))
    .filter((s) => s.text.length > 0);
  if (segments.length === 0) return c.json({ success: false, error: "Trail has no text" }, 400);
  const { item, deduped } = enqueueWork({
    project: "compendus",
    kind: "tts-render-trail",
    payload: { trailId: row.id, voiceIndex: Number(body?.voiceIndex) || 0, segments },
    requirements: { runtimes: ["kokoro"], estMinutes: 2 },
  });
  return c.json({ success: true, itemId: item.id, deduped });
});

/** GET /api/trails/:id/audio — stream the rendered narration WAV. */
app.get("/api/trails/:id/audio", (c) => {
  const profileId = c.get("profileId") as string | undefined;
  const row = rawDb
    .prepare("SELECT profile_id AS profileId, audio_hash AS audioHash FROM trails WHERE id = ?")
    .get(c.req.param("id")) as { profileId: string; audioHash: string | null } | undefined;
  if (!row || row.profileId !== profileId) {
    return c.json({ success: false, error: "Trail not found" }, 404);
  }
  if (!row.audioHash) return c.json({ success: false, error: "Not rendered yet" }, 404);
  const abs = resolveDataPath(blobPathFor(row.audioHash));
  if (!existsSync(abs)) return c.json({ success: false, error: "Artifact missing" }, 410);
  const bytes = readFileSync(abs);
  return c.body(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    200,
    {
      "Content-Type": "audio/wav",
      "Content-Length": String(bytes.length),
    },
  );
});

/** GET /api/trails/:id — full trail with stop snippets, replayable. */
app.get("/api/trails/:id", (c) => {
  const profileId = c.get("profileId") as string | undefined;
  const row = rawDb
    .prepare(
      "SELECT id, profile_id AS profileId, title, path_json AS pathJson FROM trails WHERE id = ?",
    )
    .get(c.req.param("id")) as
    | { id: string; profileId: string; title: string; pathJson: string }
    | undefined;
  if (!row || row.profileId !== profileId) {
    return c.json({ success: false, error: "Trail not found" }, 404);
  }
  const path = JSON.parse(row.pathJson) as string[];
  const stmt = rawDb.prepare(
    `SELECT p.id, p.text, p.book_id AS bookId, b.title AS bookTitle
     FROM passages p JOIN books b ON b.id = p.book_id WHERE p.id = ?`,
  );
  const stops = path
    .map(
      (pid) =>
        stmt.get(pid) as
          | { id: string; text: string; bookId: string; bookTitle: string }
          | undefined,
    )
    .filter(Boolean)
    .map((p) => ({
      passageId: p!.id,
      bookId: p!.bookId,
      bookTitle: p!.bookTitle,
      snippet: p!.text.trim().replace(/\s+/g, " ").slice(0, 240),
    }));
  return c.json({ success: true, trail: { id: row.id, title: row.title, stops } });
});

export { app as substrateRoutes };
