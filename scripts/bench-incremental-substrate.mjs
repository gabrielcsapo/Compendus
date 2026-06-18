/**
 * Benchmark: incremental substrate vs. global rebuild, at low-spec / 3k-book scale.
 *
 * Answers: does the proposed incremental insert path (HNSW delta-add + query
 * ONLY the new book) stay flat as the library grows to ~3k books (~2M
 * passages), where the current global rebuild (re-query everyone + recompute
 * communities/centrality/bridges/prose/roles over all N) pins both cores and
 * locks up the 2-vCPU deploy box?
 *
 * Uses the REAL `usearch` dependency the code uses (ann-index.ts), with i8
 * quantization (the low-spec memory path). Runs single-threaded so it does not
 * pin the host it benchmarks on. Clustered vectors mimic a real library
 * (books fall into latent topics), which is also the FAIR case for ANN recall.
 *
 *   node scripts/bench-incremental-substrate.mjs [targetBooks] [bookSize]
 */
import usearch from "usearch";

const { Index, MetricKind, ScalarKind, exactSearch } = usearch;

const DIM = 384;
const CONNECTIVITY = 16; // matches ann-index.ts
const KNN_K = 12; // matches substrate.ts KNN_K
const TARGET_BOOKS = Number(process.argv[2] || 3000);
const BOOK_SIZE = Number(process.argv[3] || 650); // ~passages per book
const N_CENTROIDS = 400; // latent "topics" the library clusters into

const TARGET_N = TARGET_BOOKS * BOOK_SIZE;
const fmt = (n) => n.toLocaleString("en-US");
const ms = (t) => `${t.toFixed(1)}ms`;
const rssMB = () => (process.memoryUsage().rss / 1048576).toFixed(0);

// --- deterministic PRNG (no Math.random; reproducible) -----------------------
let seed = 0x9e3779b9;
function rand() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) % 1_000_000) / 1_000_000;
}
function gauss() {
  // Box-Muller
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// latent topic centroids (unit vectors)
const centroids = [];
for (let c = 0; c < N_CENTROIDS; c++) {
  const v = new Float32Array(DIM);
  let nrm = 0;
  for (let d = 0; d < DIM; d++) {
    v[d] = gauss();
    nrm += v[d] * v[d];
  }
  nrm = Math.sqrt(nrm) || 1;
  for (let d = 0; d < DIM; d++) v[d] /= nrm;
  centroids.push(v);
}

// a passage = normalize(centroid + noise). Returns f32.
const NOISE = 0.55;
function makeVec(topic) {
  const base = centroids[topic];
  const v = new Float32Array(DIM);
  let nrm = 0;
  for (let d = 0; d < DIM; d++) {
    v[d] = base[d] + NOISE * gauss();
    nrm += v[d] * v[d];
  }
  nrm = Math.sqrt(nrm) || 1;
  for (let d = 0; d < DIM; d++) v[d] /= nrm;
  return v;
}

// --- the index under test (i8-quantized HNSW, single-threaded) ---------------
const index = new Index({
  metricKind: MetricKind.Cos,
  dimensions: DIM,
  connectivity: CONNECTIVITY,
  quantization: ScalarKind.I8,
});

// reservoir of (key, f32 vec) kept for recall ground-truth + global-requery sample
const SAMPLE = 1500;
const sampleKeys = new BigInt64Array(SAMPLE);
const sampleVecs = new Float32Array(SAMPLE * DIM);
let sampleFilled = 0;

let nextKey = 1n;
let totalAddMs = 0;

function addBook(topicBias) {
  const t0 = performance.now();
  const newVecs = [];
  for (let i = 0; i < BOOK_SIZE; i++) {
    // a book draws mostly from a few topics (cohesion) + occasional spread
    const topic =
      rand() < 0.85
        ? (topicBias + (rand() < 0.5 ? 0 : 1)) % N_CENTROIDS
        : Math.floor(rand() * N_CENTROIDS);
    const v = makeVec(topic);
    const key = nextKey++;
    index.add(key, v);
    newVecs.push({ key, v });
  }
  // INCREMENTAL: query top-K for ONLY the new passages (their neighbor rows)
  for (const { v } of newVecs) index.search(v, KNN_K);
  const addMs = performance.now() - t0;
  totalAddMs += addMs;

  // keep a few in the reservoir (for recall + global-requery sample)
  for (const { key, v } of newVecs) {
    if (sampleFilled < SAMPLE) {
      sampleKeys[sampleFilled] = key;
      sampleVecs.set(v, sampleFilled * DIM);
      sampleFilled++;
    } else if (rand() < 0.02) {
      const idx = Math.floor(rand() * SAMPLE);
      sampleKeys[idx] = key;
      sampleVecs.set(v, idx * DIM);
    }
  }
  return addMs;
}

// simulate the CURRENT global rebuild's kNN re-query: it searches top-K for
// EVERY passage in the corpus. Measure cost on a sample, scale to full N.
function globalRequeryEstMs(n) {
  const probe = Math.min(SAMPLE, sampleFilled);
  if (probe === 0) return 0;
  const t0 = performance.now();
  const tmp = new Float32Array(DIM);
  for (let s = 0; s < probe; s++) {
    tmp.set(sampleVecs.subarray(s * DIM, s * DIM + DIM));
    index.search(tmp, KNN_K);
  }
  const perQuery = (performance.now() - t0) / probe;
  return perQuery * n; // current rebuild queries ALL n
}

console.log(
  `\n=== incremental substrate bench === target ${fmt(TARGET_BOOKS)} books × ${BOOK_SIZE} = ${fmt(TARGET_N)} passages`,
);
console.log(
  `dim=${DIM} connectivity=${CONNECTIVITY} k=${KNN_K} quant=i8 threads=1 (low-spec sim)\n`,
);
console.log(
  ["books", "passages", "addBook(ms)", "perPsg(ms)", "globalRequery(est)", "rss(MB)"]
    .map((h) => h.padStart(13))
    .join(""),
);

const checkpoints = new Set();
for (let b = 50; b <= TARGET_BOOKS; b = Math.ceil(b * 1.6)) checkpoints.add(b);
checkpoints.add(TARGET_BOOKS);

let lastAddMs = 0;
for (let book = 1; book <= TARGET_BOOKS; book++) {
  lastAddMs = addBook((book * 7) % N_CENTROIDS);
  if (checkpoints.has(book)) {
    const n = book * BOOK_SIZE;
    const gr = globalRequeryEstMs(n);
    const grStr =
      gr > 60000
        ? `${(gr / 60000).toFixed(1)}min`
        : gr > 1000
          ? `${(gr / 1000).toFixed(1)}s`
          : ms(gr);
    console.log(
      [fmt(book), fmt(n), lastAddMs.toFixed(0), (lastAddMs / BOOK_SIZE).toFixed(3), grStr, rssMB()]
        .map((c) => String(c).padStart(13))
        .join(""),
    );
  }
}

// --- recall@K: dedicated test at moderate scale, EXACT ground truth ----------
// Separate fresh index that retains ALL vectors so we can brute-force the true
// top-K. Kept apart from the main scaling run so that run's RSS stays index-only.
function recallTest(n) {
  const ix = new Index({
    metricKind: MetricKind.Cos,
    dimensions: DIM,
    connectivity: CONNECTIVITY,
    quantization: ScalarKind.I8,
  });
  const all = new Float32Array(n * DIM);
  for (let i = 0; i < n; i++) {
    const v = makeVec(Math.floor((i / 50) % N_CENTROIDS));
    all.set(v, i * DIM);
    ix.add(BigInt(i + 1), v);
  }
  const probe = 200;
  const tmp = new Float32Array(DIM);
  let hit = 0;
  let tot = 0;
  for (let q = 0; q < probe; q++) {
    const qi = Math.floor(rand() * n);
    tmp.set(all.subarray(qi * DIM, qi * DIM + DIM));
    const approx = ix.search(tmp, KNN_K);
    const approxKeys = new Set(Array.from(approx.keys).map((k) => Number(k)));
    // exact top-K over ALL n
    const scored = new Array(n);
    for (let s = 0; s < n; s++) {
      let dot = 0;
      const o = s * DIM;
      for (let d = 0; d < DIM; d++) dot += tmp[d] * all[o + d];
      scored[s] = [s + 1, dot];
    }
    scored.sort((a, b) => b[1] - a[1]);
    for (let r = 0; r < KNN_K; r++) {
      tot++;
      if (approxKeys.has(scored[r][0])) hit++;
    }
  }
  return (100 * hit) / tot;
}

console.log("\n--- recall@12 (HNSW i8 vs EXACT brute force) ---");
for (const rn of [20000, 100000]) {
  const r = recallTest(rn);
  console.log(`  n=${fmt(rn).padStart(9)}:  recall@12 = ${r.toFixed(1)}%`);
}

console.log("\n--- summary ---");
console.log(`indexed:            ${fmt(Number(index.size()))} vectors`);
console.log(`total add time:     ${(totalAddMs / 1000).toFixed(1)}s  (incremental, single-thread)`);
console.log(`avg per book:       ${(totalAddMs / TARGET_BOOKS).toFixed(0)}ms`);
console.log(`peak RSS:           ${rssMB()} MB`);
console.log(`\nINTERPRETATION: 'addBook(ms)' is the proposed incremental hot-path cost.`);
console.log(`If it stays ~flat while 'globalRequery(est)' grows with N, the incremental`);
console.log(`path is what lets a 2-vCPU box reach ${fmt(TARGET_BOOKS)} books without the lockup.`);
