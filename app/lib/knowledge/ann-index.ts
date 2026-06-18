/**
 * Approximate-nearest-neighbor index for the substrate's kNN graph — the
 * scale unlock past the brute-force O(N²) wall (~180k passages, hours of CPU).
 *
 * HNSW via `usearch` (prebuilt N-API binaries for darwin/linux — no toolchain
 * in the container). The index lives ONLY inside the rebuild path (worker
 * thread in production): each rebuild loads the persisted index, inserts the
 * delta of passages embedded since the last save, persists, then answers the
 * kNN graph with N·O(log N) queries instead of N²/2 dot products.
 *
 * Labels are STATELESS: the first 8 bytes of the passage UUID (hex) as a
 * 64-bit key. No mapping table — each rebuild reconstructs label→row from the
 * corpus in memory; labels of since-deleted passages simply fail to resolve
 * and are filtered out of results. When dead labels outnumber a threshold the
 * index is rebuilt from scratch (cheap relative to a structure rebuild).
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import type { CorpusVectors } from "./substrate";

const nodeRequire = createRequire(import.meta.url);

export const ANN_MIN_PASSAGES = 20_000; // below this, exact brute force is fast enough
const DEAD_LABEL_REBUILD_RATIO = 1.4; // index entries / live passages before a from-scratch rebuild

function annPath(): string {
  const dataDir = process.env.COMPENDUS_DATA_DIR || resolve(process.cwd(), "data");
  // `-i8` version tag: the index is now i8-quantized (¼ the RAM of the old f32
  // index — ~95MB vs ~370MB at 240k passages, the difference between fitting
  // the 6GB box and swapping). An f32 index on disk under the old name is
  // simply ignored; a fresh i8 index builds from the corpus on first sync.
  return join(dataDir, "substrate-ann", "passages-i8.usearch");
}

/** 64-bit label from a passage UUID: first 16 hex chars. Stable, stateless. */
export function labelOf(passageId: string): bigint {
  const hex = passageId.replace(/-/g, "").slice(0, 16);
  return BigInt(`0x${hex}`);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let usearchMod: any | null | undefined;

function loadUsearch(): any | null {
  if (usearchMod !== undefined) return usearchMod;
  try {
    usearchMod = nodeRequire("usearch");
  } catch {
    usearchMod = null; // native module unavailable — callers fall back to brute force
  }
  return usearchMod;
}

export function annAvailable(): boolean {
  return loadUsearch() !== null;
}

export interface AnnHandle {
  index: any;
  /** corpus row for each live label (deleted passages absent). */
  rowOf: Map<bigint, number>;
}

/**
 * Load (or create) the persisted index and bring it up to date with the
 * corpus: insert every passage not yet present. Returns null when usearch is
 * unavailable. Rebuilds from scratch when dead labels have accumulated past
 * the threshold (re-analyzed books leave their old passage labels behind).
 */
export function syncAnnIndex(c: CorpusVectors, log?: (m: string) => void): AnnHandle | null {
  const u = loadUsearch();
  if (!u) return null;
  const path = annPath();
  mkdirSync(dirname(path), { recursive: true });

  // i8 quantization: ~¼ the resident memory of f32 with ~95% recall@12 on real
  // sentence embeddings (validated — they live on a low-dim manifold, the easy
  // case for ANN). expansion_search=64 is enough for that recall; raising it
  // buys little. expansion_add=128 keeps graph quality on insert.
  const fresh = () =>
    new u.Index({
      metricKind: u.MetricKind.Cos,
      dimensions: c.dim,
      connectivity: 16,
      quantization: u.ScalarKind.I8,
      expansion_add: 128,
      expansion_search: 64,
    });
  let index = fresh();
  if (existsSync(path)) {
    try {
      index.load(path);
    } catch {
      log?.("ann: persisted index unreadable — rebuilding from scratch");
      rmSync(path, { force: true });
      index = fresh();
    }
  }

  const n = c.ids.length;
  if (Number(index.size()) > n * DEAD_LABEL_REBUILD_RATIO) {
    log?.(`ann: ${index.size()} entries vs ${n} live passages — compacting from scratch`);
    rmSync(path, { force: true });
    index = fresh();
  }

  const rowOf = new Map<bigint, number>();
  let added = 0;
  for (let i = 0; i < n; i++) {
    const label = labelOf(c.ids[i]);
    if (rowOf.has(label)) continue; // 64-bit collision — astronomically rare; keep first
    rowOf.set(label, i);
    if (!index.contains(label)) {
      index.add(label, c.rowF32(i));
      added++;
      if (added % 20_000 === 0) log?.(`ann: indexed ${added} new passages…`);
    }
  }
  if (added > 0) {
    index.save(path);
    log?.(`ann: +${added} passages indexed (${index.size()} total) — saved`);
  }
  return { index, rowOf };
}
