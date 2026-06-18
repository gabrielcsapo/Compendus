/**
 * Semantic substrate over a synthetic corpus with KNOWN geometry: three
 * idea-clusters spread across four books, so we can assert that structure
 * (kNN edges, topics, cross-book neighbors, bridges, prose filtering),
 * wander v2 stops/steps, coverage, and the curriculum sequencer behave as
 * designed — without depending on model output for anything but role
 * prototypes (which rebuildStructure embeds once).
 */
import { describe, it, expect, beforeAll } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any, books: any, passages: any, rawDb: any;
let substrate: any, wander2: any, curriculum: any;

const DIM = 384;

/** Unit vector near a basis axis with deterministic jitter. */
function vec(axis: number, jitterSeed: number): Float32Array {
  const v = new Float32Array(DIM);
  v[axis] = 1;
  let seed = jitterSeed;
  for (let i = 0; i < 8; i++) {
    seed = (seed * 9301 + 49297) % 233280;
    v[(axis + 50 + i * 7) % DIM] = (seed / 233280) * 0.25;
  }
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}

const PROSE_TEXT =
  "The long afternoon light fell across the garden while she considered what the harvest had taught her about patience and the slow accumulation of small daily efforts over many seasons of careful work.";
const NOISE_TEXT = "3. PAH, vol. 21, p. 26. 4. Ibid., p. 566. 5. ISBN 978-1-6035, pp. 12–19.";

beforeAll(async () => {
  ({ db, books, passages, rawDb } = await import("../app/lib/db"));
  substrate = await import("../app/lib/knowledge/substrate");
  wander2 = await import("../app/lib/knowledge/wander2");
  curriculum = await import("../app/lib/knowledge/curriculum");
  const { vectorToBuffer } = await import("../app/lib/knowledge/embeddings");

  // 4 books × 12 passages. Clusters: axis 0 (books A+B), axis 1 (books B+C),
  // axis 2 (books C+D). Within each book, 1 citation-noise passage.
  const bookIds = ["bk-a", "bk-b", "bk-c", "bk-d"];
  for (const id of bookIds) {
    db.insert(books)
      .values({
        id,
        filePath: `data/books/${id}.epub`,
        fileName: `${id}.epub`,
        fileSize: 1,
        fileHash: id,
        mimeType: "application/epub+zip",
        title: `Book ${id.toUpperCase()}`,
      })
      .run();
  }
  const axisFor = (book: string, i: number): number => {
    if (book === "bk-a") return 0;
    if (book === "bk-b") return i < 6 ? 0 : 1;
    if (book === "bk-c") return i < 6 ? 1 : 2;
    return 2;
  };
  let ord = 0;
  for (const book of bookIds) {
    for (let i = 0; i < 12; i++) {
      const noise = i === 11;
      const id = `${book}-p${i}`;
      db.insert(passages)
        .values({
          id,
          bookId: book,
          spineIndex: Math.floor(i / 4),
          ordinal: ord++,
          charStart: 0,
          charEnd: 200,
          text: noise ? NOISE_TEXT : `${PROSE_TEXT} (${book} ${i})`,
          tokenCount: 40,
          embedding: vectorToBuffer(vec(axisFor(book, i), ord * 17 + i)),
          embeddingModel: "test",
        })
        .run();
    }
  }
  await substrate.rebuildStructure();
}, 120_000);

describe("quantization", () => {
  it("int8 roundtrip stays within quantization error", () => {
    const v = vec(3, 99);
    const q = substrate.quantize(v);
    const back = substrate.dequantize(q.vec, q.scale);
    for (let i = 0; i < DIM; i++) expect(Math.abs(back[i] - v[i])).toBeLessThan(0.01);
  });
});

describe("structure", () => {
  it("builds a kNN graph with guaranteed cross-book neighbors", () => {
    const n = rawDb.prepare("SELECT COUNT(*) AS n FROM passage_neighbors").get().n;
    expect(n).toBeGreaterThan(0);
    // Every passage has at least one cross-book neighbor (the CROSS_K set).
    const uncovered = rawDb
      .prepare(
        `SELECT COUNT(*) AS n FROM passages p WHERE NOT EXISTS
         (SELECT 1 FROM passage_neighbors pn WHERE pn.passage_id = p.id AND pn.cross_book = 1)`,
      )
      .get().n;
    expect(uncovered).toBe(0);
  });

  it("finds the planted idea-clusters as multi-book topics", () => {
    const topics = rawDb
      .prepare("SELECT id, size, book_count AS bc FROM topics WHERE size >= 8 ORDER BY size DESC")
      .all();
    expect(topics.length).toBeGreaterThanOrEqual(3);
    expect(topics.filter((t: any) => t.bc >= 2).length).toBeGreaterThanOrEqual(3);
  });

  it("scores citation noise below prose", () => {
    const noise = rawDb
      .prepare("SELECT prose FROM passage_rank WHERE passage_id = 'bk-a-p11'")
      .get();
    const prose = rawDb
      .prepare("SELECT prose FROM passage_rank WHERE passage_id = 'bk-a-p0'")
      .get();
    expect(noise.prose).toBeLessThan(0.5);
    expect(prose.prose).toBeGreaterThanOrEqual(0.5);
  });

  it("classifies a pedagogical role for every passage", () => {
    const n = rawDb.prepare("SELECT COUNT(*) AS n FROM passage_roles").get().n;
    expect(n).toBe(48);
  });
});

describe("wander v2", () => {
  it("starts on prose and returns grounded steps", () => {
    const pid = wander2.startRandom();
    expect(pid).toBeTruthy();
    const stop = wander2.getStop(pid);
    expect(stop.text).not.toContain("ISBN");
    expect(stop.steps.length).toBeGreaterThanOrEqual(2);
    for (const s of stop.steps) {
      expect(s.passageId).toBeTruthy();
      expect(s.reason.length).toBeGreaterThan(3);
    }
    // same_idea steps must actually cross books.
    for (const s of stop.steps.filter((x: any) => x.kind === "same_idea")) {
      expect(s.bookId).not.toBe(stop.bookId);
    }
  });

  it("never offers a visited passage as a step", () => {
    const pid = wander2.startFromBook("bk-b");
    const first = wander2.getStop(pid);
    const visited = [pid, ...first.steps.map((s: any) => s.passageId)];
    const second = wander2.getStop(first.steps[0].passageId, { visited });
    for (const s of second.steps) expect(visited).not.toContain(s.passageId);
  });

  it("records coverage when a profile wanders", () => {
    rawDb
      .prepare(
        "INSERT OR IGNORE INTO profiles (id, name, created_at, updated_at) VALUES ('prof-1','Test',unixepoch(),unixepoch())",
      )
      .run();
    const pid = wander2.startFromBook("bk-a");
    wander2.getStop(pid, { profileId: "prof-1" });
    const seen = rawDb
      .prepare("SELECT COUNT(*) AS n FROM passage_seen WHERE profile_id = 'prof-1'")
      .get().n;
    expect(seen).toBe(1);
    const topicId = rawDb
      .prepare("SELECT topic_id AS t FROM passage_topics WHERE passage_id = ?")
      .get(pid)?.t;
    if (topicId) {
      const cov = substrate.topicCoverage("prof-1", topicId);
      expect(cov.seen).toBeGreaterThanOrEqual(1);
      expect(cov.total).toBeGreaterThanOrEqual(cov.seen);
    }
  });
});

describe("curriculum (Tier A)", () => {
  it("builds a sequenced, book-alternating study path with transitions", () => {
    const topic = rawDb
      .prepare(
        "SELECT id FROM topics WHERE size >= 8 AND book_count >= 2 ORDER BY size DESC LIMIT 1",
      )
      .get();
    expect(topic).toBeTruthy();
    const cur = curriculum.buildCurriculum(topic.id, "prof-1");
    expect(cur).toBeTruthy();
    expect(cur.items.length).toBeGreaterThanOrEqual(6);
    // Ordinals sequential from 1; every item carries a transition + module.
    cur.items.forEach((item: any, i: number) => {
      expect(item.ordinal).toBe(i + 1);
      expect(item.transition.length).toBeGreaterThan(5);
      expect(item.module).toMatch(/^Part \d+$/);
    });
    // Multi-book topic ⇒ the sequence must actually alternate books.
    const switches = cur.items.filter(
      (item: any, i: number) => i > 0 && item.bookId !== cur.items[i - 1].bookId,
    ).length;
    expect(switches).toBeGreaterThanOrEqual(1);
    // No citation noise in a study path.
    for (const item of cur.items) expect(item.snippet).not.toContain("ISBN");
    // Second call reuses the cached skeleton (same id).
    const again = curriculum.buildCurriculum(topic.id);
    expect(again.id).toBe(cur.id);
  });
});

describe("fabric reembed apply", () => {
  it("writes worker-returned vectors into the substrate under the worker's model id", async () => {
    const fabric = await import("../app/lib/fabric");
    await import("../app/lib/fabric/kinds");
    const { device } = fabric.enrollDevice({
      name: "test-fleet",
      platform: "macos",
      capabilities: { runtimes: ["onnx-embed"] },
    });
    const ps = rawDb
      .prepare("SELECT id, text FROM passages WHERE book_id = 'bk-a' ORDER BY ordinal LIMIT 4")
      .all();
    const { item } = fabric.enqueueWork({
      project: "compendus",
      kind: "reembed-book",
      payload: {
        bookId: "bk-a",
        model: "new-model/v2",
        passageIds: ps.map((r: { id: string }) => r.id),
      },
      requirements: { runtimes: ["onnx-embed"] },
    });
    const leased = fabric.leaseWork(device.id, { runtimes: ["onnx-embed"] });
    expect(leased.id).toBe(item.id);

    // Simulate the fleet worker: quantized vectors for each passage.
    const dim = 64;
    const bytes = Buffer.alloc(ps.length * dim);
    const scales: number[] = [];
    for (let i = 0; i < ps.length; i++) {
      scales.push(1 / 127);
      bytes.writeInt8(127, i * dim + i); // distinct axis per passage
    }
    const out = await fabric.completeWork({
      id: item.id,
      deviceId: device.id,
      result: { count: ps.length, dim, vectorsB64: bytes.toString("base64"), scales },
      modelId: "new-model/v2",
    });
    expect(out.ok).toBe(true);

    const row = rawDb
      .prepare("SELECT model FROM embeddings WHERE kind = 'passage' AND ref_id = ?")
      .get(ps[0].id);
    expect(row.model).toBe("new-model/v2");
    const v = substrate.getEmbedding("passage", ps[0].id);
    expect(v.length).toBe(dim);
    expect(v[0]).toBeCloseTo(1, 1);
  });

  it("rejects a count-mismatched reembed result", async () => {
    const fabric = await import("../app/lib/fabric");
    const def = fabric.getKind("reembed-book");
    const verdict = def.validate(
      { bookId: "bk-a", passageIds: ["x"] },
      { count: 2, dim: 64, vectorsB64: Buffer.alloc(128).toString("base64"), scales: [0.1, 0.1] },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.error).toMatch(/count mismatch/);
  });
});

describe("legacy promotion is order-independent", () => {
  it("re-includes books whose vectors are only in passages.embedding", async () => {
    // Simulate the live-deploy bug: substrate table has SOME books (here: all
    // but bk-d), while bk-d has only legacy f32 embeddings.
    rawDb
      .prepare(
        "DELETE FROM embeddings WHERE kind = 'passage' AND ref_id IN (SELECT id FROM passages WHERE book_id = 'bk-d')",
      )
      .run();
    const before = rawDb
      .prepare("SELECT COUNT(*) AS n FROM embeddings WHERE kind = 'passage'")
      .get().n;
    const corpus = substrate.loadCorpusVectors();
    expect(corpus.ids.length).toBeGreaterThan(before);
    expect(corpus.bookIds).toContain("bk-d");
    const after = rawDb
      .prepare("SELECT COUNT(*) AS n FROM embeddings WHERE kind = 'passage'")
      .get().n;
    expect(after).toBe(48);
  });
});

describe("incremental linking", () => {
  it("ANN-links a new book without re-querying or wiping the existing graph", async () => {
    const { vectorToBuffer } = await import("../app/lib/knowledge/embeddings");
    // Existing graph snapshot: which passages have neighbor rows, and how many.
    const before = rawDb.prepare("SELECT COUNT(*) AS n FROM passage_neighbors").get().n;
    const bkARows = rawDb
      .prepare("SELECT COUNT(*) AS n FROM passage_neighbors WHERE passage_id LIKE 'bk-a-%'")
      .get().n;
    expect(before).toBeGreaterThan(0);

    // A 5th book in the axis-2 cluster (joins bk-c/bk-d's idea).
    db.insert(books)
      .values({
        id: "bk-e",
        filePath: "data/books/bk-e.epub",
        fileName: "bk-e.epub",
        fileSize: 1,
        fileHash: "bk-e",
        mimeType: "application/epub+zip",
        title: "Book E",
      })
      .run();
    let ord = 1000;
    for (let i = 0; i < 12; i++) {
      db.insert(passages)
        .values({
          id: `bk-e-p${i}`,
          bookId: "bk-e",
          spineIndex: Math.floor(i / 4),
          ordinal: ord++,
          charStart: 0,
          charEnd: 200,
          text: i === 11 ? NOISE_TEXT : `${PROSE_TEXT} (bk-e ${i})`,
          tokenCount: 40,
          embedding: vectorToBuffer(vec(2, ord * 17 + i)),
          embeddingModel: "test",
        })
        .run();
    }

    await substrate.rebuildStructure();

    // The new book is linked…
    const bkE = rawDb
      .prepare("SELECT COUNT(*) AS n FROM passage_neighbors WHERE passage_id LIKE 'bk-e-%'")
      .get().n;
    expect(bkE).toBeGreaterThan(0);
    // …its passages keep the cross-book invariant…
    const uncoveredE = rawDb
      .prepare(
        `SELECT COUNT(*) AS n FROM passages p WHERE p.book_id = 'bk-e' AND NOT EXISTS
         (SELECT 1 FROM passage_neighbors pn WHERE pn.passage_id = p.id AND pn.cross_book = 1)`,
      )
      .get().n;
    expect(uncoveredE).toBe(0);
    // …the existing graph was reused, not wiped (bk-a rows unchanged, total grew).
    const bkAAfter = rawDb
      .prepare("SELECT COUNT(*) AS n FROM passage_neighbors WHERE passage_id LIKE 'bk-a-%'")
      .get().n;
    expect(bkAAfter).toBe(bkARows);
    expect(rawDb.prepare("SELECT COUNT(*) AS n FROM passage_neighbors").get().n).toBeGreaterThan(
      before,
    );
    // …and the global downstream still covers every passage.
    expect(rawDb.prepare("SELECT COUNT(*) AS n FROM passage_rank").get().n).toBe(60);
    expect(rawDb.prepare("SELECT COUNT(*) AS n FROM passage_roles").get().n).toBe(60);
    expect(
      rawDb.prepare("SELECT COUNT(*) AS n FROM passage_topics WHERE passage_id LIKE 'bk-e-%'").get()
        .n,
    ).toBe(12);
  });
});
