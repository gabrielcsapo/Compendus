/**
 * Reckoning — candidate tension-pair mining (the box-side, CPU-only step).
 *
 * Goal: cheaply surface cross-book passage PAIRS that are (a) about the same
 * subject and (b) look like they might DISAGREE, so a later LLM fleet job can
 * adjudicate them into agree / contradict / qualify / neutral. This module does
 * NO model inference, NO embeddings, and NO network I/O — pure SQLite + string
 * heuristics over the concept substrate (cs_* tables).
 *
 * Why the bounded shape matters: a naive self-join over the ~1.5M-row
 * cs_passage_concepts table is quadratic and previously wedged the box. Instead
 * we sample a few hundred claim-bearing "anchor" passages and, for each one,
 * fan out only through that anchor's handful of distinctive concepts (each
 * concept_id lookup is indexed). Anchors are processed ONE AT A TIME so peak
 * memory stays small regardless of corpus size.
 */
import { randomUUID } from "node:crypto";
import { rawDb } from "../db";

// --- tuning knobs ----------------------------------------------------------------

/** How many claim-bearing anchor passages to KEEP per run (after filtering). */
const ANCHOR_LIMIT = 500;
/**
 * Oversample factor: we pull this many × ANCHOR_LIMIT raw high-salience passages
 * because the expository/non-fiction/front-matter filters reject a large share
 * of them (most of the library is narrative fiction).
 */
const ANCHOR_OVERSAMPLE = 6;
/** Minimum prose-quality for a passage to be considered claim-bearing. */
const MIN_PROSE = 0.5;
/**
 * A passage must have at least this many words to be a candidate. Kills the
 * dominant noise source: title pages, copyright lines, and citation fragments
 * ("Reunion #21 Morgan, Melissa J. PENGUIN group (2012)") that are ~6 words and
 * produced spurious "different publication year" tensions.
 */
const MIN_WORDS = 45;
/** Most distinctive concepts to fan out from per anchor (lowest df first). */
const CONCEPTS_PER_ANCHOR = 6;
/** A neighbour must share at least this many concepts with the anchor. */
const MIN_SHARED_CONCEPTS = 2;
/** Neighbours to keep per anchor (most shared concepts first). */
const NEIGHBOURS_PER_ANCHOR = 5;
/** A concept must be at least this common to be a plausible shared subject. */
const MIN_DF = 4;
/** Upper df bound as a fraction of total passages (too-common = boilerplate).
 *  Tightened from 0.05: common concepts ("people", "change", "computer") create
 *  coincidental cross-book pairs that the judge then has to reject — better to
 *  never anchor on them. Distinctive subjects ("Charles Platt", "noun phrase")
 *  are rare and survive. */
const MAX_DF_FRACTION = 0.015;
/** Yield to the event loop every N rows so the web thread stays responsive. */
const YIELD_EVERY = 20;

/**
 * Concept labels that are document-structure / typographic noise rather than
 * real subjects. Matched case-insensitively as substrings.
 */
const BOILERPLATE_LABEL_PATTERNS = ["ldquo", "rdquo", "rsquo", "annotation", "code code", "class"];

/**
 * Generic concepts that recur across unrelated books and produce coincidental
 * "relationships" the judge wastes effort rejecting (the polysemy traps: "change"
 * as reform vs code change, "signal" as omen vs software signal). Anchoring a pair
 * on one of these is almost never a real shared subject. Matched on the whole
 * lowercased display (so "present moment" survives even though "present" is here).
 */
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
  "struct",
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
]);

/**
 * Structural front/back-matter tells: copyright pages, "look for other titles"
 * ads, scan credits, ToC, etc. A passage matching any of these is publishing
 * apparatus, not authored content, and must never become a tension candidate.
 */
const FRONTMATTER_RE =
  /\b(all rights reserved|copyright|first published|originally published in|look for other|also by|other books by|about the author|table of contents|library of congress|cataloging-in-publication|isbn[\s-]*(?:13|10)?[:\s]|printed in (?:the )?(?:united|great|u\.?s|u\.?k)|cover (?:art|design|illustration|photograph)|original scan|scanned by|edited by [a-z]+ v\d|a division of|this is a work of fiction)\b/i;

/**
 * Publisher marketing / store boilerplate (esp. Packt's identical ad blocks)
 * that is long enough to pass the word-count gate but is not authored content.
 * Matched as substrings; the bare © symbol is checked separately (not a word char).
 */
const PUBLISHER_BOILERPLATE_RE =
  /(spend less time learning|industry professionals|ebooks and videos|fully searchable|skill plans|improve your learning|packt|mapt|subscribe|on demand|sign up for|newsletter|did you know that packt|www\.|http:|https:|@packt)/i;

/**
 * Dialogue/attribution verbs. A passage with several of these is a narrative
 * scene (overwhelmingly fiction), not an expository claim worth adjudicating.
 */
const DIALOGUE_TAG_RE =
  /\b(said|asked|replied|whispered|shouted|murmured|exclaimed|cried|muttered|growled|snapped|sighed|grinned|shrugged|nodded|gasped)\b/gi;
/** Above this many dialogue tags, treat the passage as a narrative scene. */
const MAX_DIALOGUE_TAGS = 3;

// --- row types -------------------------------------------------------------------

interface ConceptRow {
  conceptId: string;
  display: string;
  df: number;
}

interface NeighbourRow {
  passageId: string;
  bookId: string;
  sharedCount: number;
}

interface CandidatePair {
  passageA: string;
  passageB: string;
  bookA: string;
  bookB: string;
  shared: string[]; // shared concept display strings
  score: number;
}

// --- public entrypoint -----------------------------------------------------------

export async function mineCandidateTensions(opts?: { limit?: number }): Promise<{
  candidates: number;
  nonfictionBooks: number;
  anchorsScanned: number;
  anchorsKept: number;
}> {
  const limit = opts?.limit ?? 200;

  const totalPassages = (rawDb.prepare("SELECT COUNT(*) AS n FROM passages").get() as { n: number })
    .n;
  const maxDf = Math.max(MIN_DF, Math.floor(totalPassages * MAX_DF_FRACTION));

  // 0. NONFICTION ALLOWLIST. The Reckoning adjudicates *claims*, and this library
  //    is ~97% fiction, so we mine ONLY books the fleet classified nonfiction
  //    (cs_book_class). If classification hasn't run, the set is empty and mining
  //    yields nothing — by design: classify first, then mine. (The per-passage
  //    expository filter below still strips front-matter within nonfiction.)
  const nonfictionBooks = loadNonfictionBooks();

  // Normalized title per book — used to drop pairs that are really two COPIES of
  // the same book (the library has duplicate files), which otherwise self-pair
  // into spurious "tensions" (e.g. The Smartest Guys in the Room ⟷ itself).
  const titleByBook = new Map<string, string>();
  for (const r of rawDb.prepare("SELECT id, title FROM books").all() as Array<{
    id: string;
    title: string | null;
  }>) {
    titleByBook.set(r.id, (r.title ?? "").toLowerCase().replace(/\s+/g, " ").trim());
  }

  // 1. Sample claim-bearing anchors. ORDER BY salience first for signal, then
  //    RANDOM() so repeated runs explore different corners of the corpus. We
  //    OVERSAMPLE and filter in JS (fiction book + expository-prose checks) down
  //    to ANCHOR_LIMIT, because most high-salience passages are narrative scenes.
  const rawAnchors = rawDb
    .prepare(
      `SELECT s.passage_id AS passageId, p.book_id AS bookId
         FROM cs_passage_salience s
         JOIN passages p ON p.id = s.passage_id
        WHERE s.prose >= ?
        ORDER BY s.salience DESC, RANDOM()
        LIMIT ?`,
    )
    .all(MIN_PROSE, ANCHOR_LIMIT * ANCHOR_OVERSAMPLE) as { passageId: string; bookId: string }[];

  // The anchor's most distinctive, non-boilerplate concepts within the df band.
  const conceptsOf = rawDb.prepare(
    `SELECT c.id AS conceptId, c.display AS display, c.df AS df
       FROM cs_passage_concepts pc
       JOIN cs_concepts c ON c.id = pc.concept_id
      WHERE pc.passage_id = ?
        AND c.df BETWEEN ? AND ?
        AND LENGTH(c.display) >= 4
      ORDER BY c.df ASC`,
  );

  // Candidate pairs keyed by canonical "a|b" so we dedup within a run.
  const pairs = new Map<string, CandidatePair>();
  // Cache passage text so we fetch each passage's body at most once.
  const textCache = new Map<string, string>();
  const textStmt = rawDb.prepare("SELECT text FROM passages WHERE id = ?");
  const getText = (id: string): string => {
    let t = textCache.get(id);
    if (t === undefined) {
      const row = textStmt.get(id) as { text: string } | undefined;
      t = row?.text ?? "";
      textCache.set(id, t);
    }
    return t;
  };

  // Keep only expository, non-fiction, substantial anchors — capped at
  // ANCHOR_LIMIT. (getText is cached, so anchors that survive cost nothing to
  // re-fetch in the loop below.)
  const anchors: { passageId: string; bookId: string }[] = [];
  let scanned = 0;
  for (const a of rawAnchors) {
    if (anchors.length >= ANCHOR_LIMIT) break;
    // Yield to the event loop periodically: better-sqlite3 is synchronous, so a
    // tight loop over thousands of passages would monopolise the single web
    // thread and the container would stop answering health checks (and get
    // marked down). A breather every BATCH rows keeps it responsive.
    if (++scanned % YIELD_EVERY === 0) await tick();
    if (!nonfictionBooks.has(a.bookId)) continue;
    if (!isExpositoryClaim(getText(a.passageId))) continue;
    anchors.push(a);
  }

  // 2 + 3. Process anchors one at a time to keep memory bounded.
  let processed = 0;
  for (const a of anchors) {
    if (++processed % YIELD_EVERY === 0) await tick();
    const anchorBook = a.bookId;

    const rawConcepts = conceptsOf.all(a.passageId, MIN_DF, maxDf) as ConceptRow[];
    const concepts = rawConcepts
      .filter((c) => !isBoilerplate(c.display) && !isGenericConcept(c.display))
      .slice(0, CONCEPTS_PER_ANCHOR);
    if (concepts.length < MIN_SHARED_CONCEPTS) continue;

    const conceptIds = concepts.map((c) => c.conceptId);
    const displayById = new Map(concepts.map((c) => [c.conceptId, c.display]));

    // Cross-book neighbours sharing >= MIN_SHARED_CONCEPTS of the anchor's
    // concepts. Bounded: IN-list is tiny (<= CONCEPTS_PER_ANCHOR) and each
    // concept_id is indexed in cs_passage_concepts.
    const placeholders = conceptIds.map(() => "?").join(",");
    const neighbours = rawDb
      .prepare(
        `SELECT pc.passage_id AS passageId,
                p.book_id     AS bookId,
                COUNT(*)      AS sharedCount
           FROM cs_passage_concepts pc
           JOIN passages p ON p.id = pc.passage_id
           JOIN cs_passage_salience s ON s.passage_id = pc.passage_id
          WHERE pc.concept_id IN (${placeholders})
            AND pc.passage_id != ?
            AND p.book_id != ?
            AND s.prose >= ?
          GROUP BY pc.passage_id
         HAVING sharedCount >= ?
          ORDER BY sharedCount DESC
          LIMIT ?`,
      )
      .all(
        ...conceptIds,
        a.passageId,
        anchorBook,
        MIN_PROSE,
        MIN_SHARED_CONCEPTS,
        NEIGHBOURS_PER_ANCHOR,
      ) as NeighbourRow[];

    if (neighbours.length === 0) continue;

    const anchorText = getText(a.passageId);

    for (const n of neighbours) {
      // Which concepts are actually shared with this neighbour (for the label).
      const sharedDisplays = sharedConceptDisplays(n.passageId, conceptIds, displayById);
      if (sharedDisplays.length < MIN_SHARED_CONCEPTS) continue;

      // Same nonfiction/expository discipline for the other side of the pair.
      if (!nonfictionBooks.has(n.bookId)) continue;
      // Drop duplicate-copy self-pairs (same book, different file id).
      const ta = titleByBook.get(anchorBook);
      const tb = titleByBook.get(n.bookId);
      if (ta && tb && ta === tb) continue;
      const neighbourText = getText(n.passageId);
      if (!isExpositoryClaim(neighbourText)) continue;

      // 4. Cheap, model-free tension-likelihood score over the two texts.
      const score = tensionScore(anchorText, neighbourText, sharedDisplays);

      // 5. Canonical order so (a,b) and (b,a) collapse to one pair.
      const [pa, pb, ba, bb] =
        a.passageId < n.passageId
          ? [a.passageId, n.passageId, anchorBook, n.bookId]
          : [n.passageId, a.passageId, n.bookId, anchorBook];

      const key = `${pa}|${pb}`;
      const existing = pairs.get(key);
      if (!existing || score > existing.score) {
        pairs.set(key, {
          passageA: pa,
          passageB: pb,
          bookA: ba,
          bookB: bb,
          shared: sharedDisplays,
          score,
        });
      }
    }
  }

  const stats = {
    nonfictionBooks: nonfictionBooks.size,
    anchorsScanned: rawAnchors.length,
    anchorsKept: anchors.length,
  };

  if (pairs.size === 0) return { candidates: 0, ...stats };

  // Drop pairs already present in cs_tension_candidates (canonical order matches
  // the unique index on (passage_a, passage_b)).
  const existsStmt = rawDb.prepare(
    "SELECT 1 FROM cs_tension_candidates WHERE passage_a = ? AND passage_b = ? LIMIT 1",
  );
  const fresh = [...pairs.values()].filter((p) => !existsStmt.get(p.passageA, p.passageB));

  // Take the strongest `limit` candidates.
  fresh.sort((x, y) => y.score - x.score);
  const toInsert = fresh.slice(0, limit);
  if (toInsert.length === 0) return { candidates: 0, ...stats };

  const now = Math.floor(Date.now() / 1000);
  const insertStmt = rawDb.prepare(
    `INSERT OR IGNORE INTO cs_tension_candidates
       (id, passage_a, passage_b, book_a, book_b, shared, heuristic_score, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'candidate', ?)`,
  );

  const insertAll = rawDb.transaction((rows: CandidatePair[]) => {
    let inserted = 0;
    for (const r of rows) {
      const res = insertStmt.run(
        randomUUID(),
        r.passageA,
        r.passageB,
        r.bookA,
        r.bookB,
        JSON.stringify(r.shared),
        r.score,
        now,
      );
      inserted += res.changes;
    }
    return inserted;
  });

  const inserted = insertAll(toInsert);
  return { candidates: inserted, ...stats };
}

// --- helpers ---------------------------------------------------------------------

/** Hand control back to the event loop so queued I/O (health checks) can run. */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Set of book ids the fleet classified as nonfiction (cs_book_class). This is
 * the mining allowlist. Robust to a missing table (returns an empty set, so
 * mining yields nothing until classification has run — classify first, mine
 * second).
 */
function loadNonfictionBooks(): Set<string> {
  const out = new Set<string>();
  try {
    const rows = rawDb
      .prepare("SELECT book_id AS id FROM cs_book_class WHERE category = 'nonfiction'")
      .all() as { id: string }[];
    for (const r of rows) out.add(r.id);
  } catch {
    // cs_book_class absent — classification hasn't run yet; mine yields nothing.
  }
  return out;
}

/**
 * Gate a passage to claim-bearing EXPOSITORY prose: substantial, not publishing
 * apparatus (copyright/ToC/ads), and not a narrative dialogue scene. This is the
 * primary defence against the noise that dominated the first run — short
 * metadata fragments, front-matter, and fiction passages.
 */
function isExpositoryClaim(text: string): boolean {
  if (!text) return false;
  if (wordCount(text) < MIN_WORDS) return false;
  if (text.includes("©")) return false; // copyright page (bare symbol)
  if (FRONTMATTER_RE.test(text)) return false;
  if (PUBLISHER_BOILERPLATE_RE.test(text)) return false; // store/marketing ads
  const dialogueTags = (text.match(DIALOGUE_TAG_RE) || []).length;
  if (dialogueTags > MAX_DIALOGUE_TAGS) return false;
  return true;
}

/** Whitespace-delimited word count. */
function wordCount(text: string): number {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}

/** True if a concept display label is typographic/structural noise. */
function isBoilerplate(display: string): boolean {
  const lower = display.toLowerCase();
  return BOILERPLATE_LABEL_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Publisher / citation metadata that recurs across bibliographies and copyright
 * pages — books sharing a publisher city or press are not sharing a SUBJECT.
 */
const CITATION_CONCEPT_RE =
  /\b(press|university|penguin|random house|harper|norton|new york|york|london|bibliography|references|journal|oxford|cambridge|publishing|publisher|copyright|isbn|vol|reprint)\b/i;

/** True if a concept is too generic or is publisher/citation metadata. */
function isGenericConcept(display: string): boolean {
  const lower = display.toLowerCase().trim();
  return GENERIC_CONCEPTS.has(lower) || CITATION_CONCEPT_RE.test(lower);
}

/**
 * Of the anchor's concept set, which display labels does this neighbour passage
 * actually share? One indexed lookup over the neighbour's concept rows.
 */
function sharedConceptDisplays(
  neighbourId: string,
  anchorConceptIds: string[],
  displayById: Map<string, string>,
): string[] {
  const placeholders = anchorConceptIds.map(() => "?").join(",");
  const rows = rawDb
    .prepare(
      `SELECT concept_id AS conceptId FROM cs_passage_concepts WHERE passage_id = ? AND concept_id IN (${placeholders})`,
    )
    .all(neighbourId, ...anchorConceptIds) as { conceptId: string }[];
  const out: string[] = [];
  for (const r of rows) {
    const d = displayById.get(r.conceptId);
    if (d) out.push(d);
  }
  return out;
}

// Regexes are cheap to reuse; defined once at module load.
const NUMBER_RE = /\b\d[\d.,]*\b/g; // quantities, percentages, magnitudes (incl. years)
const NEGATION_RE =
  /\b(no|not|never|cannot|can't|didn't|doesn't|don't|isn't|wasn't|none|neither)\b/i;
const CONTRAST_RE =
  /\b(but|however|contrary|contradict|disputed|myth|actually|whereas|although|though|in fact|rather)\b/i;

/**
 * Cheap, model-free estimate of how likely two passages about the same subject
 * are to genuinely DISAGREE. No semantics — just surface signals of factual
 * conflict. Higher = more promising for the LLM judge to adjudicate.
 */
function tensionScore(textA: string, textB: string, shared: string[]): number {
  let score = 0;

  // Base reward for subject overlap — more shared concepts = more grounded a
  // potential disagreement is (small, so it never dominates the conflict cues).
  score += Math.min(shared.length, 4) * 0.25;

  // Conflicting QUANTITIES: the two passages cite different numbers (years are a
  // subset — NUMBER_RE matches "1939" etc.). The same claim with different
  // magnitudes is a classic factual disagreement. We no longer score years
  // separately: that double-counted publication dates and, together with the
  // metadata passages it fired on, produced the spurious "(2010) vs (2012)"
  // tensions. Front-matter is now filtered upstream, so in-prose numbers stand
  // on their own.
  const numsA = extractSet(textA, NUMBER_RE);
  const numsB = extractSet(textB, NUMBER_RE);
  if (numsA.size > 0 && numsB.size > 0 && hasDistinct(numsA, numsB)) {
    score += 1.5;
  }

  // NEGATION near a shared subject: one passage affirms, the other denies. We
  // look for a negation cue in the window around any shared concept mention.
  if (negationNearConcept(textA, shared) !== negationNearConcept(textB, shared)) {
    // One side negates the subject and the other doesn't — asymmetry is the tell.
    score += 1.0;
  }

  // Explicit CONTRAST cues ("but", "however", "myth", "actually", "disputed").
  if (CONTRAST_RE.test(textA)) score += 0.5;
  if (CONTRAST_RE.test(textB)) score += 0.5;

  return score;
}

/** Collect the distinct tokens a regex matches in a text. */
function extractSet(text: string, re: RegExp): Set<string> {
  const out = new Set<string>();
  const matches = text.match(re);
  if (matches) for (const m of matches) out.add(m);
  return out;
}

/** True if either set contains a value the other lacks (i.e. they differ). */
function hasDistinct(a: Set<string>, b: Set<string>): boolean {
  for (const v of a) if (!b.has(v)) return true;
  for (const v of b) if (!a.has(v)) return true;
  return false;
}

/**
 * True if a negation cue appears within a small character window of any shared
 * concept mention in the text — i.e. the passage seems to deny something about
 * the shared subject.
 */
function negationNearConcept(text: string, shared: string[]): boolean {
  const lower = text.toLowerCase();
  const WINDOW = 60; // chars on either side of the concept mention
  for (const concept of shared) {
    const c = concept.toLowerCase();
    let from = 0;
    let idx = lower.indexOf(c, from);
    while (idx !== -1) {
      const start = Math.max(0, idx - WINDOW);
      const end = Math.min(lower.length, idx + c.length + WINDOW);
      if (NEGATION_RE.test(lower.slice(start, end))) return true;
      from = idx + c.length;
      idx = lower.indexOf(c, from);
    }
  }
  return false;
}
