/**
 * Learning graph (lg_*) — Phase 0 schema + shared helpers.
 *
 * The LLM-ingested replacement candidate for the keyphrase concept substrate
 * (docs: ~/Desktop/learning-graph-plan.md): a local LLM reads each nonfiction
 * prose passage and names the CONCEPTS it teaches, each with a pedagogical
 * ROLE and prerequisites; reconciliation merges concept wordings across books;
 * a prerequisite DAG orders them; compile-spine authors a lesson outline and
 * pure code slots the owner's verbatim passages into it (Rule 2: the model
 * structures and sequences — every node shown to a reader is a verbatim
 * passage; the model never authors content presented as fact).
 *
 * Runtime DDL (the ensureBookClassTable pattern) — lg_* lives alongside cs_*
 * until a Phase 3 cutover; Phase 0 is a one-theme prove-or-kill.
 */
import { rawDb } from "../db";

export const LG_ROLES = [
  "definition",
  "example",
  "derivation",
  "application",
  "caveat",
  "anecdote",
  "exercise",
  "summary",
] as const;
export type LgRole = (typeof LG_ROLES)[number];

export const LG_KINDS = ["idea", "method", "person", "event", "term"] as const;
export type LgKind = (typeof LG_KINDS)[number];

let ensured = false;

export function ensureLgTables(): void {
  if (ensured) return;
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS lg_concepts (
      id          TEXT PRIMARY KEY,          -- slug(label); stable join key
      label       TEXT NOT NULL,             -- canonical display form
      kind        TEXT NOT NULL,             -- idea|method|person|event|term
      embedding   BLOB,                      -- MiniLM 384-d f32 (label embedding)
      df          INTEGER NOT NULL DEFAULT 0,
      merged_into TEXT,                      -- non-NULL ⇒ tombstone alias → canonical id
      model_id    TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS lg_passage_concepts (
      passage_id TEXT NOT NULL,
      concept_id TEXT NOT NULL,
      role       TEXT NOT NULL,
      claim      TEXT,
      confidence REAL,                       -- NULL in Phase 0 (uncalibrated)
      model_id   TEXT NOT NULL,
      PRIMARY KEY (passage_id, concept_id)
    );
    CREATE INDEX IF NOT EXISTS idx_lg_pc_concept ON lg_passage_concepts(concept_id);

    -- Extraction ledger = the cache. Passage rows are immutable (re-ingest
    -- mints new ids), so (passage_id, model_id) is a sound cache key.
    -- 'excluded' (non-teachable prose) lives HERE, not as a fake concept row.
    CREATE TABLE IF NOT EXISTS lg_passage_extractions (
      passage_id   TEXT NOT NULL,
      model_id     TEXT NOT NULL,
      status       TEXT NOT NULL,            -- ok|excluded|error
      reason       TEXT,
      extracted_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (passage_id, model_id)
    );

    -- Raw prerequisite labels as extracted (pre-reconciliation). Resolved to
    -- canonical concepts by the prereqs pass AFTER merges, so reconcile can't
    -- orphan them.
    CREATE TABLE IF NOT EXISTS lg_prereq_mentions (
      passage_id   TEXT NOT NULL,
      concept_id   TEXT NOT NULL,
      prereq_label TEXT NOT NULL,
      model_id     TEXT NOT NULL,
      PRIMARY KEY (passage_id, concept_id, prereq_label)
    );

    CREATE TABLE IF NOT EXISTS lg_concept_prereqs (
      concept_id          TEXT NOT NULL,
      requires_concept_id TEXT NOT NULL,
      weight              REAL NOT NULL DEFAULT 0,  -- # supporting mentions
      evidence_passage_id TEXT,
      model_id            TEXT,
      PRIMARY KEY (concept_id, requires_concept_id)
    );

    CREATE TABLE IF NOT EXISTS lg_themes (
      id               TEXT PRIMARY KEY,     -- Phase 0: 'lgt_' + source cs_topics id
      label            TEXT,
      blurb            TEXT,
      concept_ids      TEXT NOT NULL DEFAULT '[]',  -- JSON, canonical ids, df desc
      nonfiction_books INTEGER NOT NULL DEFAULT 0,
      source_topic_id  TEXT,                 -- Phase-0 provenance; form-themes leaves NULL
      model_id         TEXT,
      created_at       INTEGER NOT NULL DEFAULT (unixepoch())
    );
    -- The theme's gathered passage scope (written by extract): every later
    -- pass (reconcile candidates, prereq resolution, spine slotting, the
    -- compare surface) reads membership from here instead of re-gathering.
    CREATE TABLE IF NOT EXISTS lg_theme_passages (
      theme_id   TEXT NOT NULL,
      passage_id TEXT NOT NULL,
      PRIMARY KEY (theme_id, passage_id)
    );
    -- Community assignment: each canonical concept's home theme (the lg analog
    -- of cs_concept_topics) — written by form-themes, read by adjacency.
    CREATE TABLE IF NOT EXISTS lg_concept_themes (
      concept_id TEXT PRIMARY KEY,
      theme_id   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lg_ct_theme ON lg_concept_themes(theme_id);

    -- Reconciliation verdict cache: same-concept adjudications never repeat
    -- (pair normalized a_id < b_id), so threshold iteration and resumed
    -- library passes cost no inference for already-judged pairs.
    CREATE TABLE IF NOT EXISTS lg_reconcile_verdicts (
      a_id            TEXT NOT NULL,
      b_id            TEXT NOT NULL,
      model_id        TEXT NOT NULL,
      same            INTEGER NOT NULL,
      canonical_label TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (a_id, b_id, model_id)
    );

    CREATE TABLE IF NOT EXISTS lg_theme_spine (
      theme_id     TEXT NOT NULL,
      step_ordinal INTEGER NOT NULL,
      step_title   TEXT NOT NULL,
      step_intent  TEXT,
      concept_ids  TEXT NOT NULL DEFAULT '[]',  -- JSON, concepts taught in this step
      model_id     TEXT,
      PRIMARY KEY (theme_id, step_ordinal)
    );
    CREATE TABLE IF NOT EXISTS lg_spine_passages (
      theme_id     TEXT NOT NULL,
      step_ordinal INTEGER NOT NULL,
      passage_id   TEXT NOT NULL,
      role         TEXT NOT NULL,
      rank         INTEGER NOT NULL,
      PRIMARY KEY (theme_id, step_ordinal, passage_id)
    );
  `);
  // Idempotent column additions (the ensureJourneyColumns pattern).
  for (const ddl of [
    "ALTER TABLE lg_themes ADD COLUMN concept_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE lg_themes ADD COLUMN passage_count INTEGER NOT NULL DEFAULT 0",
  ]) {
    try {
      rawDb.exec(ddl);
    } catch {
      /* column already exists */
    }
  }
  ensured = true;
}

/**
 * A theme becomes a servable JOURNEY when it has a label, spans 2-40 nonfiction
 * books (the mega-blob cap mirrors cs JOURNEY_WHERE; no majority-nonfiction
 * clause — every lg passage is nonfiction by construction of the gather), and
 * carries enough concepts to teach.
 */
export const LG_JOURNEY_WHERE =
  "label IS NOT NULL AND nonfiction_books >= 2 AND nonfiction_books <= 40 AND concept_count >= 6";

/** Journeys cut over to lg_* once this many gated themes are LLM-named. */
export const LG_CUTOVER_MIN = 10;

/** Canonical id form of a concept label: lowercase, diacritics stripped, slugged. */
export function slugifyLabel(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Follow merged_into tombstone pointers to the canonical concept id. */
export function resolveConceptId(id: string): string {
  const stmt = rawDb.prepare("SELECT merged_into AS m FROM lg_concepts WHERE id = ?");
  let current = id;
  for (let depth = 0; depth < 5; depth++) {
    const row = stmt.get(current) as { m: string | null } | undefined;
    if (!row?.m) return current;
    current = row.m;
  }
  return current;
}

/** Recompute lg_concepts.df from lg_passage_concepts (simpler than bookkeeping under merges). */
export function recomputeDf(): void {
  rawDb.exec(
    "UPDATE lg_concepts SET df = (SELECT COUNT(*) FROM lg_passage_concepts pc WHERE pc.concept_id = lg_concepts.id)",
  );
}

/**
 * Canonical (non-tombstone) concepts whose home community is this theme and
 * which are referenced by one of its passages, df-desc; persisted onto the
 * theme row. Restricting this to home concepts prevents an incidental concept
 * on one assigned passage from contaminating the theme's curriculum inventory.
 */
export function refreshThemeConcepts(themeId: string): string[] {
  const ids = (
    rawDb
      .prepare(
        `SELECT DISTINCT c.id AS id, c.df AS df
           FROM lg_theme_passages tp
           JOIN lg_passage_concepts pc ON pc.passage_id = tp.passage_id
           JOIN lg_concepts c ON c.id = pc.concept_id
           JOIN lg_concept_themes ct ON ct.concept_id = c.id AND ct.theme_id = tp.theme_id
          WHERE tp.theme_id = ? AND c.merged_into IS NULL
          ORDER BY c.df DESC`,
      )
      .all(themeId) as { id: string }[]
  ).map((r) => r.id);
  const passageCount = (
    rawDb
      .prepare("SELECT COUNT(*) AS n FROM lg_theme_passages WHERE theme_id = ?")
      .get(themeId) as { n: number }
  ).n;
  rawDb
    .prepare(
      "UPDATE lg_themes SET concept_ids = ?, concept_count = ?, passage_count = ? WHERE id = ?",
    )
    .run(JSON.stringify(ids), ids.length, passageCount, themeId);
  return ids;
}
