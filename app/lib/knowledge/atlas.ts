/**
 * The atlas — shared read-model over the substrate for topics ("roads"),
 * realms (categorical clusters of topic centroids), search, and adjacency.
 * Used by BOTH the Hono API routes (iOS app, fabric workers) and the web's
 * server actions, so there is exactly one implementation of naming fallbacks,
 * collision-driven re-naming, quality filtering, and realm caching.
 */
import { createHash } from "node:crypto";
import { rawDb } from "../db";
import { getEmbedding, topicCoverage, substrateReady } from "./substrate";
import { enqueueWork } from "../fabric";
import "../fabric/kinds";

export { substrateReady };

interface TopicRow {
  id: string;
  label: string | null;
  size: number;
  bookCount: number;
}

/**
 * The browse/study-quality topic set: back-matter-dominated communities
 * (citations, reading lists, captions, publisher promo) stay in the graph but
 * never surface here; ranking is prose-weighted reach so cross-book
 * boilerplate can't ride book_count to the top.
 */
function qualityTopics(minSize = 10, limit = 200): TopicRow[] {
  return rawDb
    .prepare(
      `SELECT t.id, t.label, t.size, t.book_count AS bookCount,
              AVG(CASE WHEN pr.prose >= 0.5 THEN 1.0 ELSE 0 END) AS strongFrac
       FROM topics t
       JOIN passage_topics pt ON pt.topic_id = t.id
       JOIN passage_rank pr ON pr.passage_id = pt.passage_id
       WHERE t.size >= ?
       GROUP BY t.id HAVING strongFrac >= 0.3333
       ORDER BY t.book_count * strongFrac DESC, t.size DESC LIMIT ?`,
    )
    .all(minSize, limit) as TopicRow[];
}

// Content-addressed identity for topics: topic UUIDs regenerate every rebuild,
// member passage ids don't. Cached per substrate version.
let topicKeyCache: { version: string; keys: Map<string, string> } | null = null;
function topicKeyOf(topicId: string): string {
  const version = substrateVersion();
  if (topicKeyCache?.version !== version) {
    topicKeyCache = { version, keys: new Map() };
  }
  const hit = topicKeyCache.keys.get(topicId);
  if (hit) return hit;
  const ids = (
    rawDb
      .prepare("SELECT passage_id AS id FROM passage_topics WHERE topic_id = ? ORDER BY passage_id")
      .all(topicId) as { id: string }[]
  ).map((r) => r.id);
  const key = createHash("sha256").update(ids.join("|")).digest("hex");
  topicKeyCache.keys.set(topicId, key);
  return key;
}

const LABEL_STOPWORDS = new Set([
  "and",
  "the",
  "of",
  "a",
  "an",
  "&",
  "to",
  "in",
  "for",
  "his",
  "her",
  "its",
  "with",
]);
function labelStems(label: string): Set<string> {
  return new Set(
    label
      .toLowerCase()
      .replace(/['\u2019]s\b/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !LABEL_STOPWORDS.has(w))
      .map((w) => w.replace(/s$/, "")),
  );
}
/** Two names are confusable when they share ≥2 content words with Jaccard ≥ 0.4. */
function labelsCollide(a: string, b: string): boolean {
  const sa = labelStems(a);
  const sb = labelStems(b);
  let shared = 0;
  for (const w of sa) if (sb.has(w)) shared++;
  if (shared < 2) return false;
  const union = new Set([...sa, ...sb]).size || 1;
  return shared / union >= 0.4;
}

/** Cap naming-job enqueues per request so a cold 118-road listing doesn't flood the queue. */
const TOPIC_NAME_JOBS_PER_REQUEST = 16;

/**
 * Best display name for a road, by rung: device-authored → GLiNER entity label
 * → book-derived fallback. Unnamed roads (idempotently) queue a naming job —
 * without this, single-book topics collapse into indistinguishable
 * "Inside <Book>" entries.
 */
function shapeTopics(rows: TopicRow[], profileId: string | undefined) {
  const topBooks = rawDb.prepare(
    `SELECT b.title, COUNT(*) AS n FROM passage_topics pt
     JOIN passages p ON p.id = pt.passage_id JOIN books b ON b.id = p.book_id
     WHERE pt.topic_id = ? GROUP BY p.book_id ORDER BY n DESC LIMIT 2`,
  );
  const authoredStmt = rawDb.prepare("SELECT label, blurb FROM topic_labels WHERE topic_key = ?");
  const sampleStmt2 = rawDb.prepare(
    `SELECT p.text FROM passage_topics pt
     JOIN passages p ON p.id = pt.passage_id
     JOIN passage_rank pr ON pr.passage_id = pt.passage_id
     WHERE pt.topic_id = ? AND pr.prose >= 0.5
     ORDER BY pr.book_norm DESC LIMIT 3`,
  );
  let enqueueBudget = TOPIC_NAME_JOBS_PER_REQUEST;
  // First pass: resolve display labels + book sets.
  const resolved = rows.map((t) => {
    const topicKey = topicKeyOf(t.id);
    const authored = authoredStmt.get(topicKey) as
      | { label: string; blurb: string | null }
      | undefined;
    const books = topBooks.all(t.id) as { title: string }[];
    const names = books.map((b) => b.title.split(/[:(]/)[0].trim()).filter(Boolean);
    let label = authored?.label ?? t.label;
    if (!label && names.length) {
      label =
        names.length > 1 && t.bookCount > 2
          ? `Between ${names[0]} & ${names[1]} +${t.bookCount - 2}`
          : names.length > 1
            ? `Between ${names[0]} & ${names[1]}`
            : `Inside ${names[0]}`;
    }
    return { t, topicKey, authored, books: names, label };
  });

  // Collision pass: among authored road names sharing a book, the first keeps
  // its name (anchor); later ones re-name with the anchor in their avoid list.
  const renameAvoid = new Map<string, string[]>();
  for (let i = 0; i < resolved.length; i++) {
    const a = resolved[i];
    if (!a.authored || !a.label) continue;
    for (let j = 0; j < i; j++) {
      const b = resolved[j];
      if (!b.label) continue;
      const shareBook = a.books.some((bk) => b.books.includes(bk));
      if (shareBook && labelsCollide(a.label, b.label)) {
        renameAvoid.set(a.topicKey, [...(renameAvoid.get(a.topicKey) ?? []), b.label]);
      }
    }
  }

  // Refusal fallback: the on-device model declines some content outright
  // ("Detected content likely to be unsafe" — war/crime/romance passages), so
  // those naming jobs fail permanently and would otherwise re-enqueue forever
  // as sibling sets shift. Synthesize a deterministic name from the topic's
  // own canonical entities, persist it as authored, and move on.
  const failedStmt = rawDb.prepare(
    `SELECT 1 FROM work_items WHERE kind = 'topic-label' AND status = 'failed'
     AND payload LIKE ? LIMIT 1`,
  );
  const topEntitiesStmt = rawDb.prepare(
    `SELECT e.canonical_name AS name, COUNT(*) AS n FROM canonical_mentions cm
     JOIN entities e ON e.id = cm.entity_id
     JOIN passage_topics pt ON pt.passage_id = cm.passage_id
     WHERE pt.topic_id = ? GROUP BY cm.entity_id ORDER BY n DESC LIMIT 2`,
  );
  const persistFallback = rawDb.prepare(
    `INSERT INTO topic_labels (topic_key, label, blurb, model_id) VALUES (?, ?, ?, 'server/entity-fallback')
     ON CONFLICT(topic_key) DO NOTHING`,
  );

  return resolved.map(({ t, topicKey, authored, books, label }) => {
    let needsName = !authored;
    const needsRename = renameAvoid.has(topicKey);
    if (needsName && failedStmt.get(`%"topicKey":"${topicKey}"%`)) {
      const ents = (topEntitiesStmt.all(t.id) as { name: string }[]).map((r) => r.name);
      const synth =
        ents.length >= 2
          ? `${ents[0]} & ${ents[1]}`.slice(0, 48)
          : ents.length === 1
            ? ents[0].slice(0, 48)
            : label;
      if (synth) {
        persistFallback.run(
          topicKey,
          synth,
          `Passages woven around ${ents.join(" and ") || "this thread"}.`,
        );
        label = synth;
        needsName = false;
      }
    }
    if ((needsName || needsRename) && enqueueBudget > 0) {
      enqueueBudget--;
      try {
        const samples = (sampleStmt2.all(t.id) as { text: string }[])
          .map((r) => r.text.replace(/\s+/g, " ").slice(0, 300))
          .filter(Boolean);
        const siblings = resolved
          .filter(
            (o) => o.topicKey !== topicKey && o.label && o.books.some((bk) => books.includes(bk)),
          )
          .map((o) => o.label as string)
          .slice(0, 6);
        if (samples.length > 0) {
          enqueueWork({
            project: "compendus",
            kind: "topic-label",
            payload: {
              topicKey,
              books: books.slice(0, 3),
              samples,
              siblings,
              ...(needsRename ? { avoid: renameAvoid.get(topicKey) } : {}),
            },
            requirements: { runtimes: ["foundation-models"], estMinutes: 1 },
          });
        }
      } catch {
        // naming is optional polish
      }
    }
    return {
      ...t,
      label,
      blurb: authored?.blurb ?? null,
      named: !!authored,
      coverage: profileId ? topicCoverage(profileId, t.id) : null,
    };
  });
}

export { qualityTopics, shapeTopics, topicKeyOf };

interface CachedRealm {
  realmKey: string;
  fallbackLabel: string;
  topicIds: string[];
  roadCount: number;
  passages: number;
  /** Evidence payload for the naming job, built once at cluster time. */
  namePayload: {
    realmKey: string;
    topics: Array<{ label: string; books: string[] }>;
    samples: string[];
  };
}
let realmCache: { version: string; realms: CachedRealm[] } | null = null;

/** Cheap substrate identity: changes whenever a rebuild rewrites the topics table. */
function substrateVersion(): string {
  const row = rawDb
    .prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS s, COALESCE(MAX(rowid),0) AS m FROM topics",
    )
    .get() as { n: number; s: number; m: number };
  return `${row.n}:${row.s}:${row.m}`;
}

export function listRealms(profileId: string | undefined) {
  const version = substrateVersion();
  if (realmCache?.version === version) {
    return serveRealms(realmCache.realms, profileId);
  }
  const topics = shapeTopics(qualityTopics(10), undefined);
  const withVecs = topics
    .map((t) => ({ t, vec: getEmbedding("topic", t.id) }))
    .filter((x): x is { t: (typeof topics)[0]; vec: Float32Array } => !!x.vec);
  if (withVecs.length === 0) return [];

  const dim = withVecs[0].vec.length;
  const k = Math.max(2, Math.min(8, Math.round(Math.sqrt(withVecs.length / 2))));
  // Deterministic init: spread over the (stable, ranked) topic order.
  let centers = Array.from({ length: k }, (_, i) => {
    const src = withVecs[Math.floor((i * withVecs.length) / k)].vec;
    return Float32Array.from(src);
  });
  let assign = new Array(withVecs.length).fill(0);
  for (let iter = 0; iter < 15; iter++) {
    assign = withVecs.map(({ vec }) => {
      let best = 0;
      let bestS = -Infinity;
      centers.forEach((center, ci) => {
        let s = 0;
        for (let d = 0; d < dim; d++) s += vec[d] * center[d];
        if (s > bestS) {
          bestS = s;
          best = ci;
        }
      });
      return best;
    });
    centers = centers.map((center, ci) => {
      const members = withVecs.filter((_, i) => assign[i] === ci);
      if (members.length === 0) return center;
      const next = new Float32Array(dim);
      for (const m of members) for (let d = 0; d < dim; d++) next[d] += m.vec[d];
      let norm = 0;
      for (let d = 0; d < dim; d++) norm += next[d] * next[d];
      norm = Math.sqrt(norm) || 1;
      for (let d = 0; d < dim; d++) next[d] /= norm;
      return next;
    });
  }

  const subjectStmt = rawDb.prepare(
    `SELECT bs.subject, COUNT(DISTINCT pt.passage_id) AS weight
     FROM passage_topics pt
     JOIN passages p ON p.id = pt.passage_id
     JOIN book_subjects bs ON bs.book_id = p.book_id
     WHERE pt.topic_id = ? GROUP BY bs.subject`,
  );
  const titleCase = (s: string) =>
    s.replace(/\b\w/g, (ch) => ch.toUpperCase()).replace(/ & /g, " & ");

  const sampleStmt = rawDb.prepare(
    `SELECT p.text FROM passage_topics pt
     JOIN passages p ON p.id = pt.passage_id
     JOIN passage_rank pr ON pr.passage_id = pt.passage_id
     WHERE pt.topic_id = ? AND pr.prose >= 0.5
     ORDER BY pr.book_norm DESC LIMIT 1`,
  );
  const bookStmt = rawDb.prepare(
    `SELECT b.title, COUNT(*) AS n FROM passage_topics pt
     JOIN passages p ON p.id = pt.passage_id JOIN books b ON b.id = p.book_id
     WHERE pt.topic_id = ? GROUP BY p.book_id ORDER BY n DESC LIMIT 3`,
  );

  const cached: CachedRealm[] = [];
  for (let ci = 0; ci < k; ci++) {
    const members = withVecs.filter((_, i) => assign[i] === ci).map((x) => x.t);
    if (members.length === 0) continue;
    const realmKey = createHash("sha256")
      .update(
        members
          .map((m) => m.id)
          .sort()
          .join("|"),
      )
      .digest("hex");
    const subjectWeights = new Map<string, number>();
    for (const t of members) {
      for (const row of subjectStmt.all(t.id) as { subject: string; weight: number }[]) {
        subjectWeights.set(row.subject, (subjectWeights.get(row.subject) || 0) + row.weight);
      }
    }
    const topSubjects = [...subjectWeights.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([subject]) => titleCase(subject));
    const fallbackLabel = topSubjects.length
      ? topSubjects.join(" · ")
      : (members.find((m) => m.label)?.label ?? "Uncharted").split(",")[0];
    cached.push({
      realmKey,
      fallbackLabel,
      topicIds: members.map((m) => m.id),
      roadCount: members.length,
      passages: members.reduce((n, m) => n + m.size, 0),
      namePayload: {
        realmKey,
        topics: members.slice(0, 10).map((m) => ({
          label: m.label ?? "",
          books: (bookStmt.all(m.id) as { title: string }[]).map((b) => b.title),
        })),
        samples: members
          .slice(0, 5)
          .map((m) => (sampleStmt.get(m.id) as { text: string } | undefined)?.text ?? "")
          .filter(Boolean)
          .map((t) => t.replace(/\s+/g, " ").slice(0, 300)),
      },
    });
  }
  realmCache = { version, realms: cached };
  return serveRealms(cached, profileId);
}

/**
 * Per-request finish over the cached clustering: authored names appear the
 * moment the fleet lands them, coverage is always the caller's own, and
 * unnamed realms (idempotently) queue a naming job for the fleet.
 */
function serveRealms(cached: CachedRealm[], profileId: string | undefined) {
  const labelStmt = rawDb.prepare("SELECT label, blurb FROM realm_labels WHERE realm_key = ?");
  // Resolve current names first so naming jobs can see their siblings, and
  // colliding authored names trigger a re-name (first keeps it, later avoids).
  const current = cached.map((r) => {
    const authored = labelStmt.get(r.realmKey) as
      | { label: string; blurb: string | null }
      | undefined;
    return { r, authored, label: authored?.label ?? r.fallbackLabel };
  });
  const realmAvoid = new Map<string, string[]>();
  for (let i = 0; i < current.length; i++) {
    if (!current[i].authored) continue;
    for (let j = 0; j < i; j++) {
      if (labelsCollide(current[i].label, current[j].label)) {
        realmAvoid.set(current[i].r.realmKey, [
          ...(realmAvoid.get(current[i].r.realmKey) ?? []),
          current[j].label,
        ]);
      }
    }
  }
  return current.map(({ r, authored }, ci) => {
    const needsRename = realmAvoid.has(r.realmKey);
    if (!authored || needsRename) {
      try {
        const siblings = current
          .filter((o) => o.r.realmKey !== r.realmKey)
          .map((o) => o.label)
          .slice(0, 7);
        enqueueWork({
          project: "compendus",
          kind: "realm-label",
          payload: {
            ...r.namePayload,
            siblings,
            ...(needsRename ? { avoid: realmAvoid.get(r.realmKey) } : {}),
          },
          requirements: { runtimes: ["foundation-models"], estMinutes: 1 },
        });
      } catch {
        // naming is optional polish; never block the listing
      }
    }
    const coverage = r.topicIds.reduce(
      (acc, topicId) => {
        if (profileId) {
          const cov = topicCoverage(profileId, topicId);
          acc.seen += cov.seen;
          acc.total += cov.total;
        }
        return acc;
      },
      { seen: 0, total: 0 },
    );
    return {
      id: `realm-${ci}`,
      key: r.realmKey,
      label: authored?.label ?? r.fallbackLabel,
      blurb: authored?.blurb ?? null,
      named: !!authored,
      topicIds: r.topicIds,
      roadCount: r.roadCount,
      passages: r.passages,
      coverage,
    };
  });
}

// searchTopics + adjacentTopics removed — journeys/search/forks now read the
// concept substrate (app/lib/concept/wander.ts).

/** Paged topics list with ids selection — used by the pipeline warm pass. */
export function listTopics(opts: {
  profileId?: string;
  minSize?: number;
  limit?: number;
  offset?: number;
  ids?: string[];
}) {
  const all = qualityTopics(opts.minSize ?? 10);
  if (opts.ids && opts.ids.length > 0) {
    const wanted = new Set(opts.ids.slice(0, 80));
    const selected = all.filter((t) => wanted.has(t.id));
    return { topics: shapeTopics(selected, opts.profileId), total: selected.length };
  }
  const limit = Math.min(80, Math.max(1, opts.limit ?? 60));
  const offset = Math.max(0, opts.offset ?? 0);
  return {
    topics: shapeTopics(all.slice(offset, offset + limit), opts.profileId),
    total: all.length,
  };
}
