/**
 * Recall/memory/CPU tradeoff sweep at fixed N, to fix the poor i8 recall seen
 * in bench-incremental-substrate.mjs. Compares quantization (i8/f16/f32) ×
 * HNSW search expansion (ef). Exact brute-force ground truth.
 *
 *   node scripts/bench-recall-tradeoff.mjs [n]
 */
import usearch from "usearch";
const { Index, MetricKind, ScalarKind } = usearch;

const DIM = 384;
const KNN_K = 12;
const N = Number(process.argv[2] || 100000);
const N_CENTROIDS = 400;
const NOISE = 0.55;
const fmt = (n) => n.toLocaleString("en-US");

let seed = 0x1234567;
const rand = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) % 1_000_000) / 1_000_000;
};
const gauss = () =>
  Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-9))) * Math.cos(2 * Math.PI * rand());

const centroids = [];
for (let c = 0; c < N_CENTROIDS; c++) {
  const v = new Float32Array(DIM);
  let nr = 0;
  for (let d = 0; d < DIM; d++) {
    v[d] = gauss();
    nr += v[d] * v[d];
  }
  nr = Math.sqrt(nr) || 1;
  for (let d = 0; d < DIM; d++) v[d] /= nr;
  centroids.push(v);
}
// shared corpus (f32) — built once, reused across configs
console.log(`building corpus n=${fmt(N)} dim=${DIM}...`);
const all = new Float32Array(N * DIM);
for (let i = 0; i < N; i++) {
  const base = centroids[Math.floor((i / 50) % N_CENTROIDS)];
  let nr = 0;
  const o = i * DIM;
  for (let d = 0; d < DIM; d++) {
    const x = base[d] + NOISE * gauss();
    all[o + d] = x;
    nr += x * x;
  }
  nr = Math.sqrt(nr) || 1;
  for (let d = 0; d < DIM; d++) all[o + d] /= nr;
}

// exact ground-truth top-K for a fixed query sample
const PROBE = 200;
const queries = [];
for (let q = 0; q < PROBE; q++) queries.push(Math.floor(rand() * N));
console.log(`computing exact ground truth for ${PROBE} queries...`);
const truth = [];
for (const qi of queries) {
  const qo = qi * DIM;
  const scored = new Array(N);
  for (let s = 0; s < N; s++) {
    let dot = 0;
    const o = s * DIM;
    for (let d = 0; d < DIM; d++) dot += all[qo + d] * all[o + d];
    scored[s] = [s, dot];
  }
  scored.sort((a, b) => b[1] - a[1]);
  truth.push(new Set(scored.slice(0, KNN_K).map((x) => x[0])));
}

const baseRss = process.memoryUsage().rss / 1048576;
const configs = [
  { q: ScalarKind.I8, ea: 128, es: 64, label: "i8  ef_add=128 ef_search=64" },
  { q: ScalarKind.I8, ea: 200, es: 256, label: "i8  ef_add=200 ef_search=256" },
  { q: ScalarKind.F16, ea: 128, es: 64, label: "f16 ef_add=128 ef_search=64" },
  { q: ScalarKind.F16, ea: 200, es: 256, label: "f16 ef_add=200 ef_search=256" },
  { q: ScalarKind.F32, ea: 128, es: 64, label: "f32 ef_add=128 ef_search=64 (current code)" },
  { q: ScalarKind.F32, ea: 200, es: 256, label: "f32 ef_add=200 ef_search=256" },
];

console.log(
  `\n${"config".padEnd(44)}${"build(s)".padStart(9)}${"recall@12".padStart(11)}${"idxRSS(MB)".padStart(12)}${"query(ms)".padStart(11)}`,
);
for (const cfg of configs) {
  global.gc?.();
  const ix = new Index({
    metricKind: MetricKind.Cos,
    dimensions: DIM,
    connectivity: 16,
    quantization: cfg.q,
    expansion_add: cfg.ea,
    expansion_search: cfg.es,
  });
  const t0 = performance.now();
  const tmp = new Float32Array(DIM);
  for (let i = 0; i < N; i++) {
    tmp.set(all.subarray(i * DIM, i * DIM + DIM));
    ix.add(BigInt(i), tmp);
  }
  const buildS = (performance.now() - t0) / 1000;
  const idxRss = process.memoryUsage().rss / 1048576 - baseRss;

  let hit = 0,
    tot = 0;
  const tq0 = performance.now();
  for (let q = 0; q < PROBE; q++) {
    tmp.set(all.subarray(queries[q] * DIM, queries[q] * DIM + DIM));
    const r = ix.search(tmp, KNN_K);
    const keys = Array.from(r.keys).map((k) => Number(k));
    for (const k of keys) {
      if (truth[q].has(k)) hit++;
    }
    tot += KNN_K;
  }
  const queryMs = (performance.now() - tq0) / PROBE;
  console.log(
    cfg.label.padEnd(44) +
      buildS.toFixed(1).padStart(9) +
      `${((100 * hit) / tot).toFixed(1)}%`.padStart(11) +
      idxRss.toFixed(0).padStart(12) +
      queryMs.toFixed(2).padStart(11),
  );
}
console.log(
  `\nidxRSS is incremental over a ${baseRss.toFixed(0)}MB baseline (corpus f32 held for ground truth).`,
);
console.log(`Extrapolate idxRSS ×${(1950000 / N).toFixed(1)} for 3k books (1.95M passages).`);
