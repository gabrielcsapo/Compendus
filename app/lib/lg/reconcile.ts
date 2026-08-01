/**
 * lg reconcile-concepts — merge different wordings of one concept across books.
 *
 * This is what makes buying a book ENRICH a theme instead of spawning a
 * parallel cluster ("compound interest" vs "exponential growth of savings").
 * Free merges first (slug normalization), then embedding-similar, kind-
 * compatible pairs are adjudicated by the LLM ("same concept for a learner?").
 * Merges are tombstones: the losing row keeps its label with merged_into
 * pointing at the winner, so future extractions of the merged wording resolve
 * through the pointer (critical for incremental ingest).
 *
 * Two scopes share one core:
 *   - reconcileTheme: Phase-0 style, concepts of one theme, in-process pairing.
 *   - reconcileLibrary: all canonical concepts; candidate pairs come from the
 *     lg-graph-worker (the O(n²) sweep would block the web thread), and every
 *     adjudication lands in lg_reconcile_verdicts so re-runs and threshold
 *     iteration never repeat inference.
 */
import { rawDb } from "../db";
import { bufferToVector, cosine } from "../knowledge/embeddings";
import { ollamaChatJson, parseModelJson, OLLAMA_MODEL } from "../llm/ollama";
import { tick, type PassStatus } from "../llm/lane";
import { ensureLgTables, recomputeDf, refreshThemeConcepts, LG_JOURNEY_WHERE } from "./schema";
import { runLgWorker } from "./worker";

export const RECONCILE_SYSTEM = [
  "You decide whether two concept labels extracted from different books denote",
  "the SAME concept for a learner. Different wording for one idea = same.",
  "Related-but-distinct ideas (a concept and its broader field, a person and an",
  "event they took part in) = different.",
  'Respond ONLY with JSON: {"same": true|false, "canonical_label": "...", "why": "..."}',
  "canonical_label must be exactly one of the two given labels — whichever is",
  "the better textbook-index form.",
].join("\n");

export interface CandidatePair {
  aId: string;
  bId: string;
  aLabel: string;
  bLabel: string;
  aKind: string;
  bKind: string;
  aDf: number;
  bDf: number;
  sim: number;
}

interface ThemeConcept {
  id: string;
  label: string;
  kind: string;
  df: number;
  vec: Float32Array | null;
}

/** Singular/plural + punctuation normalization for free (no-LLM) merges. */
export function normSlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ");
}

/** person merges only with person, event with event; idea/method/term wobble freely. */
export function kindsCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  const loose = new Set(["idea", "method", "term"]);
  return loose.has(a) && loose.has(b);
}

export function sampleClaims(conceptId: string, n = 2): string[] {
  return (
    rawDb
      .prepare(
        "SELECT claim FROM lg_passage_concepts WHERE concept_id = ? AND claim IS NOT NULL AND claim != '' LIMIT ?",
      )
      .all(conceptId, n) as { claim: string }[]
  ).map((r) => r.claim);
}

/**
 * Merge loser → winner in one transaction; PK collisions (a passage citing
 * both wordings) keep the winner's existing row. Earlier tombstones re-point
 * at the new canonical id (path compression).
 */
export function mergeConcepts(winner: string, loser: string): void {
  const tx = rawDb.transaction(() => {
    rawDb
      .prepare("UPDATE OR IGNORE lg_passage_concepts SET concept_id = ? WHERE concept_id = ?")
      .run(winner, loser);
    rawDb.prepare("DELETE FROM lg_passage_concepts WHERE concept_id = ?").run(loser);
    rawDb.prepare("UPDATE lg_concepts SET merged_into = ? WHERE id = ?").run(winner, loser);
    rawDb
      .prepare("UPDATE lg_concepts SET merged_into = ? WHERE merged_into = ?")
      .run(winner, loser);
  });
  tx();
}

const canonicalOf = (id: string): string => {
  const row = rawDb.prepare("SELECT merged_into AS m FROM lg_concepts WHERE id = ?").get(id) as
    | { m: string | null }
    | undefined;
  return row?.m ?? id;
};

export interface AdjudicationResult {
  llmMerges: number;
  rejected: number;
  failures: number;
  cacheHits: number;
  mergedPairs: Array<{ winner: string; loser: string }>;
}

/**
 * LLM same-concept adjudication over candidate pairs, with the verdict cache:
 * a (pair, model) that was ever judged never costs inference again. Pairs are
 * resolved through merges made earlier in the same run.
 */
export async function adjudicatePairs(
  pairs: CandidatePair[],
  opts: { model?: string },
  status?: PassStatus,
): Promise<AdjudicationResult> {
  const model = opts.model || OLLAMA_MODEL;
  const result: AdjudicationResult = {
    llmMerges: 0,
    rejected: 0,
    failures: 0,
    cacheHits: 0,
    mergedPairs: [],
  };
  const verdictGet = rawDb.prepare(
    "SELECT same, canonical_label AS canon FROM lg_reconcile_verdicts WHERE a_id = ? AND b_id = ? AND model_id = ?",
  );
  const verdictPut = rawDb.prepare(
    `INSERT OR REPLACE INTO lg_reconcile_verdicts (a_id, b_id, model_id, same, canonical_label, created_at)
     VALUES (?, ?, ?, ?, ?, unixepoch())`,
  );

  if (status) status.total = pairs.length;
  for (const pair of pairs) {
    if (status) {
      status.processed++;
      status.note = `${pair.aLabel} ↔ ${pair.bLabel}`;
    }
    const ca = canonicalOf(pair.aId);
    const cb = canonicalOf(pair.bId);
    if (ca === cb) continue; // already merged via an earlier pair

    // Normalized cache key: lexicographically ordered ORIGINAL pair ids.
    const [ka, kb] = pair.aId < pair.bId ? [pair.aId, pair.bId] : [pair.bId, pair.aId];
    const cached = verdictGet.get(ka, kb, model) as
      | { same: number; canon: string | null }
      | undefined;

    let same: boolean;
    let canonLabel: string;
    if (cached) {
      result.cacheHits++;
      same = cached.same === 1;
      canonLabel = cached.canon ?? "";
    } else {
      try {
        const user = [
          `A: "${pair.aLabel}" (kind: ${pair.aKind}) — sample claims: ${sampleClaims(ca).join(" | ") || "(none)"}`,
          `B: "${pair.bLabel}" (kind: ${pair.bKind}) — sample claims: ${sampleClaims(cb).join(" | ") || "(none)"}`,
        ].join("\n");
        const res = await ollamaChatJson(RECONCILE_SYSTEM, user, { model });
        const verdict = parseModelJson<{ same?: boolean; canonical_label?: string }>(res.content);
        same = verdict.same === true;
        canonLabel = String(verdict.canonical_label ?? "").trim();
        verdictPut.run(ka, kb, model, same ? 1 : 0, canonLabel || null);
      } catch (e) {
        result.failures++;
        console.warn(
          `[lg reconcile] ${pair.aLabel} ↔ ${pair.bLabel}: ${e instanceof Error ? e.message : e}`,
        );
        await tick();
        continue;
      }
    }

    if (same) {
      // Winner = the side matching canonical_label; tiebreak: higher df.
      const winnerFirst =
        canonLabel === pair.aLabel
          ? [ca, cb]
          : canonLabel === pair.bLabel
            ? [cb, ca]
            : pair.aDf >= pair.bDf
              ? [ca, cb]
              : [cb, ca];
      if (winnerFirst[0] !== winnerFirst[1]) {
        mergeConcepts(winnerFirst[0], winnerFirst[1]);
        result.llmMerges++;
        result.mergedPairs.push({
          winner: winnerFirst[0] === ca ? pair.aLabel : pair.bLabel,
          loser: winnerFirst[0] === ca ? pair.bLabel : pair.aLabel,
        });
      }
    } else {
      result.rejected++;
    }
    await tick();
  }
  return result;
}

/** Free merges: identical normalized slug (no LLM). Returns merged pair labels. */
function freeSlugMerges(
  concepts: Map<string, ThemeConcept>,
): Array<{ winner: string; loser: string }> {
  const merged: Array<{ winner: string; loser: string }> = [];
  const bySlug = new Map<string, ThemeConcept[]>();
  for (const c of concepts.values()) {
    const key = normSlug(c.label);
    bySlug.set(key, [...(bySlug.get(key) ?? []), c]);
  }
  for (const group of bySlug.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => b.df - a.df);
    const winner = group[0];
    for (const loser of group.slice(1)) {
      if (!kindsCompatible(winner.kind, loser.kind)) continue;
      mergeConcepts(winner.id, loser.id);
      merged.push({ winner: winner.label, loser: loser.label });
    }
  }
  return merged;
}

export interface ReconcileResult {
  themeId: string;
  concepts: number;
  freeMerges: number;
  candidatePairs: number;
  llmMerges: number;
  rejected: number;
  failures: number;
  mergedPairs: Array<{ winner: string; loser: string }>;
}

export async function reconcileTheme(
  themeId: string,
  opts: { threshold?: number; model?: string },
  status?: PassStatus,
): Promise<ReconcileResult> {
  ensureLgTables();
  const threshold = opts.threshold ?? 0.8;

  const loadConcepts = (): Map<string, ThemeConcept> => {
    const rows = rawDb
      .prepare(
        `SELECT DISTINCT c.id, c.label, c.kind, c.df, c.embedding AS emb
           FROM lg_theme_passages tp
           JOIN lg_passage_concepts pc ON pc.passage_id = tp.passage_id
           JOIN lg_concepts c ON c.id = pc.concept_id
          WHERE tp.theme_id = ? AND c.merged_into IS NULL`,
      )
      .all(themeId) as Array<{
      id: string;
      label: string;
      kind: string;
      df: number;
      emb: Buffer | null;
    }>;
    return new Map(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          label: r.label,
          kind: r.kind,
          df: r.df,
          vec: r.emb ? bufferToVector(r.emb) : null,
        },
      ]),
    );
  };

  const result: ReconcileResult = {
    themeId,
    concepts: 0,
    freeMerges: 0,
    candidatePairs: 0,
    llmMerges: 0,
    rejected: 0,
    failures: 0,
    mergedPairs: [],
  };

  let concepts = loadConcepts();
  result.concepts = concepts.size;

  const free = freeSlugMerges(concepts);
  result.freeMerges = free.length;
  result.mergedPairs.push(...free);
  concepts = loadConcepts();

  // Candidate pairs in-process — Phase-0 theme scale is O(10²-10³) concepts.
  const list = [...concepts.values()].filter((c) => c.vec);
  const pairs: CandidatePair[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (!kindsCompatible(a.kind, b.kind)) continue;
      const sim = cosine(a.vec!, b.vec!);
      if (sim >= threshold) {
        pairs.push({
          aId: a.id,
          bId: b.id,
          aLabel: a.label,
          bLabel: b.label,
          aKind: a.kind,
          bKind: b.kind,
          aDf: a.df,
          bDf: b.df,
          sim,
        });
      }
    }
  }
  pairs.sort((x, y) => y.sim - x.sim);
  result.candidatePairs = pairs.length;

  const adjudicated = await adjudicatePairs(pairs, opts, status);
  result.llmMerges = adjudicated.llmMerges;
  result.rejected = adjudicated.rejected;
  result.failures = adjudicated.failures;
  result.mergedPairs.push(...adjudicated.mergedPairs);

  recomputeDf();
  refreshThemeConcepts(themeId);
  result.concepts = loadConcepts().size;
  return result;
}

export interface ReconcileLibraryResult {
  concepts: number;
  conceptsAfter: number;
  freeMerges: number;
  candidatePairs: number;
  truncated: boolean;
  llmMerges: number;
  rejected: number;
  failures: number;
  cacheHits: number;
  mergedPairs: Array<{ winner: string; loser: string }>;
}

/**
 * Library-wide reconciliation. Candidate generation runs in the lg-graph
 * worker (the pairwise sweep over tens of thousands of concepts is minutes of
 * pinned CPU); adjudication runs here on the lane with the verdict cache.
 */
export async function reconcileLibrary(
  opts: { threshold?: number; maxPairs?: number; model?: string },
  status?: PassStatus,
): Promise<ReconcileLibraryResult> {
  ensureLgTables();
  const threshold = opts.threshold ?? 0.85;
  const maxPairs = opts.maxPairs ?? 20_000;

  const countCanonical = () =>
    (
      rawDb.prepare("SELECT COUNT(*) AS n FROM lg_concepts WHERE merged_into IS NULL").get() as {
        n: number;
      }
    ).n;

  const result: ReconcileLibraryResult = {
    concepts: countCanonical(),
    conceptsAfter: 0,
    freeMerges: 0,
    candidatePairs: 0,
    truncated: false,
    llmMerges: 0,
    rejected: 0,
    failures: 0,
    cacheHits: 0,
    mergedPairs: [],
  };

  // 1. Free slug merges over ALL canonical concepts.
  if (status) status.note = "free slug merges…";
  const all = new Map<string, ThemeConcept>(
    (
      rawDb
        .prepare("SELECT id, label, kind, df FROM lg_concepts WHERE merged_into IS NULL")
        .all() as Array<{ id: string; label: string; kind: string; df: number }>
    ).map((r) => [r.id, { ...r, vec: null }]),
  );
  const free = freeSlugMerges(all);
  result.freeMerges = free.length;
  result.mergedPairs.push(...free.slice(0, 50));

  // 2. Candidate pairs from the worker (sim-desc, capped — truncation drops
  //    the least-confident candidates).
  if (status) status.note = "computing candidate pairs (worker)…";
  const workerOut = (await runLgWorker("knn-candidates", { threshold, maxPairs })) as {
    pairs: CandidatePair[];
    truncated: boolean;
  };
  result.candidatePairs = workerOut.pairs.length;
  result.truncated = workerOut.truncated;
  if (status) {
    status.note = `${workerOut.pairs.length.toLocaleString()} candidate pairs → adjudicating (~${Math.round((workerOut.pairs.length * 3) / 60)} min worst case)`;
  }

  // 3. Adjudicate on the lane (verdict-cached).
  const adjudicated = await adjudicatePairs(workerOut.pairs, opts, status);
  result.llmMerges = adjudicated.llmMerges;
  result.rejected = adjudicated.rejected;
  result.failures = adjudicated.failures;
  result.cacheHits = adjudicated.cacheHits;
  result.mergedPairs.push(...adjudicated.mergedPairs.slice(0, 100));

  recomputeDf();
  // Refresh theme read-models if themes already exist (re-run after form-themes).
  const themes = rawDb.prepare(`SELECT id FROM lg_themes WHERE ${LG_JOURNEY_WHERE}`).all() as {
    id: string;
  }[];
  for (const t of themes) refreshThemeConcepts(t.id);

  result.conceptsAfter = countCanonical();
  return result;
}
