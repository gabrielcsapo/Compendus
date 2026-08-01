/**
 * lg form-themes — semantic theme communities over the LLM-extracted concept
 * graph. This replaces keyphrase label-prop topic membership as the source of
 * journeys: concepts that co-occur across passages (NPMI-weighted) cluster
 * into themes, so a theme's books are the books that genuinely TEACH its
 * concepts — the fix for Phase 0's cross-book ceiling.
 *
 * CPU-heavy (streamed co-occurrence join + label propagation + streaming
 * passage assignment) — runs inside the lg-graph-worker in production.
 * nameThemes (LLM shelf cards) runs on the lane.
 */
import { createHash } from "node:crypto";
import { rawDb } from "../db";
import { labelProp } from "../concept/graph";
import { nameTopic } from "../llm/ollama";
import { tick, type PassStatus } from "../llm/lane";
import { ensureLgTables, refreshThemeConcepts, LG_JOURNEY_WHERE } from "./schema";

const MIN_DF = 2;
const MIN_COOCCUR = 2;
const MIN_COMMUNITY = 2;
const MIN_PASSAGE_THEME_SUPPORT = 2;
const ASSIGN_BATCH = 5000;

interface LgGraph {
  nodes: string[];
  adj: Map<string, { j: string; w: number }[]>;
}

/**
 * Admit a passage only when one theme has substantial, unambiguous support.
 *
 * A plurality is not enough: with only 1-4 extracted concepts per passage, a
 * 1-1 tie or a 2-1-1 split is exactly the sort of weak bridge that previously
 * pulled unrelated prose into a theme. Callers count only concepts that have a
 * canonical home community; unclustered concepts neither help nor hurt.
 */
export function choosePassageTheme(votes: ReadonlyMap<string, number>): string | null {
  const ranked = [...votes].sort(
    ([themeA, votesA], [themeB, votesB]) => votesB - votesA || themeA.localeCompare(themeB),
  );
  const best = ranked[0];
  if (!best || best[1] < MIN_PASSAGE_THEME_SUPPORT) return null;

  const runnerUpVotes = ranked[1]?.[1] ?? 0;
  const totalVotes = ranked.reduce((sum, [, count]) => sum + count, 0);
  const margin = best[1] - runnerUpVotes;
  if (margin <= 0 || best[1] * 2 <= totalVotes) return null;
  return best[0];
}

/**
 * Positive-NPMI concept adjacency from lg_passage_concepts co-occurrence.
 * Streamed self-join (never materialized — the cs edge table that bloated to
 * 4.5M rows is the cautionary tale), canonical concepts only.
 */
export function loadLgGraph(log?: (m: string) => void): LgGraph {
  const N = (
    rawDb.prepare("SELECT COUNT(DISTINCT passage_id) AS n FROM lg_passage_concepts").get() as {
      n: number;
    }
  ).n;
  const dfRows = rawDb
    .prepare("SELECT id, df FROM lg_concepts WHERE merged_into IS NULL AND df >= ?")
    .all(MIN_DF) as Array<{ id: string; df: number }>;
  const df = new Map(dfRows.map((r) => [r.id, r.df]));
  const nodes = dfRows.map((r) => r.id);
  const adj = new Map<string, { j: string; w: number }[]>();
  if (N === 0 || nodes.length === 0) return { nodes, adj };

  const push = (i: string, j: string, w: number) => {
    const list = adj.get(i);
    if (list) list.push({ j, w });
    else adj.set(i, [{ j, w }]);
  };

  let edges = 0;
  const iter = rawDb
    .prepare(
      `SELECT pa.concept_id AS a, pb.concept_id AS b, COUNT(*) AS co
         FROM lg_passage_concepts pa
         JOIN lg_passage_concepts pb
           ON pb.passage_id = pa.passage_id AND pb.concept_id > pa.concept_id
        GROUP BY pa.concept_id, pb.concept_id
       HAVING co >= ${MIN_COOCCUR}`,
    )
    .iterate() as IterableIterator<{ a: string; b: string; co: number }>;
  for (const row of iter) {
    const da = df.get(row.a);
    const dbf = df.get(row.b);
    if (!da || !dbf) continue; // below MIN_DF or tombstoned
    const pab = row.co / N;
    const npmi = Math.log(pab / ((da / N) * (dbf / N))) / -Math.log(pab);
    if (npmi <= 0) continue;
    push(row.a, row.b, npmi);
    push(row.b, row.a, npmi);
    edges++;
  }
  log?.(`lg graph: ${nodes.length} concepts, ${edges} NPMI edges over ${N} passages`);
  return { nodes, adj };
}

/** Deterministic theme id: stable across re-forms when the core membership is. */
function themeIdFor(memberConceptIds: string[], df: Map<string, number>): string {
  const core = [...memberConceptIds]
    .sort((a, b) => (df.get(b) ?? 0) - (df.get(a) ?? 0) || a.localeCompare(b))
    .slice(0, 5)
    .sort();
  return "lgth_" + createHash("sha1").update(core.join("|")).digest("hex").slice(0, 16);
}

export interface FormThemesResult {
  themes: number;
  conceptsClustered: number;
  passagesAssigned: number;
  gated: number;
}

/**
 * Full rebuild: labelProp communities → lg_themes (+lg_concept_themes) →
 * streaming majority-vote passage assignment → book counts + read models.
 * Wipes previous themes/spines (incl. the Phase-0 lgt_* theme — extractions
 * persist; it re-derives organically).
 */
export function formThemes(log?: (m: string) => void): FormThemesResult {
  ensureLgTables();
  const { nodes, adj } = loadLgGraph(log);
  const assignment = labelProp(nodes, adj);

  // Group concepts by community.
  const communities = new Map<string, string[]>();
  for (const [node, community] of assignment) {
    const list = communities.get(community);
    if (list) list.push(node);
    else communities.set(community, [node]);
  }

  const df = new Map(
    (
      rawDb.prepare("SELECT id, df FROM lg_concepts WHERE merged_into IS NULL").all() as Array<{
        id: string;
        df: number;
      }>
    ).map((r) => [r.id, r.df]),
  );
  const labelOf = new Map(
    (
      rawDb.prepare("SELECT id, label FROM lg_concepts WHERE merged_into IS NULL").all() as Array<{
        id: string;
        label: string;
      }>
    ).map((r) => [r.id, r.label]),
  );

  // Build theme rows (id deterministic; label = top-3 df concepts fallback;
  // blurb NULL = "not yet named" marker the naming pass selects on).
  const themes: Array<{ id: string; label: string; members: string[] }> = [];
  const conceptTheme = new Map<string, string>();
  for (const members of communities.values()) {
    if (members.length < MIN_COMMUNITY) continue;
    const id = themeIdFor(members, df);
    const top = [...members].sort((a, b) => (df.get(b) ?? 0) - (df.get(a) ?? 0)).slice(0, 3);
    const label = top.map((c) => labelOf.get(c) ?? c).join(", ");
    themes.push({ id, label, members });
    for (const m of members) conceptTheme.set(m, id);
  }
  log?.(`formed ${themes.length} candidate themes from ${communities.size} communities`);

  // Wipe + insert in one transaction.
  const rebuild = rawDb.transaction(() => {
    rawDb.exec(
      "DELETE FROM lg_themes; DELETE FROM lg_theme_passages; DELETE FROM lg_concept_themes; DELETE FROM lg_theme_spine; DELETE FROM lg_spine_passages;",
    );
    const insTheme = rawDb.prepare(
      "INSERT INTO lg_themes (id, label, blurb, source_topic_id, model_id) VALUES (?, ?, NULL, NULL, NULL)",
    );
    const insCt = rawDb.prepare(
      "INSERT OR REPLACE INTO lg_concept_themes (concept_id, theme_id) VALUES (?, ?)",
    );
    for (const t of themes) {
      insTheme.run(t.id, t.label);
      for (const m of t.members) insCt.run(m, t.id);
    }
  });
  rebuild();

  // Streaming majority-vote passage → theme assignment (PK-ordered scan).
  const insTp = rawDb.prepare(
    "INSERT OR IGNORE INTO lg_theme_passages (theme_id, passage_id) VALUES (?, ?)",
  );
  let assigned = 0;
  let batch: Array<[string, string]> = [];
  const flush = rawDb.transaction((rows: Array<[string, string]>) => {
    for (const [themeId, passageId] of rows) insTp.run(themeId, passageId);
  });
  let currentPassage: string | null = null;
  let votes = new Map<string, number>();
  const settle = () => {
    if (!currentPassage || votes.size === 0) return;
    const themeId = choosePassageTheme(votes);
    if (themeId) {
      batch.push([themeId, currentPassage]);
      assigned++;
      if (batch.length >= ASSIGN_BATCH) {
        flush(batch);
        batch = [];
      }
    }
  };
  const scan = rawDb
    .prepare(
      "SELECT passage_id AS pid, concept_id AS cid FROM lg_passage_concepts ORDER BY passage_id",
    )
    .iterate() as IterableIterator<{ pid: string; cid: string }>;
  for (const row of scan) {
    if (row.pid !== currentPassage) {
      settle();
      currentPassage = row.pid;
      votes = new Map();
    }
    const theme = conceptTheme.get(row.cid);
    if (theme) votes.set(theme, (votes.get(theme) ?? 0) + 1);
  }
  settle();
  if (batch.length > 0) flush(batch);
  log?.(`assigned ${assigned} passages to themes`);

  // Book counts + concept_ids/counts per theme.
  rawDb.exec(
    `UPDATE lg_themes SET nonfiction_books = (
       SELECT COUNT(DISTINCT p.book_id) FROM lg_theme_passages tp
         JOIN passages p ON p.id = tp.passage_id
        WHERE tp.theme_id = lg_themes.id
     )`,
  );
  for (const t of themes) refreshThemeConcepts(t.id);

  const gated = (
    rawDb.prepare(`SELECT COUNT(*) AS n FROM lg_themes WHERE ${LG_JOURNEY_WHERE}`).get() as {
      n: number;
    }
  ).n;
  log?.(`${gated} themes pass the journey gate`);

  return {
    themes: themes.length,
    conceptsClustered: conceptTheme.size,
    passagesAssigned: assigned,
    gated,
  };
}

export interface NameThemesResult {
  named: number;
  failed: number;
  candidates: number;
}

/**
 * LLM shelf cards for gated, unnamed themes (blurb IS NULL is the marker —
 * form-themes seeds fallback labels but leaves blurbs empty). Resumable.
 * NOTE: this is the pass that trips the journey cutover (lgJourneysLive).
 */
export async function nameThemes(
  opts: { limit?: number; model?: string },
  status?: PassStatus,
): Promise<NameThemesResult> {
  ensureLgTables();
  const limit = opts?.limit ?? 1000;
  const themes = rawDb
    .prepare(
      `SELECT id, concept_ids AS cids FROM lg_themes
        WHERE ${LG_JOURNEY_WHERE} AND blurb IS NULL
        ORDER BY nonfiction_books DESC, concept_count DESC LIMIT ?`,
    )
    .all(limit) as Array<{ id: string; cids: string }>;
  const labelOf = rawDb.prepare("SELECT label FROM lg_concepts WHERE id = ?");
  const samplesOf = rawDb.prepare(
    `SELECT p.text AS text FROM lg_theme_passages tp
       JOIN passages p ON p.id = tp.passage_id
       JOIN cs_passage_salience s ON s.passage_id = tp.passage_id
      WHERE tp.theme_id = ? ORDER BY s.salience DESC LIMIT 3`,
  );
  const applyName = rawDb.prepare(
    "UPDATE lg_themes SET label = ?, blurb = ?, model_id = ? WHERE id = ?",
  );

  const result: NameThemesResult = { named: 0, failed: 0, candidates: themes.length };
  if (status) status.total = themes.length;
  for (const t of themes) {
    if (status) status.processed++;
    const conceptIds = (JSON.parse(t.cids) as string[]).slice(0, 8);
    const concepts = conceptIds
      .map((id) => (labelOf.get(id) as { label: string } | undefined)?.label)
      .filter((l): l is string => Boolean(l));
    const samples = (samplesOf.all(t.id) as { text: string }[]).map((r) =>
      r.text.replace(/\s+/g, " ").trim().slice(0, 400),
    );
    if (concepts.length === 0 || samples.length === 0) continue;
    try {
      const r = await nameTopic({ concepts, samples, model: opts?.model });
      const label = r.label.trim();
      if (label.length < 3 || label.length > 60 || /\n/.test(label)) {
        result.failed++;
        continue;
      }
      applyName.run(label, r.blurb.trim().slice(0, 200), r.modelId, t.id);
      result.named++;
      if (status) status.note = label;
    } catch (e) {
      result.failed++;
      console.warn(`[lg name-themes] ${t.id}: ${e instanceof Error ? e.message : e}`);
    }
    await tick();
  }
  return result;
}
