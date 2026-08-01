/**
 * lg build-prereqs — assemble the concept dependency near-DAG. Pure SQLite +
 * embeddings; no LLM.
 *
 * Raw prerequisite labels (lg_prereq_mentions, extracted per passage) resolve
 * to canonical theme concepts by slug (through merge tombstones), else by
 * embedding nearest-neighbor (>= 0.75), else drop. Aggregated edges are
 * accepted weight-desc ONLY if they don't create a cycle — the result is a DAG
 * by construction, no post-hoc surgery.
 */
import { rawDb } from "../db";
import { bufferToVector, cosine, embedBatch } from "../knowledge/embeddings";
import { ensureLgTables, slugifyLabel, resolveConceptId } from "./schema";

const NN_THRESHOLD = 0.75;

export interface PrereqsResult {
  themeId: string;
  mentions: number;
  resolvedBySlug: number;
  resolvedByEmbedding: number;
  unresolved: number;
  edgesKept: number;
  edgesDroppedCycles: number;
  unresolvedLabels: string[];
  /** Longest-path depth per concept id over accepted edges (spine ordering input). */
  depths: Record<string, number>;
}

export async function buildThemePrereqs(themeId: string): Promise<PrereqsResult> {
  ensureLgTables();

  // Theme concepts (canonical) with embeddings, for slug + NN resolution.
  const concepts = rawDb
    .prepare(
      `SELECT DISTINCT c.id, c.label, c.embedding AS emb
         FROM lg_theme_passages tp
         JOIN lg_passage_concepts pc ON pc.passage_id = tp.passage_id
         JOIN lg_concepts c ON c.id = pc.concept_id
        WHERE tp.theme_id = ? AND c.merged_into IS NULL`,
    )
    .all(themeId) as Array<{ id: string; label: string; emb: Buffer | null }>;
  const conceptIds = new Set(concepts.map((c) => c.id));
  const withVecs = concepts
    .filter((c) => c.emb)
    .map((c) => ({ id: c.id, vec: bufferToVector(c.emb!) }));

  // Raw mentions scoped to the theme's passages.
  const mentions = rawDb
    .prepare(
      `SELECT m.passage_id AS passageId, m.concept_id AS conceptId,
              m.prereq_label AS prereqLabel, m.model_id AS modelId
         FROM lg_prereq_mentions m
         JOIN lg_theme_passages tp ON tp.passage_id = m.passage_id AND tp.theme_id = ?`,
    )
    .all(themeId) as Array<{
    passageId: string;
    conceptId: string;
    prereqLabel: string;
    modelId: string;
  }>;

  const result: PrereqsResult = {
    themeId,
    mentions: mentions.length,
    resolvedBySlug: 0,
    resolvedByEmbedding: 0,
    unresolved: 0,
    edgesKept: 0,
    edgesDroppedCycles: 0,
    unresolvedLabels: [],
    depths: {},
  };

  // Resolve each distinct prereq label once: slug → tombstone chain → NN.
  const distinctLabels = [...new Set(mentions.map((m) => m.prereqLabel))];
  const resolution = new Map<string, { id: string; via: "slug" | "embedding" } | null>();
  const needNN: string[] = [];
  for (const label of distinctLabels) {
    const canonical = resolveConceptId(slugifyLabel(label));
    if (conceptIds.has(canonical)) {
      resolution.set(label, { id: canonical, via: "slug" });
    } else {
      needNN.push(label);
    }
  }
  const nnVecs = needNN.length > 0 ? await embedBatch(needNN) : [];
  for (let i = 0; i < needNN.length; i++) {
    let best: string | null = null;
    let bestSim = NN_THRESHOLD;
    for (const c of withVecs) {
      const sim = cosine(nnVecs[i], c.vec);
      if (sim >= bestSim) {
        bestSim = sim;
        best = c.id;
      }
    }
    resolution.set(needNN[i], best ? { id: best, via: "embedding" } : null);
    if (!best) result.unresolvedLabels.push(needNN[i]);
  }
  result.unresolvedLabels = result.unresolvedLabels.slice(0, 50);

  // Aggregate to weighted candidate edges (concept requires prereq).
  const edgeMap = new Map<
    string,
    { concept: string; requires: string; weight: number; evidence: string; modelId: string }
  >();
  for (const m of mentions) {
    const concept = resolveConceptId(m.conceptId);
    const resolved = resolution.get(m.prereqLabel) ?? null;
    if (!resolved) {
      result.unresolved++;
      continue;
    }
    if (resolved.via === "slug") result.resolvedBySlug++;
    else result.resolvedByEmbedding++;
    const requires = resolved.id;
    if (concept === requires || !conceptIds.has(concept)) continue; // self/foreign after resolution
    const key = `${concept}→${requires}`;
    const prev = edgeMap.get(key);
    if (prev) prev.weight += 1;
    else
      edgeMap.set(key, { concept, requires, weight: 1, evidence: m.passageId, modelId: m.modelId });
  }

  // Greedy acyclic assembly: weight-desc, accept only if requires ⇝ concept is
  // not already reachable (that would close a cycle).
  const adjacency = new Map<string, Set<string>>(); // concept → its accepted requirements
  const reaches = (from: string, to: string): boolean => {
    if (from === to) return true;
    const stack = [from];
    const seen = new Set<string>([from]);
    while (stack.length) {
      const cur = stack.pop()!;
      for (const next of adjacency.get(cur) ?? []) {
        if (next === to) return true;
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    return false;
  };

  const accepted: Array<{
    concept: string;
    requires: string;
    weight: number;
    evidence: string;
    modelId: string;
  }> = [];
  for (const e of [...edgeMap.values()].sort((a, b) => b.weight - a.weight)) {
    // Accepting concept→requires means "requires comes before concept". A cycle
    // appears iff concept is already (transitively) required BY requires.
    if (reaches(e.requires, e.concept)) {
      result.edgesDroppedCycles++;
      continue;
    }
    adjacency.set(e.concept, (adjacency.get(e.concept) ?? new Set()).add(e.requires));
    accepted.push(e);
  }
  result.edgesKept = accepted.length;

  // Persist (theme-scoped delete-then-insert so re-runs are clean). Edges for
  // concepts outside this theme are untouched.
  const del = rawDb.prepare(
    `DELETE FROM lg_concept_prereqs WHERE concept_id IN (
       SELECT DISTINCT pc.concept_id FROM lg_theme_passages tp
         JOIN lg_passage_concepts pc ON pc.passage_id = tp.passage_id
        WHERE tp.theme_id = ?)`,
  );
  const ins = rawDb.prepare(
    `INSERT OR REPLACE INTO lg_concept_prereqs (concept_id, requires_concept_id, weight, evidence_passage_id, model_id)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const persist = rawDb.transaction(() => {
    del.run(themeId);
    for (const e of accepted) ins.run(e.concept, e.requires, e.weight, e.evidence, e.modelId);
  });
  persist();

  // Topological depth = memoized longest path over accepted requirement edges.
  const depthMemo = new Map<string, number>();
  const depthOf = (id: string): number => {
    const hit = depthMemo.get(id);
    if (hit !== undefined) return hit;
    depthMemo.set(id, 0); // DAG by construction; this guards resolution glitches
    let d = 0;
    for (const req of adjacency.get(id) ?? []) d = Math.max(d, depthOf(req) + 1);
    depthMemo.set(id, d);
    return d;
  };
  for (const id of conceptIds) result.depths[id] = depthOf(id);

  return result;
}
