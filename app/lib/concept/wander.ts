/**
 * Wander over the concept substrate — grounded, cross-book steps from pure set
 * operations over cs_passage_concepts / cs_concept_edges / cs_passage_topics.
 * No embeddings, no inference: every step is a few indexed lookups.
 */
import { rawDb } from "../db";
import { nameTopic } from "../llm/ollama";
import { tick as laneTick, type PassStatus } from "../llm/lane";

export interface WanderStep {
  kind: "same_idea" | "deeper" | "bridge";
  passageId: string;
  bookId: string;
  bookTitle: string;
  snippet: string;
  reason: string;
  shared: string[];
}

export interface WanderStop {
  passageId: string;
  bookId: string;
  bookTitle: string;
  text: string;
  topicId: string | null;
  topicLabel: string | null;
  concepts: string[];
  steps: WanderStep[];
}

// Strip HTML (EPUB extraction leaves <code>/<span> + entities in passage text)
// so native clients get clean prose, not markup.
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
  return t.length > n ? t.slice(0, n) + "…" : t;
};

const Q = {
  passage: rawDb.prepare(
    `SELECT p.id, p.book_id AS bookId, b.title AS bookTitle, p.text
     FROM passages p JOIN books b ON b.id = p.book_id WHERE p.id = ?`,
  ),
  concepts: rawDb.prepare(
    `SELECT c.display FROM cs_passage_concepts pc JOIN cs_concepts c ON c.id = pc.concept_id
     WHERE pc.passage_id = ? ORDER BY c.df ASC LIMIT 8`,
  ),
  topic: rawDb.prepare(
    `SELECT t.id, t.label FROM cs_passage_topics pt JOIN cs_topics t ON t.id = pt.topic_id WHERE pt.passage_id = ?`,
  ),
  // passages sharing the most concepts, in a different book
  sameIdea: rawDb.prepare(
    `SELECT pc2.passage_id AS pid, p.book_id AS bookId, b.title AS bookTitle, p.text,
            GROUP_CONCAT(c.display, '|') AS shared, COUNT(*) AS n
     FROM cs_passage_concepts pc1
     JOIN cs_passage_concepts pc2 ON pc2.concept_id = pc1.concept_id AND pc2.passage_id != pc1.passage_id
     JOIN cs_concepts c ON c.id = pc1.concept_id
     JOIN passages p ON p.id = pc2.passage_id
     JOIN books b ON b.id = p.book_id
     WHERE pc1.passage_id = ? AND p.book_id != ?
     GROUP BY pc2.passage_id ORDER BY n DESC, pid LIMIT ?`,
  ),
  // a high-salience passage in the SAME topic (go deeper)
  deeper: rawDb.prepare(
    `SELECT pt.passage_id AS pid, p.book_id AS bookId, b.title AS bookTitle, p.text
     FROM cs_passage_topics pt JOIN passages p ON p.id = pt.passage_id JOIN books b ON b.id = p.book_id
     JOIN cs_passage_salience s ON s.passage_id = pt.passage_id
     WHERE pt.topic_id = ? AND pt.passage_id != ? ORDER BY s.salience DESC LIMIT ?`,
  ),
  // a passage in a DIFFERENT topic that still shares a concept (serendipitous bridge)
  bridge: rawDb.prepare(
    `SELECT pc2.passage_id AS pid, p.book_id AS bookId, b.title AS bookTitle, p.text, c.display AS shared
     FROM cs_passage_concepts pc1
     JOIN cs_passage_concepts pc2 ON pc2.concept_id = pc1.concept_id AND pc2.passage_id != pc1.passage_id
     JOIN cs_concepts c ON c.id = pc1.concept_id
     JOIN passages p ON p.id = pc2.passage_id
     JOIN books b ON b.id = p.book_id
     JOIN cs_passage_topics pt ON pt.passage_id = pc2.passage_id
     WHERE pc1.passage_id = ? AND pt.topic_id IS NOT ? AND c.df <= 60
     GROUP BY pt.topic_id ORDER BY RANDOM() LIMIT ?`,
  ),
  randomSalient: rawDb.prepare(
    `SELECT passage_id AS pid FROM cs_passage_salience WHERE prose >= 0.5 ORDER BY RANDOM() LIMIT 1`,
  ),
};

type Row = {
  pid: string;
  bookId: string;
  bookTitle: string;
  text: string;
  shared?: string;
  n?: number;
};

export function conceptStop(passageId: string): WanderStop | null {
  const p = Q.passage.get(passageId) as
    | { id: string; bookId: string; bookTitle: string; text: string }
    | undefined;
  if (!p) return null;
  const concepts = (Q.concepts.all(passageId) as { display: string }[]).map((r) => r.display);
  const topic = Q.topic.get(passageId) as { id: string; label: string | null } | undefined;
  const used = new Set([passageId]);
  const steps: WanderStep[] = [];

  for (const r of Q.sameIdea.all(passageId, p.bookId, 4) as Row[]) {
    if (used.has(r.pid)) continue;
    used.add(r.pid);
    const shared = (r.shared ?? "").split("|").slice(0, 4);
    steps.push({
      kind: "same_idea",
      passageId: r.pid,
      bookId: r.bookId,
      bookTitle: r.bookTitle,
      snippet: snip(r.text),
      reason: `Same idea in another book — shares ${shared.join(", ")}`,
      shared,
    });
  }
  if (topic)
    for (const r of Q.deeper.all(topic.id, passageId, 2) as Row[]) {
      if (used.has(r.pid)) continue;
      used.add(r.pid);
      steps.push({
        kind: "deeper",
        passageId: r.pid,
        bookId: r.bookId,
        bookTitle: r.bookTitle,
        snippet: snip(r.text),
        reason: `Deeper into ${topic.label ?? "this topic"}`,
        shared: [],
      });
    }
  for (const r of Q.bridge.all(passageId, topic?.id ?? null, 2) as Row[]) {
    if (used.has(r.pid)) continue;
    used.add(r.pid);
    steps.push({
      kind: "bridge",
      passageId: r.pid,
      bookId: r.bookId,
      bookTitle: r.bookTitle,
      snippet: snip(r.text),
      reason: `Somewhere else entirely — via ${r.shared}`,
      shared: r.shared ? [r.shared] : [],
    });
  }

  return {
    passageId: p.id,
    bookId: p.bookId,
    bookTitle: p.bookTitle,
    text: p.text,
    topicId: topic?.id ?? null,
    topicLabel: topic?.label ?? null,
    concepts,
    steps,
  };
}

export function conceptStartRandom(): string | null {
  return (Q.randomSalient.get() as { pid: string } | undefined)?.pid ?? null;
}

export function conceptTopics(
  limit = 40,
): Array<{ id: string; label: string | null; size: number; bookCount: number }> {
  return rawDb
    .prepare(
      "SELECT id, label, size, book_count AS bookCount FROM cs_topics WHERE book_count >= 1 ORDER BY size DESC LIMIT ?",
    )
    .all(limit) as Array<{ id: string; label: string | null; size: number; bookCount: number }>;
}

// --- journey read-model: nonfiction-gated, distinctively-labelled ------------------
//
// The raw cs_topics are dominated by (a) extraction markup ("annotations", "span
// class"), (b) fiction character clusters, and (c) generic-df labels ("code,
// section, data"). The journeys read-model fixes all three WITHOUT a graph
// rebuild: a one-time refresh pass writes two derived columns onto cs_topics —
// `nonfiction_books` (so journeys gate on the classify-book verdicts) and
// `display_label` (the topic's most prominent DISTINCTIVE concepts, junk/generic/
// citation excluded). A topic with no distinctive concepts gets a null label and
// drops out entirely.

/** Markup/structure + code + tooling artifacts that leak through extraction. */
const MARKUP_RE =
  /ldquo|rdquo|rsquo|annotation|delimiter|literal|title-page|\bcode\b|\bclass\b|\bspan\b|\bibid\b|discussion discussion|see also problem|var |item from|\b(const|void|int|char|func|return|null|struct|param|println|printf|stdout|def|loop|args)\b|\bhttps?\b|\bgithub\b|\bwww\b|packtpublishing|\.com\b|create new node|scene tab|editor window|menu item/i;
/** Publisher / citation / place metadata (a shared publisher or city isn't a subject). */
const CITATION_RE =
  /\b(press|university|bibliography|references|isbn|vol|reprint|edition|new york|york|london|oxford|cambridge|routledge|penguin|harper|norton|wiley|springer|mcgraw|doubleday|scholastic|vintage|knopf|simon schuster|publishing|publisher|fantasy flight)\b/i;
/** Common words too generic to anchor a learning theme. */
const GENERIC_CONCEPTS = new Set([
  "people",
  "everyone",
  "change",
  "need",
  "computer",
  "time",
  "life",
  "yourself",
  "myself",
  "inside",
  "outside",
  "signal",
  "event",
  "contents",
  "introduction",
  "data",
  "world",
  "system",
  "states",
  "united",
  "united states",
  "present",
  "grow",
  "help",
  "things",
  "example",
  "number",
  "value",
  "work",
  "part",
  "case",
  "point",
  "level",
  "order",
  "form",
  "state",
  "process",
  "section",
  "chapter",
  "figure",
  "table",
  "page",
  "book",
  "author",
  "note",
  "way",
  "thing",
  "section",
]);

/** True if a concept is markup / citation / too-generic to label a journey. */
function isJunkConcept(display: string): boolean {
  const lower = display.toLowerCase().trim();
  if (lower.length < 4) return true;
  if (GENERIC_CONCEPTS.has(lower)) return true;
  if (MARKUP_RE.test(lower)) return true;
  if (CITATION_RE.test(lower)) return true;
  return false;
}

/** Idempotently add the derived journey columns to cs_topics. */
export function ensureJourneyColumns(): void {
  for (const ddl of [
    "ALTER TABLE cs_topics ADD COLUMN nonfiction_books INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE cs_topics ADD COLUMN display_label TEXT",
    // LLM-authored name + blurb, preferred over the regex `display_label` when
    // present. The "fleet_" prefix is historical (naming used to run on fleet
    // devices; it now runs on the server's Ollama — see runTopicNaming).
    "ALTER TABLE cs_topics ADD COLUMN fleet_label TEXT",
    "ALTER TABLE cs_topics ADD COLUMN fleet_blurb TEXT",
    "ALTER TABLE cs_topics ADD COLUMN fleet_model TEXT",
  ]) {
    try {
      rawDb.exec(ddl);
    } catch {
      /* column already exists */
    }
  }
}

/** The label shown to readers: the fleet-authored name if present, else the
 *  distinctive regex label. */
const LABEL_EXPR = "COALESCE(fleet_label, display_label)";

const tick = () => new Promise<void>((r) => setImmediate(r));

/**
 * Recompute the journey read-model: per topic, count its NONFICTION books and
 * derive a distinctive `display_label`. Chunked + yields so it never holds the
 * single web thread (run detached). Re-run after classification changes.
 */
export async function refreshJourneyReadModel(): Promise<{
  topics: number;
  nonfictionTopics: number;
  labelled: number;
}> {
  ensureJourneyColumns();
  const topics = rawDb.prepare("SELECT id FROM cs_topics").all() as { id: string }[];
  const conceptsOf = rawDb.prepare(
    `SELECT c.display AS display, c.df AS df
       FROM cs_concept_topics ct JOIN cs_concepts c ON c.id = ct.concept_id
      WHERE ct.topic_id = ? ORDER BY c.df DESC`,
  );
  const nfOf = rawDb.prepare(
    `SELECT COUNT(DISTINCT p.book_id) AS n
       FROM cs_passage_topics pt
       JOIN passages p ON p.id = pt.passage_id
       JOIN cs_book_class cc ON cc.book_id = p.book_id AND cc.category = 'nonfiction'
      WHERE pt.topic_id = ?`,
  );
  const upd = rawDb.prepare(
    "UPDATE cs_topics SET nonfiction_books = ?, display_label = ? WHERE id = ?",
  );

  let nonfictionTopics = 0;
  let labelled = 0;
  let i = 0;
  for (const t of topics) {
    if (++i % 100 === 0) await tick();
    const nf = (nfOf.get(t.id) as { n: number }).n;
    const concepts = (conceptsOf.all(t.id) as { display: string; df: number }[]).filter(
      (c) => !isJunkConcept(c.display),
    );
    // Prefer multi-word concepts, then most prominent (highest df) among non-junk.
    concepts.sort(
      (a, b) =>
        (b.display.includes(" ") ? 1 : 0) - (a.display.includes(" ") ? 1 : 0) || b.df - a.df,
    );
    const label =
      concepts
        .slice(0, 3)
        .map((c) => c.display)
        .join(", ") || null;
    upd.run(nf, label, t.id);
    if (nf >= 2) nonfictionTopics++;
    if (label) labelled++;
  }
  return { topics: topics.length, nonfictionTopics, labelled };
}

// A journey must: span ≥2 nonfiction books, be MAJORITY-nonfiction (so a fiction
// cluster with a couple misclassified books doesn't pass), not be a degenerate
// mega-blob (a 96-book "topic" is failed clustering, not a theme), and carry a
// distinctive label.
const JOURNEY_WHERE =
  "nonfiction_books >= 2 AND nonfiction_books * 2 >= book_count AND book_count <= 40 " +
  "AND display_label IS NOT NULL AND size >= 6";

/**
 * Name nonfiction journey topics that don't yet have an LLM-authored name.
 * For each topic the local LLM gets the topic's distinctive concepts + a few
 * high-salience nonfiction excerpts and returns a human shelf-card name →
 * cs_topics.fleet_label ("fleet" is historical — the naming used to run on
 * fleet devices; it now runs on the server's Ollama). Bounded; resumable
 * (topics with a label are skipped). Run detached on the LLM lane, after a
 * journeys refresh.
 */
export async function runTopicNaming(
  opts: { limit?: number },
  status?: PassStatus,
): Promise<{ named: number; failed: number; candidates: number }> {
  ensureJourneyColumns();
  const limit = opts?.limit ?? 600;
  const topics = rawDb
    .prepare(
      `SELECT id FROM cs_topics WHERE ${JOURNEY_WHERE} AND fleet_label IS NULL
        ORDER BY nonfiction_books DESC, size DESC LIMIT ?`,
    )
    .all(limit) as { id: string }[];
  const conceptsOf = rawDb.prepare(
    `SELECT c.display AS display FROM cs_concept_topics ct JOIN cs_concepts c ON c.id = ct.concept_id
      WHERE ct.topic_id = ? ORDER BY c.df ASC LIMIT 40`,
  );
  const samplesOf = rawDb.prepare(
    `SELECT p.text AS text FROM cs_passage_topics pt
       JOIN passages p ON p.id = pt.passage_id
       JOIN cs_book_class cc ON cc.book_id = p.book_id AND cc.category = 'nonfiction'
       JOIN cs_passage_salience s ON s.passage_id = pt.passage_id
      WHERE pt.topic_id = ? AND s.prose >= 0.5 ORDER BY s.salience DESC LIMIT 3`,
  );
  const applyName = rawDb.prepare(
    "UPDATE cs_topics SET fleet_label = ?, fleet_blurb = ?, fleet_model = ? WHERE id = ?",
  );
  if (status) status.total = topics.length;
  let named = 0;
  let failed = 0;
  for (const t of topics) {
    const concepts = (conceptsOf.all(t.id) as { display: string }[])
      .map((r) => r.display)
      .filter((d) => !isJunkConcept(d))
      .slice(0, 8);
    const samples = (samplesOf.all(t.id) as { text: string }[]).map((r) =>
      r.text.replace(/\s+/g, " ").trim().slice(0, 400),
    );
    if (status) status.processed++;
    if (concepts.length === 0 || samples.length === 0) continue;
    try {
      const r = await nameTopic({ concepts, samples });
      const label = r.label.trim();
      // Shelf-card bounds (was the fabric validator): 3-60 chars, single line.
      if (label.length < 3 || label.length > 60 || /\n/.test(label)) {
        failed++;
        continue;
      }
      applyName.run(label, r.blurb.trim().slice(0, 200), r.modelId, t.id);
      named++;
      if (status) status.note = label;
    } catch (e) {
      failed++;
      console.warn(`[name-topic] ${t.id}: ${e instanceof Error ? e.message : e}`);
    }
    await laneTick();
  }
  return { named, failed, candidates: topics.length };
}

export function listConceptJourneyTopics(opts: {
  limit?: number;
  offset?: number;
  ids?: string[];
}): {
  topics: Array<{ id: string; label: string | null; size: number; bookCount: number }>;
  total: number;
} {
  ensureJourneyColumns();
  if (opts.ids && opts.ids.length > 0) {
    const ids = opts.ids.slice(0, 80);
    const ph = ids.map(() => "?").join(",");
    const rows = rawDb
      .prepare(
        `SELECT id, ${LABEL_EXPR} AS label, size, nonfiction_books AS bookCount FROM cs_topics WHERE id IN (${ph})`,
      )
      .all(...ids) as Array<{ id: string; label: string | null; size: number; bookCount: number }>;
    return { topics: rows, total: rows.length };
  }
  const limit = Math.min(80, Math.max(1, opts.limit ?? 60));
  const offset = Math.max(0, opts.offset ?? 0);
  const rows = rawDb
    .prepare(
      `SELECT id, ${LABEL_EXPR} AS label, size, nonfiction_books AS bookCount
         FROM cs_topics WHERE ${JOURNEY_WHERE} ORDER BY nonfiction_books DESC, size DESC LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as Array<{
    id: string;
    label: string | null;
    size: number;
    bookCount: number;
  }>;
  const total = (
    rawDb.prepare(`SELECT COUNT(*) AS c FROM cs_topics WHERE ${JOURNEY_WHERE}`).get() as {
      c: number;
    }
  ).c;
  return { topics: rows, total };
}

interface ConceptCurriculumItem {
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

/**
 * Build a journey's reading path from the CONCEPT substrate (fixes the old
 * substrate-mismatch where buildCurriculum looked up a cs_topics id in the legacy
 * `topics` table and 404'd). Nonfiction passages in the topic, ordered by
 * salience, greedily alternating books so an idea is met in more than one
 * author's treatment. Same shape the journey UI already consumes.
 */
export function buildConceptCurriculum(
  topicId: string,
  profileId?: string,
): {
  id: string;
  topicId: string;
  title: string;
  builder: string;
  items: ConceptCurriculumItem[];
} | null {
  const topic = rawDb
    .prepare(`SELECT id, ${LABEL_EXPR} AS label, fleet_blurb AS blurb FROM cs_topics WHERE id = ?`)
    .get(topicId) as { id: string; label: string | null } | undefined;
  if (!topic || !topic.label) return null;

  const members = rawDb
    .prepare(
      `SELECT pt.passage_id AS pid, p.book_id AS bookId, b.title AS bookTitle, p.text, s.salience
         FROM cs_passage_topics pt
         JOIN passages p ON p.id = pt.passage_id
         JOIN books b ON b.id = p.book_id
         JOIN cs_book_class cc ON cc.book_id = p.book_id AND cc.category = 'nonfiction'
         JOIN cs_passage_salience s ON s.passage_id = pt.passage_id
        WHERE pt.topic_id = ? AND s.prose >= 0.5
        ORDER BY s.salience DESC LIMIT 80`,
    )
    .all(topicId) as Array<{
    pid: string;
    bookId: string;
    bookTitle: string;
    text: string;
    salience: number;
  }>;
  if (members.length === 0) return null;

  // Greedy book-alternation: keep salience order but avoid the same book twice in
  // a row when another book is available.
  const pool = [...members];
  const ordered: typeof members = [];
  let lastBook: string | null = null;
  while (pool.length > 0) {
    let idx = pool.findIndex((m) => m.bookId !== lastBook);
    if (idx === -1) idx = 0;
    const [picked] = pool.splice(idx, 1);
    ordered.push(picked);
    lastBook = picked.bookId;
    if (ordered.length >= 48) break;
  }

  const seen = new Set<string>();
  if (profileId) {
    for (const r of rawDb
      .prepare("SELECT passage_id AS pid FROM passage_seen WHERE profile_id = ?")
      .all(profileId) as { pid: string }[]) {
      seen.add(r.pid);
    }
  }

  const items: ConceptCurriculumItem[] = ordered.map((m, i) => ({
    ordinal: i + 1,
    passageId: m.pid,
    bookId: m.bookId,
    bookTitle: m.bookTitle,
    snippet: snip(m.text),
    module: `Part ${Math.floor(i / 6) + 1}`,
    role: i === 0 ? "entry" : "passage",
    transition: "",
    seen: seen.has(m.pid),
  }));

  return { id: topicId, topicId, title: topic.label, builder: "concept", items };
}

/** Search journey topics by their distinctive label (concept substrate). */
export function conceptSearchJourneys(
  q: string,
): Array<{ id: string; label: string | null; size: number; bookCount: number }> {
  const needle = q.toLowerCase().trim();
  return rawDb
    .prepare(
      `SELECT id, ${LABEL_EXPR} AS label, size, nonfiction_books AS bookCount
         FROM cs_topics
        WHERE ${JOURNEY_WHERE}
          AND (
            INSTR(LOWER(${LABEL_EXPR}), ?) > 0
            OR INSTR(LOWER(display_label), ?) > 0
            OR INSTR(LOWER(COALESCE(fleet_blurb, '')), ?) > 0
          )
        ORDER BY
          CASE
            WHEN LOWER(${LABEL_EXPR}) = ? THEN 0
            WHEN INSTR(LOWER(${LABEL_EXPR}), ?) = 1 THEN 1
            WHEN INSTR(LOWER(${LABEL_EXPR}), ?) > 0 THEN 2
            WHEN INSTR(LOWER(display_label), ?) > 0 THEN 3
            ELSE 4
          END,
          nonfiction_books DESC, size DESC
        LIMIT 20`,
    )
    .all(needle, needle, needle, needle, needle, needle, needle) as Array<{
    id: string;
    label: string | null;
    size: number;
    bookCount: number;
  }>;
}

/** Nonfiction topics that share concepts with this one — the journey's forks. */
export function conceptAdjacentTopics(
  topicId: string,
): Array<{ id: string; label: string | null; size: number; bookCount: number }> {
  return rawDb
    .prepare(
      `SELECT t.id, COALESCE(t.fleet_label, t.display_label) AS label, t.size, t.nonfiction_books AS bookCount
         FROM cs_concept_topics ct1
         JOIN cs_concept_topics ct2 ON ct2.concept_id = ct1.concept_id AND ct2.topic_id != ct1.topic_id
         JOIN cs_topics t ON t.id = ct2.topic_id
        WHERE ct1.topic_id = ? AND t.display_label IS NOT NULL AND t.nonfiction_books >= 2
        GROUP BY ct2.topic_id ORDER BY COUNT(*) DESC LIMIT 6`,
    )
    .all(topicId) as Array<{ id: string; label: string | null; size: number; bookCount: number }>;
}
