/**
 * Semantic substrate routes — thin HTTP wrappers (for the iOS app and any
 * non-web client) over the shared wander/Pods libraries. The web UI
 * reaches the same functions through server actions (app/actions/substrate.ts);
 * the logic lives in app/lib so there is exactly one implementation.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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
// Topic detail remains solely as a deep-link compatibility surface. All active
// learning clients use the substrate-neutral Pods read model below.
import { lgTopicDetail } from "../../app/lib/lg/read-models";
import {
  adjacentPods,
  answerPodQuestion,
  getPodSession,
  listPods,
  searchPods,
} from "../../app/lib/learning/pods";
import { startPass, passStatus } from "../../app/lib/llm/lane";

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

// --- pods -------------------------------------------------------------------------------

/** GET /api/pods — the one learning collection contract shared by web + iOS. */
app.get("/api/pods", (c) => {
  const ids = (c.req.query("ids") || "").split(",").filter(Boolean);
  const result = listPods({
    limit: parseInt(c.req.query("limit") || "60", 10),
    offset: parseInt(c.req.query("offset") || "0", 10),
    ids: ids.length ? ids : undefined,
  });
  return c.json({ success: true, ...result });
});

app.get("/api/pods/search", (c) => {
  const query = (c.req.query("q") || "").trim();
  if (!query) return c.json({ success: false, error: "q required" }, 400);
  return c.json({ success: true, pods: searchPods(query) });
});

app.get("/api/pods/:id/session", (c) => {
  const session = getPodSession(c.req.param("id"), c.get("profileId") ?? undefined);
  if (!session) {
    return c.json({ success: false, error: "Pod does not have enough verified sources yet" }, 404);
  }
  return c.json({ success: true, session, adjacent: adjacentPods(c.req.param("id")) });
});

app.post("/api/pods/:id/attempts", async (c) => {
  let body: {
    revision?: string;
    questionId?: string;
    selectedChoiceId?: string;
    attemptId?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Malformed JSON body" }, 400);
  }
  if (!body.questionId || !body.selectedChoiceId) {
    return c.json({ success: false, error: "questionId and selectedChoiceId required" }, 400);
  }
  const podId = c.req.param("id");
  const profileId = c.get("profileId") ?? undefined;
  const current = getPodSession(podId, profileId);
  if (body.revision && current?.revision !== body.revision) {
    return c.json(
      {
        success: false,
        error: "Pod changed since this question was loaded",
        code: "POD_REVISION_STALE",
        revision: current?.revision ?? null,
      },
      409,
    );
  }
  const result = answerPodQuestion({
    podId,
    revision: body.revision,
    questionId: body.questionId,
    selectedChoiceId: body.selectedChoiceId,
    attemptId: body.attemptId,
    profileId,
  });
  if (!result) return c.json({ success: false, error: "Question not found" }, 404);
  return c.json({ success: true, result });
});

// --- legacy topic aliases --------------------------------------------------------------
// Saved links and older clients keep working, but all reads now flow through
// the Pods read model instead of selecting a substrate independently.

/** GET /api/topics — paged topic list (or ids=csv selection) with coverage.
 *  Serves the LLM learning graph once Phase 2 lands (data-presence cutover). */
app.get("/api/topics", (c) => {
  const ids = (c.req.query("ids") || "").split(",").filter(Boolean);
  const opts = {
    limit: parseInt(c.req.query("limit") || "60", 10),
    offset: parseInt(c.req.query("offset") || "0", 10),
    ids: ids.length ? ids : undefined,
  };
  const { pods, total } = listPods(opts);
  const topics = pods.map((pod) => ({
    id: pod.id,
    label: pod.title,
    size: pod.passageCount,
    bookCount: pod.bookCount,
  }));
  return c.json({ success: true, topics, total });
});

/** GET /api/realms — the categorical layer (not part of the concept substrate yet). */
app.get("/api/realms", (c) => c.json({ success: true, realms: [] }));

/** GET /api/topics/search?q= — find a road. */
app.get("/api/topics/search", (c) => {
  const q = (c.req.query("q") || "").trim();
  if (!q) return c.json({ success: false, error: "q required" }, 400);
  const topics = searchPods(q).map((pod) => ({
    id: pod.id,
    label: pod.title,
    size: pod.passageCount,
    bookCount: pod.bookCount,
  }));
  return c.json({ success: true, topics });
});

/** GET /api/topics/:id — core-first passages + books. lgth_* ids read the
 *  learning graph; cs ids stay on the concept substrate (deep-link compat). */
app.get("/api/topics/:id", (c) => {
  if (c.req.param("id").startsWith("lgth_")) {
    const detail = lgTopicDetail(c.req.param("id"));
    if (!detail) return c.json({ success: false, error: "Topic not found" }, 404);
    return c.json({ success: true, topic: detail });
  }
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

/** GET /api/topics/:id/adjacent — journey forks. */
app.get("/api/topics/:id/adjacent", (c) => {
  const id = c.req.param("id");
  const adjacent = adjacentPods(id).map((pod) => ({
    id: pod.id,
    label: pod.title,
    size: pod.passageCount,
    bookCount: pod.bookCount,
  }));
  return c.json({ success: true, adjacent });
});

/** GET /api/topics/:id/curriculum — the journey reading path, built on demand. */
app.get("/api/topics/:id/curriculum", (c) => {
  const id = c.req.param("id");
  const profileId = c.get("profileId") ?? undefined;
  const session = getPodSession(id, profileId);
  if (!session) return c.json({ success: false, error: "Topic not found or empty" }, 404);
  const curriculum = {
    id: session.id,
    topicId: session.podId,
    title: session.title,
    builder: "pods-compat",
    items: session.items,
  };
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
 * POST /api/trails/:id/render — render this trail's narration with the
 * server's Kokoro TTS (audio wander). Runs detached on the serial inference
 * lane; poll /api/trails/:id/render/status, then stream /audio.
 */
app.post("/api/trails/:id/render", async (c) => {
  const profileId = c.get("profileId") as string | undefined;
  const row = rawDb
    .prepare(
      "SELECT id, profile_id AS profileId, path_json AS pathJson, audio_hash AS audioHash FROM trails WHERE id = ?",
    )
    .get(c.req.param("id")) as
    | { id: string; profileId: string; pathJson: string; audioHash: string | null }
    | undefined;
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

  const { renderTrailAudio, trailAudioPath } = await import("../../app/lib/tts/trail-render");
  // Compute-once: an already-rendered trail with its WAV on disk is done.
  if (row.audioHash && existsSync(trailAudioPath(row.audioHash))) {
    return c.json({ success: true, started: false, alreadyRendered: true });
  }
  const started = startPass(`tts-trail:${row.id}`, (status) => {
    status.total = segments.length;
    return renderTrailAudio(row.id, segments, {
      voiceIndex: Number(body?.voiceIndex) || 0,
      onProgress: (done) => {
        status.processed = done;
      },
    });
  });
  if (!started.started) return c.json({ success: true, started: false, reason: started.reason });
  return c.json({ success: true, started: true });
});

app.get("/api/trails/:id/render/status", (c) =>
  c.json(passStatus(`tts-trail:${c.req.param("id")}`)),
);

/** GET /api/trails/:id/audio — stream the rendered narration WAV. */
app.get("/api/trails/:id/audio", async (c) => {
  const profileId = c.get("profileId") as string | undefined;
  const row = rawDb
    .prepare("SELECT profile_id AS profileId, audio_hash AS audioHash FROM trails WHERE id = ?")
    .get(c.req.param("id")) as { profileId: string; audioHash: string | null } | undefined;
  if (!row || row.profileId !== profileId) {
    return c.json({ success: false, error: "Trail not found" }, 404);
  }
  if (!row.audioHash) return c.json({ success: false, error: "Not rendered yet" }, 404);
  const { trailAudioPath } = await import("../../app/lib/tts/trail-render");
  const abs = trailAudioPath(row.audioHash);
  if (!existsSync(abs)) return c.json({ success: false, error: "Audio file missing" }, 410);
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
