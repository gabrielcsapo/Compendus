/**
 * lg compile-spine — the recompiling textbook.
 *
 * The LLM authors ONLY the lesson outline: 5-12 ordered steps, each grouping
 * concepts it may not invent, respecting the prerequisite DAG. Slotting the
 * owner's passages into steps is PURE CODE — the model never sees or emits a
 * passage id, so every node a reader gets is a verbatim passage by
 * construction (Rule 2). validateSpine asserts it anyway.
 */
import { rawDb } from "../db";
import { ollamaChatJson, parseModelJson, OLLAMA_MODEL } from "../llm/ollama";
import type { PassStatus } from "../llm/lane";
import { ensureLgTables, type LgRole } from "./schema";
import { buildThemePrereqs } from "./prereqs";

const MAX_CONCEPTS_IN_PROMPT = 60;
const MAX_PASSAGES_PER_STEP = 4;

// Role priority when picking the best passage for a concept in a step.
const ROLE_PRIORITY: LgRole[] = [
  "definition",
  "derivation",
  "example",
  "application",
  "caveat",
  "anecdote",
  "summary",
  "exercise",
];

const SPINE_SYSTEM = [
  'You are designing the lesson outline (a "spine") for a theme, to be taught',
  "entirely through verbatim passages from the owner's books. You only ORDER and",
  "GROUP the given concepts into steps — you never add concepts, facts, or text.",
  "Respond ONLY with JSON:",
  '{"steps": [{"title": "...", "intent": "...", "concept_labels": ["..."]}]}',
  "Rules:",
  "- 5 to 12 steps, ordered for a motivated beginner.",
  "- Every concept_label must be copied EXACTLY from the provided list; every",
  "  provided concept should appear in exactly one step (drop only true stragglers).",
  "- Respect the prerequisites: a concept may only appear in the same step as,",
  "  or a later step than, every concept it requires.",
  "- title: a lesson name (3-8 words), not a book chapter reference.",
  "- intent: one sentence — what the reader should understand after this step.",
].join("\n");

interface ThemeConceptRow {
  id: string;
  label: string;
  kind: string;
  df: number;
}

interface SpineStep {
  title: string;
  intent: string;
  conceptIds: string[];
}

export interface CompileSpineResult {
  themeId: string;
  steps: number;
  slottedPassages: number;
  droppedUnknownLabels: number;
  droppedEmptySteps: number;
  orderingViolations: number;
  orderingRepaired: boolean;
  valid: boolean;
  validationErrors: string[];
}

export async function compileSpine(
  themeId: string,
  opts: { model?: string },
  status?: PassStatus,
): Promise<CompileSpineResult> {
  ensureLgTables();
  const model = opts.model || OLLAMA_MODEL;
  if (status) status.total = 4; // outline → validate → slot → verify

  const theme = rawDb.prepare("SELECT label FROM lg_themes WHERE id = ?").get(themeId) as
    | { label: string | null }
    | undefined;
  if (!theme) throw new Error(`lg theme ${themeId} not found — run extract first`);

  // Prereq pass supplies the edges + topo depths (recomputed here so compile
  // can be re-run alone after a reconcile tweak).
  const prereqs = await buildThemePrereqs(themeId);

  const concepts = rawDb
    .prepare(
      `SELECT c.id, c.label, c.kind, c.df
         FROM lg_concept_themes ct
         JOIN lg_concepts c ON c.id = ct.concept_id
        WHERE ct.theme_id = ? AND c.merged_into IS NULL
        ORDER BY c.df DESC LIMIT ?`,
    )
    .all(themeId, MAX_CONCEPTS_IN_PROMPT) as ThemeConceptRow[];
  if (concepts.length < 3)
    throw new Error(`theme has only ${concepts.length} concepts — extract more first`);
  const byLabel = new Map(concepts.map((c) => [c.label, c]));
  const inPrompt = new Set(concepts.map((c) => c.id));

  const rolesOf = (conceptId: string): string => {
    const rows = rawDb
      .prepare(
        `SELECT pc.role AS role, COUNT(*) AS n FROM lg_passage_concepts pc
          JOIN lg_theme_passages tp ON tp.passage_id = pc.passage_id AND tp.theme_id = ?
         WHERE pc.concept_id = ? GROUP BY pc.role`,
      )
      .all(themeId, conceptId) as { role: string; n: number }[];
    return rows.map((r) => `${r.role}×${r.n}`).join(", ") || "none";
  };

  const edges = rawDb
    .prepare(
      `SELECT p.concept_id AS c, p.requires_concept_id AS r
         FROM lg_concept_prereqs p`,
    )
    .all() as { c: string; r: string }[];
  const themeEdges = edges.filter((e) => inPrompt.has(e.c) && inPrompt.has(e.r));
  const labelOf = new Map(concepts.map((c) => [c.id, c.label]));

  const buildUser = () =>
    [
      `Theme: "${theme.label ?? themeId}"`,
      "",
      "Concepts (label | kind | passages | available roles | depth):",
      ...concepts.map(
        (c) =>
          `- "${c.label}" | ${c.kind} | ${c.df} | ${rolesOf(c.id)} | depth ${prereqs.depths[c.id] ?? 0}`,
      ),
      "",
      "Prerequisites:",
      ...(themeEdges.length
        ? themeEdges.map((e) => `- "${labelOf.get(e.c)}" requires "${labelOf.get(e.r)}"`)
        : ["(none extracted)"]),
    ].join("\n");

  // Ordering check: every concept must appear no earlier than all its prereqs.
  const stepIndexOf = (steps: SpineStep[]): Map<string, number> => {
    const m = new Map<string, number>();
    steps.forEach((s, i) => s.conceptIds.forEach((cid) => m.set(cid, i)));
    return m;
  };
  const violations = (steps: SpineStep[]): string[] => {
    const idx = stepIndexOf(steps);
    const out: string[] = [];
    for (const e of themeEdges) {
      const ci = idx.get(e.c);
      const ri = idx.get(e.r);
      if (ci !== undefined && ri !== undefined && ci < ri) {
        out.push(
          `"${labelOf.get(e.c)}" (step ${ci + 1}) requires "${labelOf.get(e.r)}" (step ${ri + 1})`,
        );
      }
    }
    return out;
  };

  const parseSteps = (content: string): { steps: SpineStep[]; dropped: number } => {
    const raw = parseModelJson<{ steps?: Array<Record<string, unknown>> }>(content);
    if (!Array.isArray(raw.steps) || raw.steps.length < 2)
      throw new Error("steps must be an array of 2+");
    let dropped = 0;
    const steps: SpineStep[] = [];
    for (const s of raw.steps.slice(0, 12)) {
      const title = String(s.title ?? "")
        .trim()
        .slice(0, 80);
      const intent = String(s.intent ?? "")
        .trim()
        .slice(0, 240);
      const conceptIds: string[] = [];
      for (const l of Array.isArray(s.concept_labels) ? s.concept_labels : []) {
        const c = byLabel.get(String(l).trim());
        if (c) conceptIds.push(c.id);
        else dropped++;
      }
      if (title && conceptIds.length > 0) steps.push({ title, intent, conceptIds });
    }
    if (steps.length < 2) throw new Error("too few usable steps after validation");
    // A concept in multiple steps keeps its earliest slot.
    const seen = new Set<string>();
    for (const s of steps)
      s.conceptIds = s.conceptIds.filter((c) => !seen.has(c) && (seen.add(c), true));
    return { steps: steps.filter((s) => s.conceptIds.length > 0), dropped };
  };

  // 1. Author the outline (one retry naming violated pairs, then auto-repair).
  if (status) {
    status.processed = 1;
    status.note = "authoring outline";
  }
  let { steps, dropped } = parseSteps(
    (await ollamaChatJson(SPINE_SYSTEM, buildUser(), { model })).content,
  );
  let viols = violations(steps);
  let repaired = false;
  if (viols.length > 0) {
    if (status) status.note = `retrying — ${viols.length} ordering violations`;
    const retryUser = `${buildUser()}\n\nYour previous outline violated these prerequisites — fix the ordering:\n${viols
      .slice(0, 10)
      .map((v) => `- ${v}`)
      .join("\n")}`;
    try {
      const retry = parseSteps((await ollamaChatJson(SPINE_SYSTEM, retryUser, { model })).content);
      if (violations(retry.steps).length < viols.length) {
        steps = retry.steps;
        dropped = retry.dropped;
        viols = violations(steps);
      }
    } catch {
      /* keep the first outline; auto-repair below */
    }
  }
  if (viols.length > 0) {
    // Auto-repair: stable-sort steps by the max topo depth of their concepts.
    steps = steps
      .map((s, i) => ({ s, i, d: Math.max(0, ...s.conceptIds.map((c) => prereqs.depths[c] ?? 0)) }))
      .sort((a, b) => a.d - b.d || a.i - b.i)
      .map((x) => x.s);
    repaired = true;
    viols = violations(steps);
  }

  // 2. Persist the outline.
  if (status) {
    status.processed = 2;
    status.note = "persisting outline";
  }
  const persistOutline = rawDb.transaction(() => {
    rawDb.prepare("DELETE FROM lg_theme_spine WHERE theme_id = ?").run(themeId);
    rawDb.prepare("DELETE FROM lg_spine_passages WHERE theme_id = ?").run(themeId);
    const ins = rawDb.prepare(
      "INSERT INTO lg_theme_spine (theme_id, step_ordinal, step_title, step_intent, concept_ids, model_id) VALUES (?, ?, ?, ?, ?, ?)",
    );
    steps.forEach((s, i) =>
      ins.run(themeId, i + 1, s.title, s.intent, JSON.stringify(s.conceptIds), model),
    );
  });
  persistOutline();

  // 3. Slot passages — pure code. Per step per concept: role VARIETY first
  //    (a lesson step should mix definition → example → application, not stack
  //    four definitions), salience-ranked, each passage used once globally,
  //    book-alternation preferred.
  if (status) {
    status.processed = 3;
    status.note = "slotting passages";
  }
  const candidatesFor = rawDb.prepare(
    `SELECT pc.passage_id AS passageId, pc.role AS role, p.book_id AS bookId,
            COALESCE(s.salience, 0) AS salience
       FROM lg_passage_concepts pc
       JOIN lg_theme_passages tp ON tp.passage_id = pc.passage_id AND tp.theme_id = ?
       JOIN passages p ON p.id = pc.passage_id
       LEFT JOIN cs_passage_salience s ON s.passage_id = pc.passage_id
      WHERE pc.concept_id = ?`,
  );
  // A passage must carry decisive graph evidence for this theme. This is a
  // fail-closed safety net for stale theme membership created before the
  // assignment gate existed; role variety and salience never justify drift.
  const affinityByPassage = new Map<string, Map<string, number>>();
  for (const row of rawDb
    .prepare(
      `SELECT pc.passage_id AS passageId, ct.theme_id AS linkedTheme, COUNT(*) AS n
         FROM lg_theme_passages tp
         JOIN lg_passage_concepts pc ON pc.passage_id = tp.passage_id
         JOIN lg_concept_themes ct ON ct.concept_id = pc.concept_id
        WHERE tp.theme_id = ?
        GROUP BY pc.passage_id, ct.theme_id`,
    )
    .all(themeId) as Array<{ passageId: string; linkedTheme: string; n: number }>) {
    const counts = affinityByPassage.get(row.passageId) ?? new Map<string, number>();
    counts.set(row.linkedTheme, row.n);
    affinityByPassage.set(row.passageId, counts);
  }
  const hasStrongThemeAffinity = (passageId: string) => {
    const counts = affinityByPassage.get(passageId);
    if (!counts) return false;
    const home = counts.get(themeId) ?? 0;
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    const runnerUp = Math.max(
      0,
      ...[...counts.entries()]
        .filter(([candidateTheme]) => candidateTheme !== themeId)
        .map(([, count]) => count),
    );
    return home >= 2 && home * 2 > total && home > runnerUp;
  };
  const usedPassages = new Set<string>();
  const insSlot = rawDb.prepare(
    "INSERT OR IGNORE INTO lg_spine_passages (theme_id, step_ordinal, passage_id, role, rank) VALUES (?, ?, ?, ?, ?)",
  );
  let slotted = 0;
  for (let si = 0; si < steps.length; si++) {
    const stepBooks: string[] = [];
    const usedRoles = new Map<string, number>();
    let rank = 0;
    for (const conceptId of steps[si].conceptIds) {
      if (rank >= MAX_PASSAGES_PER_STEP) break;
      const cands = (
        candidatesFor.all(themeId, conceptId) as Array<{
          passageId: string;
          role: LgRole;
          bookId: string;
          salience: number;
        }>
      )
        .filter((c) => !usedPassages.has(c.passageId))
        .filter((c) => hasStrongThemeAffinity(c.passageId))
        .sort((a, b) => {
          // 1. Roles this step hasn't used yet come first (variety beats rank).
          const ua = usedRoles.get(a.role) ?? 0;
          const ub = usedRoles.get(b.role) ?? 0;
          if (ua !== ub) return ua - ub;
          // 2. Then the pedagogical role order (definitions open a step).
          const rp = ROLE_PRIORITY.indexOf(a.role) - ROLE_PRIORITY.indexOf(b.role);
          if (rp !== 0) return rp;
          // 3. Prefer a book not already in this step (criterion 3: cross-book).
          const ba = stepBooks.includes(a.bookId) ? 1 : 0;
          const bb = stepBooks.includes(b.bookId) ? 1 : 0;
          if (ba !== bb) return ba - bb;
          return b.salience - a.salience;
        });
      const pick = cands[0];
      if (!pick) continue;
      rank++;
      insSlot.run(themeId, si + 1, pick.passageId, pick.role, rank);
      usedPassages.add(pick.passageId);
      stepBooks.push(pick.bookId);
      usedRoles.set(pick.role, (usedRoles.get(pick.role) ?? 0) + 1);
      slotted++;
    }
  }

  // 3b. Fold away steps that got no passages (their concepts had none left to
  //     give — expected on thin themes) and renumber so ordinals stay dense.
  //     Rule 2 cares that every SHOWN node is a verbatim passage, not that
  //     every authored step survives.
  const emptySteps = (
    rawDb
      .prepare(
        `SELECT s.step_ordinal AS ord FROM lg_theme_spine s
          WHERE s.theme_id = ?
            AND NOT EXISTS (SELECT 1 FROM lg_spine_passages sp
                             WHERE sp.theme_id = s.theme_id AND sp.step_ordinal = s.step_ordinal)`,
      )
      .all(themeId) as { ord: number }[]
  ).map((r) => r.ord);
  if (emptySteps.length > 0) {
    const renumber = rawDb.transaction(() => {
      for (const ord of emptySteps) {
        rawDb
          .prepare("DELETE FROM lg_theme_spine WHERE theme_id = ? AND step_ordinal = ?")
          .run(themeId, ord);
      }
      const remaining = rawDb
        .prepare(
          "SELECT step_ordinal AS ord FROM lg_theme_spine WHERE theme_id = ? ORDER BY step_ordinal",
        )
        .all(themeId) as { ord: number }[];
      remaining.forEach((r, i) => {
        const next = i + 1;
        if (r.ord === next) return;
        rawDb
          .prepare(
            "UPDATE lg_theme_spine SET step_ordinal = ? WHERE theme_id = ? AND step_ordinal = ?",
          )
          .run(next, themeId, r.ord);
        rawDb
          .prepare(
            "UPDATE lg_spine_passages SET step_ordinal = ? WHERE theme_id = ? AND step_ordinal = ?",
          )
          .run(next, themeId, r.ord);
      });
    });
    renumber();
  }

  // 4. Verify (Rule 2 audit — guaranteed by construction, asserted anyway).
  if (status) {
    status.processed = 4;
    status.note = "validating spine";
  }
  const validation = validateSpine(themeId);

  return {
    themeId,
    steps: steps.length - emptySteps.length,
    slottedPassages: slotted,
    droppedUnknownLabels: dropped,
    droppedEmptySteps: emptySteps.length,
    orderingViolations: viols.length,
    orderingRepaired: repaired,
    valid: validation.valid,
    validationErrors: validation.errors,
  };
}

/**
 * Every slotted passage must exist, be in the theme's gathered set, and be
 * linked (via lg_passage_concepts) to a concept of its step; every step must
 * be non-empty.
 */
export function validateSpine(themeId: string): { valid: boolean; errors: string[] } {
  ensureLgTables();
  const errors: string[] = [];
  const steps = rawDb
    .prepare(
      "SELECT step_ordinal AS ord, concept_ids AS cids FROM lg_theme_spine WHERE theme_id = ? ORDER BY step_ordinal",
    )
    .all(themeId) as { ord: number; cids: string }[];
  if (steps.length === 0) errors.push("spine has no steps");
  for (const s of steps) {
    const rows = rawDb
      .prepare(
        "SELECT passage_id AS pid FROM lg_spine_passages WHERE theme_id = ? AND step_ordinal = ?",
      )
      .all(themeId, s.ord) as { pid: string }[];
    if (rows.length === 0) {
      errors.push(`step ${s.ord} has no passages`);
      continue;
    }
    const conceptIds: string[] = JSON.parse(s.cids);
    for (const { pid } of rows) {
      const real = rawDb.prepare("SELECT 1 FROM passages WHERE id = ?").get(pid);
      if (!real) {
        errors.push(`step ${s.ord}: passage ${pid} does not exist`);
        continue;
      }
      const member = rawDb
        .prepare("SELECT 1 FROM lg_theme_passages WHERE theme_id = ? AND passage_id = ?")
        .get(themeId, pid);
      if (!member) errors.push(`step ${s.ord}: passage ${pid} outside the theme's gathered set`);
      const linked = rawDb
        .prepare(
          `SELECT 1 FROM lg_passage_concepts WHERE passage_id = ? AND concept_id IN (${conceptIds.map(() => "?").join(",")})`,
        )
        .get(pid, ...conceptIds);
      if (!linked) errors.push(`step ${s.ord}: passage ${pid} not linked to any step concept`);
    }
  }
  return { valid: errors.length === 0, errors: errors.slice(0, 20) };
}

export interface CompileSpinesResult {
  compiled: number;
  failed: number;
  results: Array<{ themeId: string; steps?: number; valid?: boolean; error?: string }>;
}

/** Batch spine compilation — per-theme failures are recorded, not fatal. */
export async function compileSpines(
  themeIds: string[],
  opts: { model?: string },
  status?: PassStatus,
): Promise<CompileSpinesResult> {
  const result: CompileSpinesResult = { compiled: 0, failed: 0, results: [] };
  if (status) status.total = themeIds.length;
  for (let i = 0; i < themeIds.length; i++) {
    const themeId = themeIds[i];
    if (status) {
      status.processed = i + 1;
      status.note = `spine ${i + 1}/${themeIds.length} · ${themeId}`;
    }
    try {
      const r = await compileSpine(themeId, opts);
      result.compiled++;
      result.results.push({ themeId, steps: r.steps, valid: r.valid });
    } catch (e) {
      result.failed++;
      result.results.push({ themeId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}
