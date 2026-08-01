/**
 * Pairwise cosine candidate generation over canonical concept embeddings —
 * shared by the lg-graph-worker (production) and the inline dev fallback.
 * O(n²/2) over a flat pre-normalized matrix; minutes of pinned CPU at tens of
 * thousands of concepts, so production always runs it in the worker.
 */
import { rawDb } from "../db";
import { kindsCompatible, type CandidatePair } from "./reconcile";
import { ensureLgTables } from "./schema";

export function inlineKnnCandidates(
  threshold: number,
  maxPairs: number,
  onProgress?: (done: number, total: number, pairs: number) => void,
): { pairs: CandidatePair[]; truncated: boolean } {
  ensureLgTables();
  const rows = rawDb
    .prepare(
      "SELECT id, label, kind, df, embedding AS emb FROM lg_concepts WHERE merged_into IS NULL AND embedding IS NOT NULL",
    )
    .all() as Array<{ id: string; label: string; kind: string; df: number; emb: Buffer }>;
  const n = rows.length;
  const dim = n > 0 ? rows[0].emb.length / 4 : 0;

  // Flat pre-normalized matrix: cosine = dot.
  const mat = new Float32Array(n * dim);
  for (let i = 0; i < n; i++) {
    const b = rows[i].emb;
    let norm = 0;
    for (let d = 0; d < dim; d++) {
      const v = b.readFloatLE(d * 4);
      mat[i * dim + d] = v;
      norm += v * v;
    }
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < dim; d++) mat[i * dim + d] /= norm;
  }

  const pairs: CandidatePair[] = [];
  const progressEvery = Math.max(1, Math.floor(n / 20));
  for (let i = 0; i < n; i++) {
    const a = rows[i];
    for (let j = i + 1; j < n; j++) {
      const b = rows[j];
      if (!kindsCompatible(a.kind, b.kind)) continue;
      let dot = 0;
      const ai = i * dim;
      const bj = j * dim;
      for (let d = 0; d < dim; d++) dot += mat[ai + d] * mat[bj + d];
      if (dot >= threshold) {
        pairs.push({
          aId: a.id,
          bId: b.id,
          aLabel: a.label,
          bLabel: b.label,
          aKind: a.kind,
          bKind: b.kind,
          aDf: a.df,
          bDf: b.df,
          sim: dot,
        });
      }
    }
    if (i % progressEvery === 0) onProgress?.(i, n, pairs.length);
  }
  pairs.sort((x, y) => y.sim - x.sim);
  const truncated = pairs.length > maxPairs;
  return { pairs: truncated ? pairs.slice(0, maxPairs) : pairs, truncated };
}
