/**
 * lg journey read models — the Phase-3 cutover surface. Same return shapes as
 * the cs_* functions in app/lib/concept/wander.ts, so app/actions/substrate.ts
 * and server/routes/substrate.ts (iOS) swap sources without client changes.
 *
 * Cutover is DATA PRESENCE, not config: lgJourneysLive() flips true once
 * enough gated themes are LLM-named (the naming pass is deliberately the last
 * quality gate). LG_JOURNEYS_DISABLE=1 is the non-destructive kill switch.
 *
 * Curricula have two modes — the instant-curriculum bridge:
 *   spine mode  — a compiled lg_theme_spine exists (LLM outline + slotting)
 *   draft mode  — pure SQL (role-priority buckets → salience → book
 *                 alternation), served instantly; opening a gated theme
 *                 queues its spine compilation in the background, so the
 *                 next open upgrades to spine mode with zero client changes.
 */
import { rawDb } from "../db";
import { startPass } from "../llm/lane";
import { ensureLgTables, LG_JOURNEY_WHERE, LG_CUTOVER_MIN, type LgRole } from "./schema";
import { compileSpine } from "./spine";

export interface JourneyTopicRow {
  id: string;
  label: string | null;
  size: number;
  bookCount: number;
}

export interface CurriculumItem {
  ordinal: number;
  passageId: string;
  bookId: string;
  bookTitle: string;
  snippet: string;
  module: string;
  role: string;
  transition: string;
  seen: boolean;
}

export interface Curriculum {
  id: string;
  topicId: string;
  title: string;
  builder: string;
  items: CurriculumItem[];
}

const DRAFT_ROLE_ORDER: LgRole[] = [
  "definition",
  "derivation",
  "example",
  "application",
  "caveat",
  "anecdote",
  "summary",
  "exercise",
];

// Strip HTML the way wander.ts snip does (EPUB extraction leaves markup).
const snip = (s: string, n = 200) => {
  const t = s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;|&quot;/gi, "'")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** Journeys serve from lg_* once enough gated themes carry LLM names. */
export function lgJourneysLive(): boolean {
  if (process.env.LG_JOURNEYS_DISABLE === "1") return false;
  ensureLgTables();
  const n = (
    rawDb
      .prepare(
        `SELECT COUNT(*) AS n FROM lg_themes WHERE ${LG_JOURNEY_WHERE} AND blurb IS NOT NULL`,
      )
      .get() as { n: number }
  ).n;
  return n >= LG_CUTOVER_MIN;
}

export function lgListJourneyTopics(opts: { limit?: number; offset?: number; ids?: string[] }): {
  topics: JourneyTopicRow[];
  total: number;
} {
  ensureLgTables();
  if (opts.ids && opts.ids.length > 0) {
    const ids = opts.ids.slice(0, 80);
    const rows = rawDb
      .prepare(
        `SELECT id, label, concept_count AS size, nonfiction_books AS bookCount
           FROM lg_themes WHERE id IN (${ids.map(() => "?").join(",")})`,
      )
      .all(...ids) as JourneyTopicRow[];
    return { topics: rows, total: rows.length };
  }
  const limit = Math.min(80, Math.max(1, opts.limit ?? 60));
  const offset = Math.max(0, opts.offset ?? 0);
  const topics = rawDb
    .prepare(
      `SELECT id, label, concept_count AS size, nonfiction_books AS bookCount
         FROM lg_themes WHERE ${LG_JOURNEY_WHERE}
        ORDER BY nonfiction_books DESC, concept_count DESC LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as JourneyTopicRow[];
  const total = (
    rawDb.prepare(`SELECT COUNT(*) AS n FROM lg_themes WHERE ${LG_JOURNEY_WHERE}`).get() as {
      n: number;
    }
  ).n;
  return { topics, total };
}

export function lgSearchJourneys(q: string): JourneyTopicRow[] {
  ensureLgTables();
  const needle = q.toLowerCase().trim();
  return rawDb
    .prepare(
      `SELECT id, label, concept_count AS size, nonfiction_books AS bookCount
         FROM lg_themes
        WHERE ${LG_JOURNEY_WHERE}
          AND (INSTR(LOWER(label), ?) > 0 OR INSTR(LOWER(COALESCE(blurb, '')), ?) > 0)
        ORDER BY
          CASE
            WHEN LOWER(label) = ? THEN 0
            WHEN INSTR(LOWER(label), ?) = 1 THEN 1
            WHEN INSTR(LOWER(label), ?) > 0 THEN 2
            ELSE 3
          END,
          nonfiction_books DESC, concept_count DESC
        LIMIT 20`,
    )
    .all(needle, needle, needle, needle, needle) as JourneyTopicRow[];
}

/**
 * Adjacent themes: passage-mediated — this theme's passages carry concepts
 * whose HOME community (lg_concept_themes) is a different gated theme. (The
 * cs version's self-join was degenerate; this one actually returns forks.)
 */
export function lgAdjacentThemes(themeId: string): JourneyTopicRow[] {
  ensureLgTables();
  return rawDb
    .prepare(
      `SELECT t.id, t.label, t.concept_count AS size, t.nonfiction_books AS bookCount
         FROM lg_theme_passages tp
         JOIN lg_passage_concepts pc ON pc.passage_id = tp.passage_id
         JOIN lg_concept_themes ct ON ct.concept_id = pc.concept_id AND ct.theme_id != tp.theme_id
         JOIN lg_themes t ON t.id = ct.theme_id
        WHERE tp.theme_id = ? AND ${LG_JOURNEY_WHERE.replace(/\b(label|nonfiction_books|concept_count)\b/g, "t.$1")}
        GROUP BY t.id ORDER BY COUNT(*) DESC LIMIT 6`,
    )
    .all(themeId) as JourneyTopicRow[];
}

/** Topic detail for /api/topics/:id parity: theme row + top core passages. */
export function lgTopicDetail(themeId: string): {
  id: string;
  label: string | null;
  size: number;
  bookCount: number;
  coverage: null;
  core: Array<{ passageId: string; text: string; bookId: string; bookTitle: string }>;
} | null {
  ensureLgTables();
  const theme = rawDb
    .prepare(
      "SELECT id, label, concept_count AS size, nonfiction_books AS bookCount FROM lg_themes WHERE id = ?",
    )
    .get(themeId) as
    | { id: string; label: string | null; size: number; bookCount: number }
    | undefined;
  if (!theme) return null;
  const core = (
    rawDb
      .prepare(
        `SELECT tp.passage_id AS passageId, p.text, p.book_id AS bookId, b.title AS bookTitle
           FROM lg_theme_passages tp
           JOIN passages p ON p.id = tp.passage_id
           JOIN books b ON b.id = p.book_id
           JOIN cs_passage_salience s ON s.passage_id = tp.passage_id
          WHERE tp.theme_id = ? ORDER BY s.salience DESC LIMIT 12`,
      )
      .all(themeId) as Array<{ passageId: string; text: string; bookId: string; bookTitle: string }>
  ).map((p) => ({ ...p, text: snip(p.text, 300) }));
  return { ...theme, coverage: null, core };
}

/**
 * The journey reading path. Spine mode when compiled; draft mode instantly
 * otherwise (and quietly queues the spine compile unless noEnqueue).
 */
export function lgBuildCurriculum(
  themeId: string,
  profileId?: string,
  opts?: { noEnqueue?: boolean },
): Curriculum | null {
  ensureLgTables();
  const theme = rawDb.prepare("SELECT id, label FROM lg_themes WHERE id = ?").get(themeId) as
    | { id: string; label: string | null }
    | undefined;
  if (!theme || !theme.label) return null;

  const seen = new Set<string>();
  if (profileId) {
    for (const r of rawDb
      .prepare("SELECT passage_id AS pid FROM passage_seen WHERE profile_id = ?")
      .all(profileId) as { pid: string }[]) {
      seen.add(r.pid);
    }
  }

  // --- spine mode -------------------------------------------------------------
  const spineSteps = rawDb
    .prepare(
      "SELECT step_ordinal AS ord, step_title AS title, step_intent AS intent FROM lg_theme_spine WHERE theme_id = ? ORDER BY step_ordinal",
    )
    .all(themeId) as Array<{ ord: number; title: string; intent: string | null }>;
  if (spineSteps.length > 0) {
    const slotStmt = rawDb.prepare(
      `SELECT sp.passage_id AS pid, sp.role, p.book_id AS bookId, b.title AS bookTitle, p.text
         FROM lg_spine_passages sp
         JOIN passages p ON p.id = sp.passage_id
         JOIN books b ON b.id = p.book_id
        WHERE sp.theme_id = ? AND sp.step_ordinal = ? ORDER BY sp.rank`,
    );
    const items: CurriculumItem[] = [];
    for (const step of spineSteps) {
      const slots = slotStmt.all(themeId, step.ord) as Array<{
        pid: string;
        role: string;
        bookId: string;
        bookTitle: string;
        text: string;
      }>;
      slots.forEach((s, i) => {
        items.push({
          ordinal: items.length + 1,
          passageId: s.pid,
          bookId: s.bookId,
          bookTitle: s.bookTitle,
          snippet: snip(s.text),
          module: `${step.ord}. ${step.title}`,
          role: s.role,
          transition: i === 0 ? (step.intent ?? "") : "",
          seen: seen.has(s.pid),
        });
      });
    }
    if (items.length > 0) {
      return {
        id: `lgcur_${themeId}`,
        topicId: themeId,
        title: theme.label,
        builder: "lg-spine",
        items,
      };
    }
  }

  // --- draft mode (instant, pure SQL) -----------------------------------------
  // Best role per passage = the min ROLE_PRIORITY index among its concept links.
  const candidates = rawDb
    .prepare(
      `SELECT tp.passage_id AS pid, p.book_id AS bookId, b.title AS bookTitle, p.text,
              COALESCE(s.salience, 0) AS salience,
              (SELECT pc.role FROM lg_passage_concepts pc WHERE pc.passage_id = tp.passage_id
                AND EXISTS (
                  SELECT 1 FROM lg_concept_themes ct
                   WHERE ct.concept_id = pc.concept_id AND ct.theme_id = tp.theme_id
                )
                ORDER BY CASE pc.role
                  WHEN 'definition' THEN 0 WHEN 'derivation' THEN 1 WHEN 'example' THEN 2
                  WHEN 'application' THEN 3 WHEN 'caveat' THEN 4 WHEN 'anecdote' THEN 5
                  WHEN 'summary' THEN 6 ELSE 7 END LIMIT 1) AS role
         FROM lg_theme_passages tp
         JOIN passages p ON p.id = tp.passage_id
         JOIN books b ON b.id = p.book_id
         LEFT JOIN cs_passage_salience s ON s.passage_id = tp.passage_id
        WHERE tp.theme_id = ?
        ORDER BY salience DESC LIMIT 80`,
    )
    .all(themeId) as Array<{
    pid: string;
    bookId: string;
    bookTitle: string;
    text: string;
    salience: number;
    role: string | null;
  }>;
  if (candidates.length === 0) return null;

  // Role-priority buckets (definitions open, exercises close), salience within,
  // then greedy book alternation — the buildConceptCurriculum loop.
  const bucketOf = (role: string | null) => {
    const i = DRAFT_ROLE_ORDER.indexOf((role ?? "") as LgRole);
    return i === -1 ? DRAFT_ROLE_ORDER.length : i;
  };
  candidates.sort((a, b) => bucketOf(a.role) - bucketOf(b.role) || b.salience - a.salience);
  const pool = [...candidates];
  const ordered: typeof candidates = [];
  let lastBook: string | null = null;
  while (pool.length > 0) {
    let idx = pool.findIndex((m) => m.bookId !== lastBook);
    if (idx === -1) idx = 0;
    const [picked] = pool.splice(idx, 1);
    ordered.push(picked);
    lastBook = picked.bookId;
    if (ordered.length >= 48) break;
  }

  // Queue the real spine in the background (first open wins; the lane's
  // duplicate-name refusal makes repeat opens free).
  if (!opts?.noEnqueue) {
    const gated = rawDb
      .prepare(`SELECT 1 FROM lg_themes WHERE id = ? AND ${LG_JOURNEY_WHERE}`)
      .get(themeId);
    if (gated) {
      startPass(`lg-compile:${themeId}`, (s) => compileSpine(themeId, {}, s));
    }
  }

  return {
    id: `lgcur_${themeId}`,
    topicId: themeId,
    title: theme.label,
    builder: "lg-draft",
    items: ordered.map((m, i) => ({
      ordinal: i + 1,
      passageId: m.pid,
      bookId: m.bookId,
      bookTitle: m.bookTitle,
      snippet: snip(m.text),
      module: `Part ${Math.floor(i / 6) + 1}`,
      role: m.role ?? (i === 0 ? "entry" : "passage"),
      transition: "",
      seen: seen.has(m.pid),
    })),
  };
}
