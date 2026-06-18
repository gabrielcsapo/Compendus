/**
 * Concept graph → topics. Community detection runs over the CONCEPT graph
 * (~thousands of nodes), not the passage graph (~millions), so the "rebuild"
 * that melted the box at the passage level is here a sub-second pass over a few
 * MB. NPMI is computed on read from the raw co-occurrence + df counts that
 * ingest maintains incrementally.
 */
import { randomUUID } from "node:crypto";
import { rawDb, db } from "../db";

const MIN_DF = 2; // drop hapax concepts from topic detection

/** Positive-NPMI concept adjacency over concepts with df >= MIN_DF. */
function loadGraph(): {
  nodes: string[];
  adj: Map<string, { j: string; w: number }[]>;
  df: Map<string, number>;
} {
  const N =
    (rawDb.prepare("SELECT COUNT(*) AS n FROM cs_passage_salience").get() as { n: number }).n || 1;
  const df = new Map<string, number>();
  for (const r of rawDb.prepare("SELECT id, df FROM cs_concepts WHERE df >= ?").all(MIN_DF) as {
    id: string;
    df: number;
  }[])
    df.set(r.id, r.df);

  const adj = new Map<string, { j: string; w: number }[]>();
  const push = (a: string, b: string, w: number) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ j: b, w });
  };
  // Co-occurrence is derived ON DEMAND from cs_passage_concepts (a streamed
  // self-join), not from a persisted edge table — that table's incremental
  // upkeep is what bloated to 4.5M rows and wedged the box. Restricting both
  // sides to df >= MIN_DF and keeping only cooccur >= 2 bounds the work to the
  // concepts that actually form topics.
  const cooc = rawDb.prepare(
    `SELECT pa.concept_id AS a, pb.concept_id AS b, COUNT(*) AS co
     FROM cs_passage_concepts pa
     JOIN cs_passage_concepts pb ON pb.passage_id = pa.passage_id AND pb.concept_id > pa.concept_id
     JOIN cs_concepts ca ON ca.id = pa.concept_id AND ca.df >= ?
     JOIN cs_concepts cb ON cb.id = pb.concept_id AND cb.df >= ?
     GROUP BY pa.concept_id, pb.concept_id HAVING co >= 2`,
  );
  for (const e of cooc.iterate(MIN_DF, MIN_DF) as Iterable<{ a: string; b: string; co: number }>) {
    const da = df.get(e.a);
    const db_ = df.get(e.b);
    if (!da || !db_) continue;
    const pab = e.co / N;
    const npmi = Math.log(pab / ((da / N) * (db_ / N))) / -Math.log(pab);
    if (npmi > 0) {
      push(e.a, e.b, npmi);
      push(e.b, e.a, npmi);
    }
  }
  return { nodes: [...df.keys()], adj, df };
}

/** Weighted label propagation — deterministic seed for reproducibility. */
function labelProp(
  nodes: string[],
  adj: Map<string, { j: string; w: number }[]>,
): Map<string, string> {
  const label = new Map(nodes.map((n) => [n, n]));
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let iter = 0; iter < 20; iter++) {
    let changed = 0;
    const order = [...nodes].sort(() => rand() - 0.5);
    for (const i of order) {
      const votes = new Map<string, number>();
      for (const { j, w } of adj.get(i) ?? []) {
        const l = label.get(j)!;
        votes.set(l, (votes.get(l) ?? 0) + w);
      }
      if (!votes.size) continue;
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
    if (changed <= nodes.length * 0.001) break;
  }
  return label;
}

export interface TopicStats {
  topics: number;
  conceptsClustered: number;
}

/** Rebuild concept communities → cs_concept_topics, cs_passage_topics, cs_topics. */
export function rebuildTopics(log?: (m: string) => void): TopicStats {
  const { nodes, adj, df } = loadGraph();
  log?.(`concept topics: ${nodes.length} concepts, label propagation`);
  const label = labelProp(nodes, adj);

  // group concepts by community → assign a stable topic id, label by top-df concepts
  const byLabel = new Map<string, string[]>();
  for (const n of nodes) {
    const l = label.get(n)!;
    if (!byLabel.has(l)) byLabel.set(l, []);
    byLabel.get(l)!.push(n);
  }
  const dispStmt = rawDb.prepare("SELECT display FROM cs_concepts WHERE id = ?");
  const ctRows: Array<{ concept: string; topic: string }> = [];
  const topicRows: Array<{ id: string; label: string; size: number }> = [];
  for (const [, concepts] of byLabel) {
    if (concepts.length < 2) continue; // singletons aren't topics
    const id = randomUUID();
    const top = concepts.sort((a, b) => (df.get(b) ?? 0) - (df.get(a) ?? 0)).slice(0, 3);
    const labelText = top
      .map((c) => (dispStmt.get(c) as { display: string } | undefined)?.display ?? c)
      .join(", ");
    topicRows.push({ id, label: labelText, size: concepts.length });
    for (const c of concepts) ctRows.push({ concept: c, topic: id });
  }

  db.transaction(() => {
    rawDb.prepare("DELETE FROM cs_concept_topics").run();
    rawDb.prepare("DELETE FROM cs_passage_topics").run();
    rawDb.prepare("DELETE FROM cs_topics").run();
    const insTopic = rawDb.prepare(
      "INSERT INTO cs_topics (id, label, size, book_count) VALUES (?, ?, ?, 0)",
    );
    for (const t of topicRows) insTopic.run(t.id, t.label, t.size);
    const insCT = rawDb.prepare(
      "INSERT INTO cs_concept_topics (concept_id, topic_id) VALUES (?, ?)",
    );
    for (const r of ctRows) insCT.run(r.concept, r.topic);
  });

  // passage → topic = the topic its concepts most vote for. Done as a STREAMING
  // tally in JS, not a SQL window function: cs_passage_concepts is already
  // ordered by passage_id (its PK), so the joined rows arrive grouped, and we
  // pick each passage's majority topic in one O(1)-memory pass. The equivalent
  // GROUP BY + ROW_NUMBER() did disk temp-sorts over ~1.5M rows and ran for
  // many minutes at full-library scale.
  log?.(`concept topics: assigning ${topicRows.length} topics to passages`);
  // concept → topic map in memory (one row per clustered concept). Then scan
  // cs_passage_concepts in PURE PK order (passage_id, concept_id) — a covering
  // index scan, NO join and NO sort — and tally each passage's majority topic.
  const conceptTopic = new Map<string, string>();
  for (const r of rawDb
    .prepare("SELECT concept_id, topic_id FROM cs_concept_topics")
    .iterate() as Iterable<{
    concept_id: string;
    topic_id: string;
  }>)
    conceptTopic.set(r.concept_id, r.topic_id);

  const assignments: Array<[string, string]> = [];
  let curPid: string | null = null;
  let votes = new Map<string, number>();
  const flush = () => {
    if (curPid === null || votes.size === 0) return;
    let best = "";
    let bestV = -1;
    for (const [t, v] of votes)
      if (v > bestV || (v === bestV && t < best)) {
        bestV = v;
        best = t;
      }
    assignments.push([curPid, best]);
  };
  for (const r of rawDb
    .prepare(
      "SELECT passage_id AS pid, concept_id AS cid FROM cs_passage_concepts ORDER BY passage_id",
    )
    .iterate() as Iterable<{ pid: string; cid: string }>) {
    const tid = conceptTopic.get(r.cid);
    if (!tid) continue;
    if (r.pid !== curPid) {
      flush();
      curPid = r.pid;
      votes = new Map();
    }
    votes.set(tid, (votes.get(tid) ?? 0) + 1);
  }
  flush();
  const insPT = rawDb.prepare("INSERT INTO cs_passage_topics (passage_id, topic_id) VALUES (?, ?)");
  const BATCH = 5000;
  for (let i = 0; i < assignments.length; i += BATCH) {
    const slice = assignments.slice(i, i + BATCH);
    db.transaction(() => {
      for (const [pid, tid] of slice) insPT.run(pid, tid);
    });
  }

  // book_count per topic from the passages assigned to it
  rawDb
    .prepare(
      `UPDATE cs_topics SET book_count = (
         SELECT COUNT(DISTINCT p.book_id) FROM cs_passage_topics pt
         JOIN passages p ON p.id = pt.passage_id WHERE pt.topic_id = cs_topics.id)`,
    )
    .run();

  log?.(`concept topics: ${topicRows.length} topics over ${ctRows.length} concepts`);
  return { topics: topicRows.length, conceptsClustered: ctRows.length };
}
