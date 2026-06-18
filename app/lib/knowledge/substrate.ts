/**
 * Semantic substrate — the embedding-first structure over the corpus
 * (wander-semantic-substrate-proposal.md §§3-6).
 *
 * One shared vector space (int8 + per-vector scale in `embeddings`), a
 * precomputed top-K kNN graph (`passage_neighbors`), and everything derived
 * from it: topics (label-propagation communities, with oversized communities
 * recursively re-split over a mutual-kNN subgraph), centrality (cross-book-
 * weighted degree, percentile-normalized per book so big books don't own the
 * ranking), bridges (cross-book AND cross-topic edges), and centroids
 * (book/chapter/topic/entity), plus pedagogical role classification via
 * embedding prototypes.
 *
 * All algorithms are brute-force-over-typed-arrays on purpose: at personal-
 * library scale this is seconds of single-threaded work and zero dependencies.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { freemem, totalmem } from "node:os";
import { db, rawDb } from "../db";
import { embed, EMBEDDING_MODEL, bufferToVector } from "./embeddings";
import { annAvailable, syncAnnIndex, ANN_MIN_PASSAGES } from "./ann-index";

export const KNN_K = 12;
/** Communities larger than max(this, 15% of corpus) get recursively re-split. */
export const SPLIT_FLOOR = 400;
export const BRIDGE_LIMIT = 500;

// --- int8 quantization ----------------------------------------------------------

export function quantize(vec: Float32Array): { vec: Buffer; scale: number } {
  let max = 1e-9;
  for (let i = 0; i < vec.length; i++) max = Math.max(max, Math.abs(vec[i]));
  const scale = max / 127;
  const buf = Buffer.allocUnsafe(vec.length);
  for (let i = 0; i < vec.length; i++) buf.writeInt8(Math.round(vec[i] / scale), i);
  return { vec: buf, scale };
}

export function dequantize(buf: Buffer, scale: number): Float32Array {
  const v = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) v[i] = buf.readInt8(i) * scale;
  return v;
}

export function upsertEmbedding(kind: string, refId: string, vec: Float32Array, model: string) {
  const q = quantize(vec);
  rawDb
    .prepare(
      `INSERT INTO embeddings (kind, ref_id, vec, scale, model) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(kind, ref_id) DO UPDATE SET vec=excluded.vec, scale=excluded.scale, model=excluded.model`,
    )
    .run(kind, refId, q.vec, q.scale, model);
}

export function getEmbedding(kind: string, refId: string): Float32Array | null {
  const row = rawDb
    .prepare("SELECT vec, scale FROM embeddings WHERE kind = ? AND ref_id = ?")
    .get(kind, refId) as { vec: Buffer; scale: number } | undefined;
  return row ? dequantize(row.vec, row.scale) : null;
}

// --- prose scoring -----------------------------------------------------------------

const BACKMATTER_TITLE_RE =
  /appendix|further reading|bibliograph|references|acknowledg|about the author|also by|copyright|credits|permissions|\bindex\b|works cited/i;
const BACKMATTER_HEAD_RE =
  /^(appendix|suggested (further )?reading|further reading|bibliography|works cited|acknowledg|about the author|also by|other books by|index of|copyright|all rights reserved)/i;
const PUBLISHER_RE =
  /\b(Press|Publishing|Publishers?|Bulletin|Media|Editions?|University of [A-Z][a-z]+)\b\.?/g;
const YEAR_RE = /\b(1[89]\d{2}|20[0-2]\d)\b/g;

/**
 * 0..1 prose quality. Low = citations, endnotes, bibliographies, reading
 * lists, publisher promo, and other front/back-matter that reads as text but
 * isn't the book — kept out of wander entry points, `deeper` steps, and study
 * paths (the graph keeps them; navigation never *starts* there).
 */
export function proseScore(text: string, chapterTitle?: string | null): number {
  const len = Math.max(1, text.length);
  let digits = 0;
  for (let x = 0; x < text.length; x++) {
    const ch = text.charCodeAt(x);
    if (ch >= 48 && ch <= 57) digits++;
  }
  const digitRatio = digits / len;
  const citationHits = (text.match(/\b(vol\.|pp?\.|ibid|op\. cit|ISBN|et al\.)/gi) || []).length;
  // Reading lists / colophons: dense in years and publisher imprints even when
  // the digit ratio stays prose-like ("Blackberry Culture. George M. Darrow.
  // 1918. Farmers Bulletin 643. USDA Publishing.").
  const head = text.slice(0, 100).trim();
  const titleHit =
    (chapterTitle && BACKMATTER_TITLE_RE.test(chapterTitle)) || BACKMATTER_HEAD_RE.test(head);
  const perKiloChar = 1000 / len;
  const yearDensity = (text.match(YEAR_RE) || []).length * perKiloChar;
  const publisherDensity = (text.match(PUBLISHER_RE) || []).length * perKiloChar;
  // Years alone are normal in history prose; the bibliographic signature is
  // years AND publisher imprints together ("…1918. Farmers Bulletin 643. USDA
  // Publishing."), so the year penalty is gated on imprints being present.
  const backmatter =
    (titleHit ? 0.45 : 0) +
    Math.min(0.5, publisherDensity * 0.12 + (publisherDensity > 0.5 ? yearDensity * 0.05 : 0));
  return Math.max(
    0,
    1 - digitRatio * 10 - citationHits * 0.15 - (len < 120 ? 0.4 : 0) - backmatter,
  );
}

// --- corpus loading ----------------------------------------------------------------

export interface CorpusVectors {
  ids: string[];
  bookIds: string[];
  /** N x dim row-major INT8 — kept quantized exactly as stored. The old f32
   * matrix was 4× larger (1.5GB at 1M passages — past the rebuild worker's
   * heap cap); int8 + per-row scales is 384MB at 1M and loads without a
   * dequantize pass. Dot products fold the two scales in afterward. */
  qmat: Int8Array;
  /** Per-row dequantization scale (vector d = qmat[d] * scale). */
  scales: Float32Array;
  dim: number;
  index: Map<string, number>; // passageId -> row
  /** Dequantize one row to f32 (fresh array — safe to hand to usearch). */
  rowF32(i: number): Float32Array;
}

/**
 * Load all passage vectors. ALWAYS promotes legacy passages.embedding f32
 * blobs that aren't yet in the substrate `embeddings` table first — not only
 * when the table is empty. Order-independent on purpose: analyzing one book on
 * a pre-substrate corpus seeds `embeddings` with just that book, and an
 * empty-only fallback would then silently exclude every other book (exactly
 * what happened on the first live deploy).
 */
export function loadCorpusVectors(): CorpusVectors | null {
  const legacy = rawDb
    .prepare(
      `SELECT id, embedding FROM passages WHERE embedding IS NOT NULL
       AND id NOT IN (SELECT ref_id FROM embeddings WHERE kind = 'passage')`,
    )
    .all() as { id: string; embedding: Buffer }[];
  if (legacy.length > 0) {
    db.transaction(() => {
      for (const r of legacy) {
        upsertEmbedding("passage", r.id, bufferToVector(r.embedding), EMBEDDING_MODEL);
      }
    });
  }

  const rows = rawDb
    .prepare(
      `SELECT e.ref_id AS id, p.book_id AS bookId, e.vec, e.scale
       FROM embeddings e JOIN passages p ON p.id = e.ref_id WHERE e.kind = 'passage'`,
    )
    .all() as { id: string; bookId: string; vec: Buffer; scale: number }[];
  if (rows.length === 0) return null;

  const dim = rows[0].vec.length;
  const qmat = new Int8Array(rows.length * dim);
  const scales = new Float32Array(rows.length);
  const ids: string[] = Array.from({ length: rows.length }, () => "");
  const bookIds: string[] = Array.from({ length: rows.length }, () => "");
  const index = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) {
    ids[i] = rows[i].id;
    bookIds[i] = rows[i].bookId;
    index.set(rows[i].id, i);
    // The DB blob IS int8 — copy bytes straight in, no dequantize pass.
    qmat.set(new Int8Array(rows[i].vec.buffer, rows[i].vec.byteOffset, dim), i * dim);
    scales[i] = rows[i].scale;
  }
  const rowF32 = (i: number): Float32Array => {
    const v = new Float32Array(dim);
    const off = i * dim;
    const s = scales[i];
    for (let d = 0; d < dim; d++) v[d] = qmat[off + d] * s;
    return v;
  };
  return { ids, bookIds, qmat, scales, dim, index, rowF32 };
}

/** Cosine-ish similarity between rows i and j: int8 dot folded with scales. */
function dotRows(c: CorpusVectors, i: number, j: number): number {
  const { qmat, dim } = c;
  const a = i * dim;
  const b = j * dim;
  let s = 0;
  for (let d = 0; d < dim; d++) s += qmat[a + d] * qmat[b + d];
  return s * c.scales[i] * c.scales[j];
}

// --- kNN graph ----------------------------------------------------------------------

interface TopK {
  ids: Int32Array; // N x K neighbor row indices (-1 = empty)
  scores: Float32Array;
}

function emptyTopK(n: number, k: number): TopK {
  return {
    ids: new Int32Array(n * k).fill(-1),
    scores: new Float32Array(n * k).fill(-Infinity),
  };
}

function consider(t: TopK, k: number, i: number, j: number, s: number) {
  const base = i * k;
  let worst = 0;
  for (let x = 1; x < k; x++) if (t.scores[base + x] < t.scores[base + worst]) worst = x;
  if (s > t.scores[base + worst]) {
    t.scores[base + worst] = s;
    t.ids[base + worst] = j;
  }
}

export const CROSS_K = 4;

/**
 * Full brute-force kNN over the corpus, computing BOTH the unrestricted top-K
 * and a cross-book-only top-CROSS_K in the same O(N²) sweep. The cross-book
 * set guarantees every passage has "same idea in another book" steps even when
 * its plain neighbors are all in-book (the common case — in-book prose is
 * always closest).
 */
export function buildKnn(c: CorpusVectors, k = KNN_K): { all: TopK; cross: TopK } {
  const n = c.ids.length;
  const all = emptyTopK(n, k);
  const cross = emptyTopK(n, CROSS_K);
  const BLOCK = 256;
  for (let ib = 0; ib < n; ib += BLOCK) {
    const iEnd = Math.min(ib + BLOCK, n);
    for (let jb = ib; jb < n; jb += BLOCK) {
      const jEnd = Math.min(jb + BLOCK, n);
      for (let i = ib; i < iEnd; i++) {
        const jStart = jb === ib ? i + 1 : jb;
        for (let j = jStart; j < jEnd; j++) {
          const s = dotRows(c, i, j);
          consider(all, k, i, j, s);
          consider(all, k, j, i, s);
          if (c.bookIds[i] !== c.bookIds[j]) {
            consider(cross, CROSS_K, i, j, s);
            consider(cross, CROSS_K, j, i, s);
          }
        }
      }
    }
  }
  return { all, cross };
}

/**
 * ANN-backed kNN: N index queries (O(N log N) total) instead of the N²/2
 * sweep. Over-fetches and filters for the cross-book set; a passage buried in
 * a giant book may surface fewer than CROSS_K cross-book neighbors (the
 * over-fetch window is bounded) — wander degrades gracefully there, exactly
 * like a passage whose true neighbors are all in-book.
 */
function buildKnnAnn(
  c: CorpusVectors,
  ann: import("./ann-index").AnnHandle,
  k = KNN_K,
  log?: (m: string) => void,
): { all: TopK; cross: TopK } {
  const n = c.ids.length;
  const all = emptyTopK(n, k);
  const cross = emptyTopK(n, CROSS_K);
  // Window: enough for k true neighbors + dead labels + self + in-book
  // dominance for the cross set.
  const M = Math.max(k * 4, 64);
  for (let i = 0; i < n; i++) {
    const res = c.ids[i] ? ann.index.search(c.rowF32(i), M) : null;
    if (!res) continue;
    const keys: BigUint64Array = res.keys;
    const dists: Float32Array = res.distances;
    let crossFound = 0;
    for (let x = 0; x < keys.length; x++) {
      const j = ann.rowOf.get(keys[x]);
      if (j === undefined || j === i) continue; // dead label or self
      const s = 1 - dists[x]; // cosine distance → similarity
      consider(all, k, i, j, s);
      if (c.bookIds[i] !== c.bookIds[j] && crossFound < CROSS_K * 4) {
        consider(cross, CROSS_K, i, j, s);
        crossFound++;
      }
    }
    if (i > 0 && i % 25_000 === 0) log?.(`substrate: ann kNN ${i}/${n}`);
  }
  return { all, cross };
}

function persistKnn(c: CorpusVectors, all: TopK, cross: TopK, k = KNN_K) {
  const insert = rawDb.prepare(
    `INSERT OR IGNORE INTO passage_neighbors (passage_id, neighbor_id, score, rank, cross_book)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const writeSet = (t: TopK, kk: number, rankBase: number, start: number, end: number) => {
    for (let i = start; i < end; i++) {
      const order = Array.from({ length: kk }, (_, x) => x)
        .filter((x) => t.ids[i * kk + x] >= 0)
        .sort((a, b) => t.scores[i * kk + b] - t.scores[i * kk + a]);
      order.forEach((x, rank) => {
        const j = t.ids[i * kk + x];
        insert.run(
          c.ids[i],
          c.ids[j],
          t.scores[i * kk + x],
          rankBase + rank + 1,
          c.bookIds[i] !== c.bookIds[j] ? 1 : 0,
        );
      });
    }
  };
  // Short transactions on purpose: this runs on the rebuild worker thread
  // while the main thread keeps ingesting. One monolithic transaction held the
  // WAL writer lock for tens of seconds at 30k+ passages and starved every
  // main-thread write into "database is locked". Readers may briefly see a
  // partially-rewritten neighbor table mid-rebuild; wander degrades gracefully.
  db.transaction(() => {
    rawDb.prepare("DELETE FROM passage_neighbors").run();
  });
  const BATCH = 2000;
  for (let start = 0; start < c.ids.length; start += BATCH) {
    const end = Math.min(c.ids.length, start + BATCH);
    db.transaction(() => {
      writeSet(all, k, 0, start, end);
      // Cross-book-only set at rank offset 100 (PK is passage_id+rank): every
      // passage is guaranteed "same idea in another book" steps.
      writeSet(cross, CROSS_K, 100, start, end);
    });
  }
}

// --- incremental kNN --------------------------------------------------------------
//
// The 57-minute lockup on the deploy box was rebuildStructure re-running the
// ANN search over EVERY passage on every ingest (the "ann kNN 25000/239661 …"
// progress that stalled into swap). The graph is append-mostly: a new book's
// passages need neighbors, but the 240k already-linked passages do not — their
// rows are still in `passage_neighbors`. So we reload the existing graph from
// the DB (a fast indexed scan) and ANN-search ONLY the new passages. The
// downstream community/centrality/bridge passes consume the full graph exactly
// as before, so topic quality is unchanged; only old passages' PERSISTED
// neighbor rows omit the newest book until a periodic full rebuild (run
// off-box / on the fleet) re-queries everyone. That is the documented
// degradation — wander from the new book still reaches everything.

/** Passage ids that already have a persisted neighbor row (PK-prefix scan). */
function linkedPassageIds(): Set<string> {
  const set = new Set<string>();
  for (const r of rawDb
    .prepare("SELECT DISTINCT passage_id AS id FROM passage_neighbors")
    .iterate() as Iterable<{ id: string }>)
    set.add(r.id);
  return set;
}

/** Rehydrate the persisted kNN graph into TopK arrays (no search). */
function loadKnnFromDb(c: CorpusVectors, k = KNN_K): { all: TopK; cross: TopK } {
  const all = emptyTopK(c.ids.length, k);
  const cross = emptyTopK(c.ids.length, CROSS_K);
  for (const r of rawDb
    .prepare(
      "SELECT passage_id AS pid, neighbor_id AS nid, score AS s, rank AS rk FROM passage_neighbors",
    )
    .iterate() as Iterable<{ pid: string; nid: string; s: number; rk: number }>) {
    const i = c.index.get(r.pid);
    const j = c.index.get(r.nid);
    if (i === undefined || j === undefined) continue; // dead ref (re-analyzed book)
    // Cross-book guaranteed set persists at rank offset 100; everything else is
    // the plain top-K.
    if (r.rk >= 100) consider(cross, CROSS_K, i, j, r.s);
    else consider(all, k, i, j, r.s);
  }
  return { all, cross };
}

/**
 * Existing graph from the DB + ANN search for `newRows` only. The new rows are
 * filled exactly as buildKnnAnn fills a queried row (own search results;
 * symmetrize() makes the in-memory adjacency bidirectional for the community
 * pass).
 */
function buildKnnIncremental(
  c: CorpusVectors,
  ann: import("./ann-index").AnnHandle,
  newRows: number[],
  k = KNN_K,
  log?: (m: string) => void,
): { all: TopK; cross: TopK } {
  const { all, cross } = loadKnnFromDb(c, k);
  const M = Math.max(k * 4, 64);
  let done = 0;
  for (const i of newRows) {
    const res = c.ids[i] ? ann.index.search(c.rowF32(i), M) : null;
    if (!res) continue;
    const keys: BigUint64Array = res.keys;
    const dists: Float32Array = res.distances;
    let crossFound = 0;
    for (let x = 0; x < keys.length; x++) {
      const j = ann.rowOf.get(keys[x]);
      if (j === undefined || j === i) continue;
      const s = 1 - dists[x];
      consider(all, k, i, j, s);
      if (c.bookIds[i] !== c.bookIds[j] && crossFound < CROSS_K * 4) {
        consider(cross, CROSS_K, i, j, s);
        crossFound++;
      }
    }
    if (++done % 25_000 === 0) log?.(`substrate: incremental kNN ${done}/${newRows.length}`);
  }
  return { all, cross };
}

/** Persist neighbor rows for `rows` only (INSERT OR IGNORE, no table wipe). */
function persistKnnRows(c: CorpusVectors, all: TopK, cross: TopK, rows: number[], k = KNN_K) {
  const insert = rawDb.prepare(
    `INSERT OR IGNORE INTO passage_neighbors (passage_id, neighbor_id, score, rank, cross_book)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const writeRow = (t: TopK, kk: number, rankBase: number, i: number) => {
    const order = Array.from({ length: kk }, (_, x) => x)
      .filter((x) => t.ids[i * kk + x] >= 0)
      .sort((a, b) => t.scores[i * kk + b] - t.scores[i * kk + a]);
    order.forEach((x, rank) => {
      const j = t.ids[i * kk + x];
      insert.run(
        c.ids[i],
        c.ids[j],
        t.scores[i * kk + x],
        rankBase + rank + 1,
        c.bookIds[i] !== c.bookIds[j] ? 1 : 0,
      );
    });
  };
  const BATCH = 2000;
  for (let start = 0; start < rows.length; start += BATCH) {
    const slice = rows.slice(start, start + BATCH);
    db.transaction(() => {
      for (const i of slice) {
        writeRow(all, k, 0, i);
        writeRow(cross, CROSS_K, 100, i);
      }
    });
  }
}

// --- communities ----------------------------------------------------------------------

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Adj = Array<Array<{ j: number; s: number }>>;

function symmetrize(n: number, t: TopK, k: number): Adj {
  const adj: Adj = Array.from({ length: n }, () => []);
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    for (let x = 0; x < k; x++) {
      const j = t.ids[i * k + x];
      if (j < 0) continue;
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const s = t.scores[i * k + x];
      adj[i].push({ j, s });
      adj[j].push({ j: i, s });
    }
  }
  return adj;
}

function labelProp(nodes: number[], adj: Adj, rand: () => number): Map<number, number[]> {
  const label = new Map<number, number>(nodes.map((n) => [n, n]));
  const inSet = new Set(nodes);
  const order = [...nodes];
  let changed = Infinity;
  for (let iter = 0; iter < 25 && changed > Math.max(1, nodes.length * 0.001); iter++) {
    changed = 0;
    order.sort(() => rand() - 0.5);
    for (const i of order) {
      const votes = new Map<number, number>();
      for (const { j, s } of adj[i]) {
        if (!inSet.has(j)) continue;
        const l = label.get(j)!;
        votes.set(l, (votes.get(l) || 0) + s);
      }
      if (votes.size === 0) continue;
      let best = label.get(i)!;
      let bestW = -Infinity;
      for (const [l, w] of votes)
        if (w > bestW || (w === bestW && l < best)) {
          bestW = w;
          best = l;
        }
      if (best !== label.get(i)) {
        label.set(i, best);
        changed++;
      }
    }
  }
  const out = new Map<number, number[]>();
  for (const n of nodes) {
    const l = label.get(n)!;
    if (!out.has(l)) out.set(l, []);
    out.get(l)!.push(n);
  }
  return out;
}

/**
 * Mutual-kNN subgraph for re-splitting oversized communities: keep only edges
 * where each endpoint is in the other's top-6. Mutual graphs fragment where
 * plain kNN graphs blob, which is exactly what we want inside a giant
 * narrative community.
 */
function mutualAdj(members: number[], adj: Adj, keep = 6): Adj {
  const inSet = new Set(members);
  const top = new Map<number, Set<number>>();
  for (const i of members) {
    const best = adj[i]
      .filter((e) => inSet.has(e.j))
      .sort((a, b) => b.s - a.s)
      .slice(0, keep)
      .map((e) => e.j);
    top.set(i, new Set(best));
  }
  const out: Adj = [];
  for (const i of members) {
    out[i] = adj[i].filter((e) => top.get(i)?.has(e.j) && top.get(e.j)?.has(i));
  }
  return out;
}

export interface CommunityResult {
  /** topic key -> member row indices */
  communities: Map<string, { members: number[]; parent: string | null }>;
}

export function detectCommunities(c: CorpusVectors, adj: Adj): CommunityResult {
  const n = c.ids.length;
  const rand = mulberry(42);
  const splitAt = Math.max(SPLIT_FLOOR, Math.floor(n * 0.15));
  const out = new Map<string, { members: number[]; parent: string | null }>();

  const top = labelProp(
    Array.from({ length: n }, (_, i) => i),
    adj,
    rand,
  );
  for (const [, members] of top) {
    const key = randomUUID();
    if (members.length <= splitAt) {
      out.set(key, { members, parent: null });
      continue;
    }
    // Re-split the oversized community over its mutual-kNN subgraph.
    const sub = labelProp(members, mutualAdj(members, adj), rand);
    if (sub.size <= 1) {
      out.set(key, { members, parent: null });
      continue;
    }
    out.set(key, { members: [], parent: null }); // parent marker (kept empty)
    for (const [, subMembers] of sub) {
      out.set(randomUUID(), { members: subMembers, parent: key });
    }
  }
  // Drop empty parent markers that ended up with no children.
  const emptyParents = [...out.entries()]
    .filter(([, v]) => v.members.length === 0 && v.parent === null)
    .map(([key]) => key)
    .filter((key) => ![...out.values()].some((x) => x.parent === key));
  for (const key of emptyParents) out.delete(key);
  return { communities: out };
}

// --- structure rebuild (topics, centrality, bridges, centroids, roles) --------------

export interface StructureStats {
  passages: number;
  edges: number;
  crossBookEdgeShare: number;
  topicCount: number;
  bridgeCount: number;
}

const ROLE_PROTOTYPES: Record<string, string> = {
  definition:
    "A definition: this term means the following; the concept is defined as; X is a kind of Y; we use the word to refer to.",
  example:
    "A concrete example or illustration: for example, consider this case; one instance of this is; imagine a situation where.",
  argument:
    "An argument or claim with reasons: therefore we should conclude; the evidence shows that; this is because; it follows that.",
  application:
    "Practical application or instructions: how to do it step by step; apply this method; in practice you should; the procedure is.",
  narrative:
    "Narrative storytelling: she said, he walked into the room, the next morning, they felt afraid, dialogue between characters.",
};

async function rolePrototypeVectors(dim: number): Promise<Map<string, Float32Array>> {
  const out = new Map<string, Float32Array>();
  for (const [role, text] of Object.entries(ROLE_PROTOTYPES)) {
    let v = getEmbedding("prototype", role);
    if (!v || v.length !== dim) {
      v = await embed(text);
      upsertEmbedding("prototype", role, v, EMBEDDING_MODEL);
    }
    out.set(role, v);
  }
  return out;
}

function npmi(co: number, cx: number, cy: number, n: number): number {
  if (co <= 0 || cx <= 0 || cy <= 0 || n <= 0) return 0;
  const pxy = co / n;
  const pmi = Math.log(pxy / ((cx / n) * (cy / n)));
  const denom = -Math.log(pxy);
  return denom === 0 ? 1 : pmi / denom;
}

/**
 * Rebuild every derived structure from the current passage vectors. Idempotent
 * and cheap enough to run on every ingest (seconds). The GLiNER naming pass is
 * NOT required first — topic labels just stay NULL where entities are missing
 * and fill in when extraction catches up.
 */
export async function rebuildStructure(
  onProgress?: (msg: string) => void,
): Promise<StructureStats | null> {
  const log = (m: string) => onProgress?.(m);
  const c = loadCorpusVectors();
  if (!c) return null;
  const n = c.ids.length;
  const dim = c.dim;

  // kNN graph. Three paths, cheapest first:
  //  1. Incremental — an existing substrate gaining a book: reuse the persisted
  //     graph, ANN-search only the new passages, persist only those. This is
  //     the fix for the deploy-box lockup (a 240k re-query → a few-hundred-row
  //     one). Works at any size once a substrate exists and usearch is present.
  //  2. Refresh — same passages, no new ones (e.g. the post-extraction label
  //     pass): rehydrate the graph from the DB, no search at all.
  //  3. Full build — first build, or no native module: ANN over everyone past
  //     the brute-force ceiling, else exact brute force. Rewrites the table.
  const linked = linkedPassageIds();
  const newRows: number[] = [];
  for (let i = 0; i < n; i++) if (!linked.has(c.ids[i])) newRows.push(i);

  let knn: { all: TopK; cross: TopK } | null = null;
  if (annAvailable() && linked.size > 0 && newRows.length > 0 && newRows.length < n) {
    try {
      const ann = syncAnnIndex(c, log); // delta-add (first i8 run builds the index)
      if (ann) {
        log(`substrate: incremental kNN — ${newRows.length} new, ${linked.size} reused`);
        knn = buildKnnIncremental(c, ann, newRows, KNN_K, log);
        persistKnnRows(c, knn.all, knn.cross, newRows);
      }
    } catch (e) {
      log(
        `substrate: incremental kNN failed (${e instanceof Error ? e.message : e}) — full rebuild`,
      );
      knn = null;
    }
  } else if (linked.size > 0 && newRows.length === 0) {
    log(`substrate: reuse persisted kNN (${linked.size} passages) — refresh only`);
    knn = loadKnnFromDb(c, KNN_K);
  }
  if (!knn) {
    if (n >= ANN_MIN_PASSAGES && annAvailable()) {
      try {
        const ann = syncAnnIndex(c, log);
        if (ann) {
          log(`substrate: ann kNN over ${n} passages`);
          knn = buildKnnAnn(c, ann, KNN_K, log);
        }
      } catch (e) {
        log(`substrate: ann failed (${e instanceof Error ? e.message : e}) — brute force`);
      }
    }
    if (!knn) {
      log(`substrate: kNN over ${n} passages`);
      knn = buildKnn(c);
    }
    persistKnn(c, knn.all, knn.cross);
  }
  const { all } = knn;
  const adj = symmetrize(n, all, KNN_K);

  let edges = 0;
  let crossEdges = 0;
  for (let i = 0; i < n; i++) {
    for (const { j } of adj[i]) {
      if (i < j) {
        edges++;
        if (c.bookIds[i] !== c.bookIds[j]) crossEdges++;
      }
    }
  }

  log("substrate: communities");
  const { communities } = detectCommunities(c, adj);

  // Centrality: cross-book-weighted degree + per-book percentile.
  const centrality = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    for (const { j, s } of adj[i]) centrality[i] += s * (c.bookIds[i] !== c.bookIds[j] ? 2 : 1);
  }
  const byBook = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    if (!byBook.has(c.bookIds[i])) byBook.set(c.bookIds[i], []);
    byBook.get(c.bookIds[i])!.push(i);
  }
  const bookNorm = new Float32Array(n);
  for (const [, rows] of byBook) {
    const sorted = [...rows].sort((a, b) => centrality[a] - centrality[b]);
    sorted.forEach((row, idx) => {
      bookNorm[row] = sorted.length > 1 ? idx / (sorted.length - 1) : 1;
    });
  }

  // Prose quality: citations/endnotes/front-matter/back-matter score low and
  // are excluded from wander entry points and study sequencing (they stay in
  // the graph — the structure usefully quarantines them into their own
  // communities).
  const textRows = rawDb
    .prepare("SELECT id, text, chapter_title AS chapterTitle FROM passages")
    .all() as { id: string; text: string; chapterTitle: string | null }[];
  const rowOf = new Map(textRows.map((r) => [r.id, r]));
  const prose = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const row = rowOf.get(c.ids[i]);
    prose[i] = proseScore(row?.text ?? "", row?.chapterTitle ?? null);
  }

  // Topic of each row (for bridges + persistence).
  const topicOf = new Map<number, string>();
  for (const [key, { members }] of communities) for (const m of members) topicOf.set(m, key);

  // Bridges: cross-book AND cross-topic edges, best first.
  const bridgeRows: Array<{ a: string; b: string; s: number }> = [];
  for (let i = 0; i < n; i++) {
    for (const { j, s } of adj[i]) {
      if (i < j && c.bookIds[i] !== c.bookIds[j] && topicOf.get(i) !== topicOf.get(j)) {
        bridgeRows.push({ a: c.ids[i], b: c.ids[j], s });
      }
    }
  }
  bridgeRows.sort((a, b) => b.s - a.s);
  bridgeRows.length = Math.min(bridgeRows.length, BRIDGE_LIMIT);

  // Topic labels: NPMI-distinctive canonical entities (where extraction exists).
  log("substrate: labeling + centroids");
  const entityForPassage = rawDb.prepare(
    `SELECT m.entity_id AS id, e.canonical_name AS name
     FROM canonical_mentions m JOIN entities e ON e.id = m.entity_id
     WHERE m.passage_id = ? GROUP BY m.entity_id`,
  );
  const entityTotals = new Map<string, number>();
  const perTopicEntities = new Map<string, Map<string, { name: string; count: number }>>();
  for (const [key, { members }] of communities) {
    if (members.length === 0) continue;
    const m = new Map<string, { name: string; count: number }>();
    perTopicEntities.set(key, m);
    for (const row of members) {
      for (const e of entityForPassage.all(c.ids[row]) as { id: string; name: string }[]) {
        const cur = m.get(e.id) || { name: e.name, count: 0 };
        cur.count++;
        m.set(e.id, cur);
        entityTotals.set(e.id, (entityTotals.get(e.id) || 0) + 1);
      }
    }
  }

  // Role classification: nearest prototype vector (margin-gated).
  const protos = await rolePrototypeVectors(dim);
  const roleRows: Array<{ id: string; role: string; conf: number }> = [];
  for (let i = 0; i < n; i++) {
    let best = "";
    let bestS = -Infinity;
    let second = -Infinity;
    for (const [role, pv] of protos) {
      let s = 0;
      const off = i * dim;
      for (let d = 0; d < dim; d++) s += c.qmat[off + d] * pv[d];
      s *= c.scales[i];
      if (s > bestS) {
        second = bestS;
        bestS = s;
        best = role;
      } else if (s > second) second = s;
    }
    roleRows.push({ id: c.ids[i], role: best, conf: Math.max(0, bestS - second) });
  }

  // Centroids: book, chapter, topic (entity centroids piggyback on resolution).
  const centroid = (rows: number[]): Float32Array => {
    const v = new Float32Array(dim);
    for (const r of rows) {
      const off = r * dim;
      const sc = c.scales[r];
      for (let d = 0; d < dim; d++) v[d] += c.qmat[off + d] * sc;
    }
    let norm = 0;
    for (let d = 0; d < dim; d++) norm += v[d] * v[d];
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < dim; d++) v[d] /= norm;
    return v;
  };

  // Same short-transaction discipline as persistKnn: each group commits in
  // small batches so the rebuild worker never monopolizes the WAL writer lock.
  db.transaction(() => {
    rawDb.prepare("DELETE FROM topics").run();
    rawDb.prepare("DELETE FROM passage_topics").run();
    rawDb.prepare("DELETE FROM passage_rank").run();
    rawDb.prepare("DELETE FROM bridges").run();
    rawDb.prepare("DELETE FROM passage_roles").run();
    rawDb.prepare("DELETE FROM embeddings WHERE kind IN ('topic','book')").run();
  });

  const insTopic = rawDb.prepare(
    "INSERT INTO topics (id, label, size, book_count, parent) VALUES (?, ?, ?, ?, ?)",
  );
  const insPT = rawDb.prepare("INSERT INTO passage_topics (passage_id, topic_id) VALUES (?, ?)");
  const communityList = [...communities.entries()];
  const TOPIC_BATCH = 50;
  for (let bs = 0; bs < communityList.length; bs += TOPIC_BATCH) {
    const slice = communityList.slice(bs, bs + TOPIC_BATCH);
    db.transaction(() => {
      for (const [key, { members, parent }] of slice) {
        if (members.length === 0) {
          insTopic.run(key, null, 0, 0, null);
          continue;
        }
        const books = new Set(members.map((m) => c.bookIds[m]));
        const ents = perTopicEntities.get(key);
        let label: string | null = null;
        if (ents && ents.size > 0) {
          const scored = [...ents.entries()]
            .filter(([, v]) => v.count >= 2)
            .map(([id, v]) => ({
              name: v.name,
              score: npmi(v.count, members.length, entityTotals.get(id) || v.count, n),
            }))
            .filter((sc) => sc.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 4);
          if (scored.length) label = scored.map((sc) => sc.name).join(", ");
        }
        insTopic.run(key, label, members.length, books.size, parent);
        for (const m of members) insPT.run(c.ids[m], key);
        upsertEmbedding("topic", key, centroid(members), EMBEDDING_MODEL);
      }
    });
  }

  const insRank = rawDb.prepare(
    "INSERT INTO passage_rank (passage_id, centrality, book_norm, prose) VALUES (?, ?, ?, ?)",
  );
  const RANK_BATCH = 5000;
  for (let bs = 0; bs < n; bs += RANK_BATCH) {
    const be = Math.min(n, bs + RANK_BATCH);
    db.transaction(() => {
      for (let i = bs; i < be; i++) insRank.run(c.ids[i], centrality[i], bookNorm[i], prose[i]);
    });
  }

  db.transaction(() => {
    const insBridge = rawDb.prepare(
      "INSERT OR IGNORE INTO bridges (passage_a, passage_b, score) VALUES (?, ?, ?)",
    );
    for (const b of bridgeRows) insBridge.run(b.a, b.b, b.s);

    const insRole = rawDb.prepare(
      "INSERT INTO passage_roles (passage_id, role, confidence) VALUES (?, ?, ?)",
    );
    for (const r of roleRows) insRole.run(r.id, r.role, r.conf);

    for (const [bookId, rows] of byBook) {
      upsertEmbedding("book", bookId, centroid(rows), EMBEDDING_MODEL);
    }
  });

  // Entity centroids (canonical entities with ≥3 mention passages) — used by
  // query-seeded wander, which matches short queries against short-text
  // centroids (MiniLM's symmetric home turf) instead of raw passages.
  const mentionRows = rawDb
    .prepare("SELECT entity_id AS entityId, passage_id AS passageId FROM canonical_mentions")
    .all() as { entityId: string; passageId: string }[];
  const byEntity = new Map<string, number[]>();
  for (const m of mentionRows) {
    const row = c.index.get(m.passageId);
    if (row === undefined) continue;
    if (!byEntity.has(m.entityId)) byEntity.set(m.entityId, []);
    const list = byEntity.get(m.entityId)!;
    if (list.length < 12) list.push(row);
  }
  db.transaction(() => {
    rawDb.prepare("DELETE FROM embeddings WHERE kind = 'entity'").run();
    for (const [entityId, rows] of byEntity) {
      if (rows.length >= 3) upsertEmbedding("entity", entityId, centroid(rows), EMBEDDING_MODEL);
    }
  });

  // Stale curricula reference dead topic ids after a rebuild — drop them; they
  // rebuild on demand.
  rawDb
    .prepare("DELETE FROM curriculum_items WHERE curriculum_id IN (SELECT id FROM curricula)")
    .run();
  rawDb.prepare("DELETE FROM curricula").run();

  const stats: StructureStats = {
    passages: n,
    edges,
    crossBookEdgeShare: edges ? crossEdges / edges : 0,
    topicCount: [...communities.values()].filter((x) => x.members.length > 0).length,
    bridgeCount: bridgeRows.length,
  };
  log(
    `substrate: ${stats.topicCount} topics, ${stats.bridgeCount} bridges, ${(stats.crossBookEdgeShare * 100).toFixed(1)}% cross-book edges`,
  );
  return stats;
}

// Bulk-analysis guard: a full structure rebuild is O(N²) in corpus passages,
// so during a long analyze queue we promote every book's vectors immediately
// (searchable data is never lost) but only rebuild the derived structure when
// the corpus has grown enough — or enough time has passed — to be worth it.
let lastRebuild: { at: number; passages: number } | null = null;
const REBUILD_GROWTH = 1.1; // ≥10% more passages since the last rebuild
const REBUILD_MAX_AGE_MS = 45 * 60 * 1000;
/**
 * Hard ceiling for structure rebuilds on the deploy box. With the HNSW index
 * the kNN graph is N·O(log N), so the binding constraints become the
 * in-memory corpus matrix (N × 384 f32 ≈ 1.5GB/М at 1M — the worker heap cap)
 * and the community pass; 500k is the honest envelope today. True millions
 * need the corpus loop to stream vectors instead of materializing the matrix
 * — recorded as the follow-up. Without the native module (brute-force
 * fallback) the old O(N²) wall applies.
 */
const REBUILD_MAX_PASSAGES = annAvailable() ? 500_000 : 180_000;

function embeddedPassageCount(): number {
  return (
    rawDb.prepare("SELECT COUNT(*) AS n FROM embeddings WHERE kind = 'passage'").get() as {
      n: number;
    }
  ).n;
}

// During a bulk analyze grind a structure rebuild is pure churn: each one is
// O(N²), eats a full core for tens of minutes to hours, and is invalidated by
// the very next analyzed book. While the extract backlog is deep we SKIP
// rebuilds entirely (vectors still land — books stay searchable and join the
// structure on the next build); the normal growth/age rules resume when the
// backlog drains, so the grind's end triggers one big final rebuild. The only
// exception: a substrate that has never been built (substrateReady false)
// builds once so wander/journeys aren't empty for days.
const GRIND_PENDING_THRESHOLD = 10;

function extractGrindDepth(): number {
  try {
    return (
      rawDb
        .prepare(
          "SELECT COUNT(*) AS n FROM background_jobs WHERE type = 'extract' AND status = 'pending'",
        )
        .get() as { n: number }
    ).n;
  } catch {
    return 0;
  }
}

/**
 * Is the box under memory pressure? The deploy-box lockup was a rebuild pushing
 * resident memory past the cgroup limit → swap → both cores stalled for ~57min.
 * Even with incremental kNN the rebuild still materializes the corpus matrix and
 * the community graph, so we refuse to start one when memory is already tight —
 * the books stay searchable (vectors land immediately) and the structure
 * catches up on the next ingest or an off-box full rebuild. cgroup v2 first
 * (accurate in the container), host free memory as a fallback.
 */
function memoryPressureHigh(): boolean {
  try {
    const max = readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim();
    if (max && max !== "max") {
      const cur = Number(readFileSync("/sys/fs/cgroup/memory.current", "utf8").trim());
      const limit = Number(max);
      if (Number.isFinite(cur) && Number.isFinite(limit) && limit > 0) return cur / limit > 0.88;
    }
  } catch {
    // not a cgroup-v2 container — fall through to host stats
  }
  const total = totalmem();
  return total > 0 ? 1 - freemem() / total > 0.9 : false;
}

export function rebuildDue(): boolean {
  const now = embeddedPassageCount();
  if (now > REBUILD_MAX_PASSAGES) return false; // scale ceiling — see above
  if (!substrateReady()) return true; // never built — build once even under load
  if (memoryPressureHigh()) return false; // never sweep a memory-starved box
  if (!lastRebuild) return true;
  if (extractGrindDepth() > GRIND_PENDING_THRESHOLD) return false;
  if (now >= lastRebuild.passages * REBUILD_GROWTH) return true;
  return Date.now() - lastRebuild.at > REBUILD_MAX_AGE_MS && now !== lastRebuild.passages;
}

// Single-flight guard: one rebuild at a time, callers during a run skip.
let rebuildInFlight = false;

/**
 * Run the rebuild on a worker thread (production: dist/worker bundle) so the
 * minutes of synchronous O(N²) math never block the HTTP event loop — this
 * was the cause of the recurring "server unreachable" blackouts during bulk
 * analysis. Falls back to inline when the bundle isn't built (tests, scripts).
 */
async function rebuildOffThread(onProgress?: (msg: string) => void): Promise<StructureStats> {
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const workerPath = join(process.cwd(), "dist/worker/substrate-worker.mjs");
  if (!existsSync(workerPath)) return rebuildStructure(onProgress);
  const { Worker } = await import("node:worker_threads");
  return new Promise<StructureStats>((resolvePromise, rejectPromise) => {
    // Cap the worker's heap: it inherits NODE_OPTIONS' 3GB allowance otherwise,
    // and main(3GB) + worker(3GB) + native ORT buffers can brush the container's
    // 6GB ceiling → docker OOM-kill → a ~10-min boot-build blackout. The rebuild
    // needs a few hundred MB even at the 180k-passage ceiling.
    const worker = new Worker(workerPath, {
      resourceLimits: { maxOldGenerationSizeMb: 1536 },
    });
    const fail = (err: Error) => {
      worker.terminate().catch(() => {});
      rejectPromise(err);
    };
    worker.on(
      "message",
      (msg: { type: string; line?: string; stats?: StructureStats; error?: string }) => {
        if (msg.type === "progress" && msg.line) onProgress?.(msg.line);
        else if (msg.type === "done" && msg.stats) {
          worker.terminate().catch(() => {});
          resolvePromise(msg.stats);
        } else if (msg.type === "error") fail(new Error(msg.error ?? "rebuild worker failed"));
      },
    );
    worker.on("error", fail);
    worker.postMessage({ cmd: "rebuild" });
  });
}

/** Gated rebuild for ingest paths; scripts/admin call rebuildStructure directly. */
export async function rebuildStructureIfDue(
  onProgress?: (msg: string) => void,
): Promise<StructureStats | null> {
  if (rebuildInFlight) {
    onProgress?.("substrate: rebuild already in flight — skipping");
    return null;
  }
  if (!rebuildDue()) {
    onProgress?.(
      embeddedPassageCount() > REBUILD_MAX_PASSAGES
        ? "substrate: rebuild SKIPPED — corpus past brute-force ceiling (ANN index needed)"
        : memoryPressureHigh()
          ? "substrate: rebuild deferred (memory pressure — will catch up when it eases)"
          : "substrate: rebuild deferred (corpus growth below threshold)",
    );
    return null;
  }
  rebuildInFlight = true;
  try {
    const stats = await rebuildOffThread(onProgress);
    lastRebuild = { at: Date.now(), passages: embeddedPassageCount() };
    return stats;
  } finally {
    rebuildInFlight = false;
  }
}

/**
 * Ingest-time entry: ensure a book's passages are in the substrate embedding
 * table (promoting legacy f32 if needed), then rebuild structure when due.
 * During bulk analysis the rebuild gate keeps the O(N²) work amortized; a
 * book's vectors are always promoted immediately.
 */
export async function linkBook(
  bookId: string,
  onProgress?: (msg: string) => void,
): Promise<StructureStats | null> {
  const legacy = rawDb
    .prepare(
      `SELECT id, embedding FROM passages WHERE book_id = ? AND embedding IS NOT NULL
       AND id NOT IN (SELECT ref_id FROM embeddings WHERE kind = 'passage')`,
    )
    .all(bookId) as { id: string; embedding: Buffer }[];
  if (legacy.length > 0) {
    db.transaction(() => {
      for (const r of legacy)
        upsertEmbedding("passage", r.id, bufferToVector(r.embedding), EMBEDDING_MODEL);
    });
  }
  return rebuildStructureIfDue(onProgress);
}

// --- queries used by wander v2 / topics / frontier ----------------------------------

export function nearestByCentroid(
  kind: "topic" | "book" | "entity",
  query: Float32Array,
  limit = 5,
): Array<{ refId: string; score: number }> {
  const rows = rawDb
    .prepare("SELECT ref_id AS refId, vec, scale FROM embeddings WHERE kind = ?")
    .all(kind) as { refId: string; vec: Buffer; scale: number }[];
  return rows
    .map((r) => {
      const v = dequantize(r.vec, r.scale);
      let s = 0;
      for (let d = 0; d < Math.min(v.length, query.length); d++) s += v[d] * query[d];
      return { refId: r.refId, score: s };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function substrateReady(): boolean {
  const row = rawDb.prepare("SELECT COUNT(*) AS n FROM passage_neighbors").get() as { n: number };
  return row.n > 0;
}

/** Per-topic coverage for a profile: seen ∩ members / members. */
export function topicCoverage(profileId: string, topicId: string): { seen: number; total: number } {
  const row = rawDb
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM passage_topics WHERE topic_id = ?) AS total,
         (SELECT COUNT(*) FROM passage_topics pt
            JOIN passage_seen ps ON ps.passage_id = pt.passage_id AND ps.profile_id = ?
          WHERE pt.topic_id = ?) AS seen`,
    )
    .get(topicId, profileId, topicId) as { total: number; seen: number };
  return { seen: row.seen, total: row.total };
}

export function recordSeen(profileId: string, passageId: string, via: string) {
  rawDb
    .prepare(
      `INSERT INTO passage_seen (profile_id, passage_id, first_seen, last_seen, via)
       VALUES (?, ?, unixepoch(), unixepoch(), ?)
       ON CONFLICT(profile_id, passage_id) DO UPDATE SET last_seen = unixepoch()`,
    )
    .run(profileId, passageId, via);
}
