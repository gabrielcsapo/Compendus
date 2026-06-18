/**
 * S0 — Semantic Substrate validation (throwaway, read-only).
 *
 * Builds the proposed embedding-first structure over an EXISTING analyzed DB and
 * reports whether the emergent geometry is meaningful: top-12 kNN graph over
 * passage embeddings → label-propagation communities ("topics") → degree
 * centrality → cross-book bridges, with topics labeled by NPMI-distinctive
 * canonical entities. Go/no-go gate for the substrate track — see
 * wander-semantic-substrate-proposal.md §8 (S0).
 *
 * Usage:
 *   pnpm tsx scripts/s0-validate-substrate.ts [--db path/to/compendus.db]
 *     [--k 12] [--sample 30000] [--out s0-report.md]
 *
 * Runs against a COPY of the deploy box's DB (readonly connection; never writes).
 */
import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

// --- args ------------------------------------------------------------------

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const DB_PATH = resolve(arg("db", "data/compendus.db"));
const K = parseInt(arg("k", "12"), 10);
const SAMPLE = parseInt(arg("sample", "30000"), 10);
const OUT = arg("out", "s0-report.md");

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

// --- load passages + embeddings ----------------------------------------------

interface P {
  id: string;
  bookId: string;
  vec: Float32Array;
}

function bufferToVector(b: Buffer): Float32Array {
  const v = new Float32Array(b.length / 4);
  for (let i = 0; i < v.length; i++) v[i] = b.readFloatLE(i * 4);
  return v;
}

// Deterministic RNG (mulberry32) so the report is reproducible run-to-run.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(42);

const bookTitles = new Map<string, string>(
  (db.prepare("SELECT id, title FROM books").all() as { id: string; title: string }[]).map((r) => [
    r.id,
    r.title,
  ]),
);

let rows = db
  .prepare("SELECT id, book_id AS bookId, embedding FROM passages WHERE embedding IS NOT NULL")
  .all() as { id: string; bookId: string; embedding: Buffer }[];

if (rows.length === 0) {
  console.error("No embedded passages found — has analysis run against this DB?");
  process.exit(1);
}
if (rows.length > SAMPLE) {
  console.log(`Sampling ${SAMPLE} of ${rows.length} passages (use --sample to change)`);
  rows = rows.sort(() => rand() - 0.5).slice(0, SAMPLE);
}

const passages: P[] = rows.map((r) => ({
  id: r.id,
  bookId: r.bookId,
  vec: bufferToVector(r.embedding),
}));
const N = passages.length;
const DIM = passages[0].vec.length;
console.log(
  `Loaded ${N} passages (${DIM}-d) across ${new Set(rows.map((r) => r.bookId)).size} books`,
);

// Pack into one contiguous matrix for a cache-friendly kNN kernel.
const mat = new Float32Array(N * DIM);
for (let i = 0; i < N; i++) mat.set(passages[i].vec, i * DIM);

// --- kNN graph (brute force, blocked) ----------------------------------------

const t0 = Date.now();
const nbrIds = new Int32Array(N * K).fill(-1);
const nbrScores = new Float32Array(N * K).fill(-Infinity);

function consider(i: number, j: number, s: number) {
  const base = i * K;
  // Track the current minimum slot; K is small so a linear pass is fine.
  let worst = 0;
  for (let k = 1; k < K; k++) if (nbrScores[base + k] < nbrScores[base + worst]) worst = k;
  if (s > nbrScores[base + worst]) {
    nbrScores[base + worst] = s;
    nbrIds[base + worst] = j;
  }
}

const BLOCK = 256;
for (let ib = 0; ib < N; ib += BLOCK) {
  const iEnd = Math.min(ib + BLOCK, N);
  for (let jb = ib; jb < N; jb += BLOCK) {
    const jEnd = Math.min(jb + BLOCK, N);
    for (let i = ib; i < iEnd; i++) {
      const iOff = i * DIM;
      const jStart = jb === ib ? i + 1 : jb;
      for (let j = jStart; j < jEnd; j++) {
        const jOff = j * DIM;
        let dot = 0;
        for (let d = 0; d < DIM; d++) dot += mat[iOff + d] * mat[jOff + d];
        consider(i, j, dot);
        consider(j, i, dot);
      }
    }
  }
  if (ib % (BLOCK * 16) === 0 && ib > 0) {
    const pct = ((1 - (N - ib) ** 2 / N ** 2) * 100).toFixed(0);
    console.log(`  kNN ~${pct}% (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
}
console.log(`kNN graph built in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// Symmetrize: union of directed kNN edges, dedup, keep score.
const adj: Array<Array<{ j: number; s: number }>> = Array.from({ length: N }, () => []);
const seen = new Set<number>();
let edgeCount = 0;
let crossBookEdges = 0;
for (let i = 0; i < N; i++) {
  for (let k = 0; k < K; k++) {
    const j = nbrIds[i * K + k];
    if (j < 0) continue;
    const key = i < j ? i * N + j : j * N + i;
    if (seen.has(key)) continue;
    seen.add(key);
    const s = nbrScores[i * K + k];
    adj[i].push({ j, s });
    adj[j].push({ j: i, s });
    edgeCount++;
    if (passages[i].bookId !== passages[j].bookId) crossBookEdges++;
  }
}

// --- communities: weighted label propagation ---------------------------------

const label = new Int32Array(N);
for (let i = 0; i < N; i++) label[i] = i;
const order = Array.from({ length: N }, (_, i) => i);
let changed = Infinity;
for (let iter = 0; iter < 20 && changed > Math.max(1, N * 0.001); iter++) {
  changed = 0;
  order.sort(() => rand() - 0.5);
  for (const i of order) {
    if (adj[i].length === 0) continue;
    const votes = new Map<number, number>();
    for (const { j, s } of adj[i]) votes.set(label[j], (votes.get(label[j]) || 0) + s);
    let best = label[i];
    let bestW = -Infinity;
    for (const [l, w] of votes)
      if (w > bestW || (w === bestW && l < best)) {
        bestW = w;
        best = l;
      }
    if (best !== label[i]) {
      label[i] = best;
      changed++;
    }
  }
  console.log(`  label-prop iter ${iter + 1}: ${changed} changes`);
}

const communities = new Map<number, number[]>();
for (let i = 0; i < N; i++) {
  const l = label[i];
  if (!communities.has(l)) communities.set(l, []);
  communities.get(l)!.push(i);
}
const sorted = [...communities.entries()].sort((a, b) => b[1].length - a[1].length);
const isolated = passages.filter((_, i) => adj[i].length === 0).length;

// --- centrality: weighted degree ---------------------------------------------

const centrality = new Float32Array(N);
for (let i = 0; i < N; i++) for (const { s } of adj[i]) centrality[i] += s;

// --- topic labeling: NPMI-distinctive canonical entities ----------------------

const passageText = db.prepare("SELECT text FROM passages WHERE id = ?");
const entityForPassage = db.prepare(
  `SELECT m.entity_id AS id, e.canonical_name AS name, COUNT(*) AS n
   FROM canonical_mentions m JOIN entities e ON e.id = m.entity_id
   WHERE m.passage_id = ? GROUP BY m.entity_id`,
);
const entityTotal = new Map<string, { name: string; n: number }>();
const communityEntities = new Map<number, Map<string, { name: string; n: number }>>();
for (const [l, members] of communities) {
  const m = new Map<string, { name: string; n: number }>();
  communityEntities.set(l, m);
  for (const i of members) {
    for (const row of entityForPassage.all(passages[i].id) as {
      id: string;
      name: string;
      n: number;
    }[]) {
      const cur = m.get(row.id) || { name: row.name, n: 0 };
      cur.n += 1;
      m.set(row.id, cur);
      const tot = entityTotal.get(row.id) || { name: row.name, n: 0 };
      tot.n += 1;
      entityTotal.set(row.id, tot);
    }
  }
}

function npmi(co: number, cx: number, cy: number, n: number): number {
  if (co <= 0 || cx <= 0 || cy <= 0 || n <= 0) return 0;
  const pxy = co / n;
  const pmi = Math.log(pxy / ((cx / n) * (cy / n)));
  const denom = -Math.log(pxy);
  return denom === 0 ? 1 : pmi / denom;
}

function topicLabel(l: number, size: number): string {
  const m = communityEntities.get(l)!;
  const scored = [...m.entries()]
    .filter(([, v]) => v.n >= 2)
    .map(([id, v]) => ({
      name: v.name,
      score: npmi(v.n, size, entityTotal.get(id)!.n, N),
      n: v.n,
    }))
    .sort((a, b) => b.score - a.score || b.n - a.n)
    .slice(0, 5);
  return scored.map((s) => s.name).join(", ") || "(no distinctive entities)";
}

// --- bridges: cross-book, cross-community edges -------------------------------

interface Bridge {
  i: number;
  j: number;
  s: number;
}
const bridges: Bridge[] = [];
for (let i = 0; i < N; i++) {
  for (const { j, s } of adj[i]) {
    if (i < j && passages[i].bookId !== passages[j].bookId && label[i] !== label[j]) {
      bridges.push({ i, j, s });
    }
  }
}
bridges.sort((a, b) => b.s - a.s);

// --- report -------------------------------------------------------------------

function snip(pid: string, max = 200): string {
  const t = ((passageText.get(pid) as { text: string } | undefined)?.text || "")
    .trim()
    .replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
const title = (i: number) => bookTitles.get(passages[i].bookId) || passages[i].bookId;

const lines: string[] = [];
const log = (s: string) => lines.push(s);

log(`# S0 Substrate Validation Report`);
log(``);
log(`DB: \`${DB_PATH}\` · ${N} passages · ${DIM}-d · k=${K}`);
log(``);
log(`## Graph stats`);
log(``);
log(`- Edges: ${edgeCount} (${((crossBookEdges / edgeCount) * 100).toFixed(1)}% cross-book)`);
log(
  `- Isolated passages: ${isolated} (${((isolated / N) * 100).toFixed(2)}%) — proposal expects ~0`,
);
log(
  `- Communities: ${communities.size} total; ${sorted.filter(([, m]) => m.length >= 10).length} with ≥10 passages`,
);
log(
  `- Size distribution (top 10): ${sorted
    .slice(0, 10)
    .map(([, m]) => m.length)
    .join(", ")}`,
);
log(``);
log(`## Topics (top 20 communities, labeled by NPMI-distinctive entities)`);
log(``);
for (const [l, members] of sorted.slice(0, 20)) {
  const books = new Set(members.map((i) => passages[i].bookId));
  log(`### ${topicLabel(l, members.length)}`);
  log(
    `${members.length} passages across ${books.size} book(s): ${[...books]
      .slice(0, 4)
      .map((b) => bookTitles.get(b) || b)
      .join(" · ")}`,
  );
  const central = [...members].sort((a, b) => centrality[b] - centrality[a]).slice(0, 2);
  for (const i of central) log(`> ${snip(passages[i].id)} — *${title(i)}*`);
  log(``);
}
log(`## Bridges (top 25 cross-book, cross-topic edges)`);
log(``);
for (const { i, j, s } of bridges.slice(0, 25)) {
  log(`**${s.toFixed(3)}** — *${title(i)}* ↔ *${title(j)}*`);
  log(`> ${snip(passages[i].id, 160)}`);
  log(`> ${snip(passages[j].id, 160)}`);
  log(``);
}
log(`## Most central passages (library-wide)`);
log(``);
const byCentrality = Array.from({ length: N }, (_, i) => i)
  .sort((a, b) => centrality[b] - centrality[a])
  .slice(0, 10);
for (const i of byCentrality)
  log(`- (${centrality[i].toFixed(1)}) ${snip(passages[i].id, 140)} — *${title(i)}*`);
log(``);
log(`## Verdict checklist (fill in by eyeballing the above)`);
log(``);
log(`- [ ] Topics read as coherent themes, not chapter-order artifacts`);
log(`- [ ] Multi-book topics exist (the corpus connects, not just per-book clusters)`);
log(
  `- [ ] Bridges are interesting (same idea, different worlds) not boilerplate (prefaces, acknowledgements)`,
);
log(`- [ ] Central passages are substantive, not front/back-matter noise`);

writeFileSync(OUT, lines.join("\n"));
console.log(`\nReport written to ${OUT}`);
