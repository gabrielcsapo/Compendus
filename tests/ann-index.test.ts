/**
 * ANN index (usearch HNSW) — the substrate's scale unlock. Verifies the
 * stateless labeling, delta-sync persistence, and that index queries agree
 * with exact brute force on a corpus with known geometry.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let ann: typeof import("../app/lib/knowledge/ann-index");
let dataDir: string;

const DIM = 16;

function vec(axis: number, jitter = 0): Float32Array {
  const v = new Float32Array(DIM);
  v[axis % DIM] = 1;
  if (jitter) v[(axis + 3) % DIM] = jitter;
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}

function corpus(ids: string[], axes: number[]) {
  const mat = new Float32Array(ids.length * DIM);
  ids.forEach((_, i) => mat.set(vec(axes[i], 0.05 * (i + 1)), i * DIM));
  return {
    ids,
    bookIds: ids.map((_, i) => `bk-${i % 2}`),
    mat,
    dim: DIM,
    index: new Map(ids.map((id, i) => [id, i])),
    rowF32: (i: number) => mat.slice(i * DIM, (i + 1) * DIM),
  };
}

const IDS = [
  "aaaaaaaa-1111-4000-8000-000000000001",
  "bbbbbbbb-2222-4000-8000-000000000002",
  "cccccccc-3333-4000-8000-000000000003",
  "dddddddd-4444-4000-8000-000000000004",
];

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "ann-test-"));
  process.env.COMPENDUS_DATA_DIR = dataDir;
  ann = await import("../app/lib/knowledge/ann-index");
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("ann-index", () => {
  it("labels are stable, distinct, and derived from the id alone", () => {
    expect(ann.labelOf(IDS[0])).toBe(ann.labelOf(IDS[0]));
    expect(ann.labelOf(IDS[0])).not.toBe(ann.labelOf(IDS[1]));
    expect(ann.labelOf("aaaaaaaa-1111-4000-8000-ffffffffffff")).toBe(ann.labelOf(IDS[0])); // first 16 hex chars only
  });

  it("usearch native module is available on this platform", () => {
    expect(ann.annAvailable()).toBe(true);
  });

  it("sync + search round-trips and persists the index file", () => {
    const c = corpus(IDS, [0, 0, 5, 9]);
    const handle = ann.syncAnnIndex(c as never);
    expect(handle).not.toBeNull();
    expect(Number(handle!.index.size())).toBe(4);

    // Nearest neighbor of row 0 (axis 0) must be row 1 (also axis 0).
    const res = handle!.index.search(c.mat.subarray(0, DIM), 3);
    const rows = [...res.keys].map((k: bigint) => handle!.rowOf.get(k));
    expect(rows[0]).toBe(0); // itself first
    expect(rows).toContain(1);

    // Persisted on disk for the next rebuild.
    expect(existsSync(join(dataDir, "substrate-ann", "passages-i8.usearch"))).toBe(true);
  });

  it("delta-sync adds only new passages; dead labels resolve to nothing", () => {
    // Same corpus plus one new passage; one old id dropped (re-analyzed book).
    const ids2 = [IDS[0], IDS[1], IDS[3], "eeeeeeee-5555-4000-8000-000000000005"];
    const c2 = corpus(ids2, [0, 0, 9, 12]);
    const handle = ann.syncAnnIndex(c2 as never);
    expect(handle).not.toBeNull();
    // Index retains the dead label (IDS[2]) until compaction…
    expect(Number(handle!.index.size())).toBe(5);
    // …but it resolves to no corpus row.
    expect(handle!.rowOf.has(ann.labelOf(IDS[2]))).toBe(false);
    expect(handle!.rowOf.size).toBe(4);
  });
});
