/**
 * lg extract-passage — the core learning-graph ingestion step.
 *
 * For each nonfiction prose passage in a theme, the local LLM names 1-4
 * concepts the passage substantially teaches, each with a kind, a pedagogical
 * role, a grounded one-line claim, and 0-3 prerequisite concept labels — or
 * excludes the passage as non-teachable (index/citations/promo/code). Results
 * land in lg_concepts (+MiniLM label embedding) and lg_passage_concepts; the
 * (passage_id, model_id) ledger makes re-runs free.
 *
 * Vocabulary discipline: each prompt carries the theme's highest-df canonical
 * labels so far ("reuse these labels EXACTLY when they fit") — a rolling seed
 * that shrinks the reconcile pass's workload as the run proceeds.
 */
import { rawDb } from "../db";
import { ensureJourneyColumns } from "../concept/wander";
import { ensureBookClassTable } from "../reckoning/classify";
import { embedBatch, vectorToBuffer } from "../knowledge/embeddings";
import { ollamaChatJson, parseModelJson, OLLAMA_MODEL } from "../llm/ollama";
import { tick, type PassStatus } from "../llm/lane";
import {
  ensureLgTables,
  slugifyLabel,
  resolveConceptId,
  recomputeDf,
  refreshThemeConcepts,
  LG_ROLES,
  LG_KINDS,
  type LgRole,
  type LgKind,
} from "./schema";

const MIN_WORDS = 30;
const MAX_PROMPT_CHARS = 2200;
const MAX_CONCEPTS = 4;
const KNOWN_LABELS_IN_PROMPT = 30;

export interface ThemePassage {
  passageId: string;
  text: string;
  bookId: string;
  bookTitle: string;
  authors: string | null;
  chapterTitle: string | null;
}

export interface ExtractedConcept {
  label: string;
  kind: LgKind;
  role: LgRole;
  claim: string;
  prerequisites: string[];
}

export type ExtractionOutcome =
  | { status: "ok"; concepts: ExtractedConcept[] }
  | { status: "excluded"; reason: string };

/**
 * Gather a theme's candidate passages. scope "topic" (default, doc-faithful)
 * = passages the label-prop clustering put in the topic; scope "books" = ALL
 * passages of the topic's member nonfiction books — for when topic membership
 * is too thin (label-prop fuzz is the very thing being replaced).
 */
export function gatherThemePassages(topicId: string, scope: "topic" | "books"): ThemePassage[] {
  ensureBookClassTable(); // runtime-DDL table — the joins below assume it exists
  const topicSql = `
    SELECT pt.passage_id AS passageId, p.text, p.book_id AS bookId,
           b.title AS bookTitle, b.authors AS authors, p.chapter_title AS chapterTitle
      FROM cs_passage_topics pt
      JOIN passages p ON p.id = pt.passage_id
      JOIN books b ON b.id = p.book_id
      JOIN cs_book_class cc ON cc.book_id = p.book_id AND cc.category = 'nonfiction'
      JOIN cs_passage_salience s ON s.passage_id = pt.passage_id
     WHERE pt.topic_id = ? AND s.prose >= 0.5
     ORDER BY p.book_id, p.ordinal`;
  // Books join the widened scope only with a REAL footprint in the topic —
  // label-prop fuzz puts 1-2 stray passages of unrelated books into most
  // topics, and without the floor each stray drags its ENTIRE book in
  // (observed: a botany book adding 12k passages to Founding Fathers).
  const BOOKS_SCOPE_MIN_TOPIC_PASSAGES = 3;
  const booksSql = `
    SELECT p.id AS passageId, p.text, p.book_id AS bookId,
           b.title AS bookTitle, b.authors AS authors, p.chapter_title AS chapterTitle
      FROM passages p
      JOIN books b ON b.id = p.book_id
      JOIN cs_book_class cc ON cc.book_id = p.book_id AND cc.category = 'nonfiction'
      JOIN cs_passage_salience s ON s.passage_id = p.id
     WHERE p.book_id IN (
             SELECT p2.book_id FROM cs_passage_topics pt2
               JOIN passages p2 ON p2.id = pt2.passage_id
              WHERE pt2.topic_id = ?
              GROUP BY p2.book_id
              HAVING COUNT(*) >= ${BOOKS_SCOPE_MIN_TOPIC_PASSAGES}
           )
       AND s.prose >= 0.5
     ORDER BY p.book_id, p.ordinal`;
  const rows = rawDb
    .prepare(scope === "books" ? booksSql : topicSql)
    .all(topicId) as ThemePassage[];
  return rows.filter((r) => r.text.trim().split(/\s+/).length >= MIN_WORDS);
}

/** Truncate at a sentence boundary near the prompt budget. */
function clipForPrompt(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= MAX_PROMPT_CHARS) return t;
  const head = t.slice(0, MAX_PROMPT_CHARS);
  const lastStop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  return lastStop > MAX_PROMPT_CHARS / 2 ? head.slice(0, lastStop + 1) : head;
}

const EXTRACT_SYSTEM = [
  "You are an indexer building a learning graph from passages of the owner's books.",
  "You label what a passage teaches. You never invent content — only name what is",
  "actually present in the passage text.",
  "",
  "Respond with ONLY a JSON object, no prose, matching:",
  '{"exclude": false, "concepts": [{"label": "...", "kind": "...", "role": "...", "claim": "...", "prerequisites": ["..."]}]}',
  "or, for non-teachable passages:",
  '{"exclude": true, "reason": "..."}',
  "",
  "Rules:",
  "- exclude=true for anything that is not teachable prose: index pages, tables of",
  "  contents, bibliographies, footnote/citation lists, copyright and publisher",
  "  pages, advertisements, code listings, answer keys, figure-caption fragments,",
  "  and narrative filler that teaches nothing. When in doubt about back-matter, exclude.",
  "- Otherwise give 1 to 4 concepts — only ones this passage substantially teaches",
  "  or evidences, not every term it mentions.",
  "- label: canonical textbook vocabulary — the phrase an index would use.",
  "  Lowercase except proper nouns. Singular. 1-4 words.",
  '  Good: "compound interest", "checks and balances", "George Washington".',
  '  Bad: "the magic of compounding", "Washington\'s genius", "chapter 3 ideas".',
  "  If a provided known-concept label fits, reuse it EXACTLY.",
  "- kind: idea (claim/principle) | method (technique/procedure) | person | event | term (vocabulary being defined).",
  "- role — what THIS passage does for the concept:",
  "  definition (introduces/defines) | example (concrete instance) |",
  "  derivation (builds it from prior ideas) | application (uses it on a problem) |",
  "  caveat (limits, exceptions) | anecdote (story illustrating it) |",
  "  exercise (practice for the reader) | summary (recap).",
  "- claim: one sentence, at most 25 words, stating what this passage says about",
  "  the concept. Ground it in the passage; no outside knowledge.",
  "- prerequisites: 0-3 labels (same vocabulary discipline) a reader must already",
  "  understand for this passage to make sense. Real conceptual dependencies only;",
  '  never generic skills like "reading" or "arithmetic".',
].join("\n");

export type ExtractContext = { kind: "theme"; label: string } | { kind: "book" };

function buildExtractUser(p: ThemePassage, ctx: ExtractContext, knownLabels: string[]): string {
  const lines = [
    `Book: ${p.bookTitle}${firstAuthor(p.authors) ? ` — ${firstAuthor(p.authors)}` : ""}`,
    `Chapter: ${p.chapterTitle ?? "(unknown)"}`,
  ];
  if (ctx.kind === "theme") {
    lines.push(
      `Theme: "${ctx.label}"`,
      "Known concepts in this theme (reuse these labels when they fit):",
    );
  } else {
    // Library-wide/book mode: no theme framing — vocabulary coherence is
    // per-book here; cross-book unification is the reconcile pass's job.
    lines.push("Known concepts in this book (reuse these labels EXACTLY when they fit):");
  }
  lines.push(
    knownLabels.length ? knownLabels.join(", ") : "(none yet)",
    "",
    "Passage:",
    '"""',
    clipForPrompt(p.text),
    '"""',
  );
  return lines.join("\n");
}

function firstAuthor(authorsJson: string | null): string {
  if (!authorsJson) return "";
  try {
    const v = JSON.parse(authorsJson);
    if (Array.isArray(v) && v.length > 0) return String(v[0]);
    if (typeof v === "string") return v;
  } catch {
    return authorsJson;
  }
  return "";
}

/** Shape-check + clamp the model's output; throws on unusable shape. */
function validateExtraction(raw: unknown): ExtractionOutcome {
  const o = raw as {
    exclude?: unknown;
    reason?: unknown;
    concepts?: unknown;
  };
  if (o?.exclude === true) {
    return { status: "excluded", reason: String(o.reason ?? "").slice(0, 300) };
  }
  if (!Array.isArray(o?.concepts) || o.concepts.length === 0) {
    throw new Error("concepts must be a non-empty array (or exclude=true)");
  }
  const concepts: ExtractedConcept[] = [];
  for (const c of o.concepts.slice(0, MAX_CONCEPTS)) {
    const cc = c as Record<string, unknown>;
    const label = String(cc.label ?? "").trim();
    if (label.length < 2 || label.length > 60 || label.split(/\s+/).length > 5) continue;
    const kind = String(cc.kind ?? "").toLowerCase() as LgKind;
    const role = String(cc.role ?? "").toLowerCase() as LgRole;
    if (!LG_KINDS.includes(kind) || !LG_ROLES.includes(role)) continue;
    const claim = String(cc.claim ?? "").slice(0, 300);
    const prerequisites = (Array.isArray(cc.prerequisites) ? cc.prerequisites : [])
      .map((x) => String(x).trim())
      .filter((x) => x.length >= 2 && x.length <= 60)
      .slice(0, 3);
    concepts.push({ label, kind, role, claim, prerequisites });
  }
  if (concepts.length === 0) throw new Error("no concept passed shape validation");
  return { status: "ok", concepts };
}

/** One passage through the model, with one retry on parse/shape failure. */
export async function extractOne(
  p: ThemePassage,
  ctx: ExtractContext,
  knownLabels: string[],
  model?: string,
): Promise<{
  outcome: ExtractionOutcome;
  modelId: string;
  evalCount?: number;
  evalDurationNs?: number;
}> {
  const user = buildExtractUser(p, ctx, knownLabels);
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const system =
      attempt === 0
        ? EXTRACT_SYSTEM
        : `${EXTRACT_SYSTEM}\n\nYour previous reply was invalid (${lastError}). Follow the JSON shape exactly.`;
    const res = await ollamaChatJson(system, user, { model });
    try {
      const outcome = validateExtraction(parseModelJson(res.content));
      return {
        outcome,
        modelId: res.modelId,
        evalCount: res.evalCount,
        evalDurationNs: res.evalDurationNs,
      };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(lastError || "extraction failed");
}

export interface ExtractThemeResult {
  themeId: string;
  gathered: number;
  processed: number;
  cached: number;
  extracted: number;
  excluded: number;
  errors: number;
  concepts: number;
}

/**
 * Run extract-passage over a theme (a cs_topics topic id). Resumable: ledger
 * hits skip. Serial Ollama calls — the awaits are the yields, plus an explicit
 * tick per passage so the web thread stays responsive.
 */
export async function extractTheme(
  topicId: string,
  opts: { scope?: "topic" | "books"; limit?: number; model?: string },
  status?: PassStatus,
): Promise<ExtractThemeResult> {
  ensureLgTables();
  ensureJourneyColumns(); // fleet_label/display_label are runtime-added columns
  const scope = opts.scope ?? "topic";
  const model = opts.model || OLLAMA_MODEL;
  const themeId = `lgt_${topicId}`;

  // Theme row seeded from the cs_topics journey read-model.
  const topic = rawDb
    .prepare(
      "SELECT COALESCE(fleet_label, display_label, label) AS label, nonfiction_books AS nf FROM cs_topics WHERE id = ?",
    )
    .get(topicId) as { label: string | null; nf: number | null } | undefined;
  if (!topic) throw new Error(`cs_topics ${topicId} not found`);
  const themeLabel = topic.label ?? "this theme";
  rawDb
    .prepare(
      `INSERT INTO lg_themes (id, label, nonfiction_books, source_topic_id, model_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET label=excluded.label,
         nonfiction_books=excluded.nonfiction_books, model_id=excluded.model_id`,
    )
    .run(themeId, themeLabel, topic.nf ?? 0, topicId, model);

  let passages = gatherThemePassages(topicId, scope);
  if (opts.limit && opts.limit > 0) passages = passages.slice(0, opts.limit);
  const addMember = rawDb.prepare(
    "INSERT OR IGNORE INTO lg_theme_passages (theme_id, passage_id) VALUES (?, ?)",
  );
  for (const p of passages) addMember.run(themeId, p.passageId);

  // ok/excluded are cached forever; 'error' rows RETRY — most extraction
  // errors are transient infrastructure (Ollama down/restarting), and a
  // permanent skip would silently hollow out the theme.
  const ledgerHit = rawDb.prepare(
    "SELECT 1 FROM lg_passage_extractions WHERE passage_id = ? AND model_id = ? AND status IN ('ok','excluded')",
  );
  const insertLedger = rawDb.prepare(
    `INSERT OR REPLACE INTO lg_passage_extractions (passage_id, model_id, status, reason, extracted_at)
     VALUES (?, ?, ?, ?, unixepoch())`,
  );
  const insertConcept = rawDb.prepare(
    "INSERT OR IGNORE INTO lg_concepts (id, label, kind, df, model_id) VALUES (?, ?, ?, 0, ?)",
  );
  const insertPc = rawDb.prepare(
    `INSERT OR REPLACE INTO lg_passage_concepts (passage_id, concept_id, role, claim, confidence, model_id)
     VALUES (?, ?, ?, ?, NULL, ?)`,
  );
  const insertPrereq = rawDb.prepare(
    "INSERT OR IGNORE INTO lg_prereq_mentions (passage_id, concept_id, prereq_label, model_id) VALUES (?, ?, ?, ?)",
  );
  const knownStmt = rawDb.prepare(
    `SELECT c.label AS label FROM lg_theme_passages tp
       JOIN lg_passage_concepts pc ON pc.passage_id = tp.passage_id
       JOIN lg_concepts c ON c.id = pc.concept_id
      WHERE tp.theme_id = ? AND c.merged_into IS NULL
      GROUP BY c.id ORDER BY COUNT(*) DESC LIMIT ?`,
  );

  const result: ExtractThemeResult = {
    themeId,
    gathered: passages.length,
    processed: 0,
    cached: 0,
    extracted: 0,
    excluded: 0,
    errors: 0,
    concepts: 0,
  };
  if (status) status.total = passages.length;

  // Embed new concept labels in batched windows (MiniLM forward passes are
  // cheap but per-label calls add up).
  let pendingEmbeds: string[] = [];
  const flushEmbeds = async () => {
    if (pendingEmbeds.length === 0) return;
    const batch = pendingEmbeds;
    pendingEmbeds = [];
    const vecs = await embedBatch(batch.map((id) => labelOf(id)));
    const upd = rawDb.prepare("UPDATE lg_concepts SET embedding = ? WHERE id = ?");
    for (let i = 0; i < batch.length; i++) upd.run(vectorToBuffer(vecs[i]), batch[i]);
  };
  const labelOf = (id: string): string =>
    (rawDb.prepare("SELECT label FROM lg_concepts WHERE id = ?").get(id) as { label: string })
      .label;

  const applyOne = rawDb.transaction((p: ThemePassage, concepts: ExtractedConcept[]) => {
    const newIds: string[] = [];
    for (const c of concepts) {
      const id = resolveConceptId(slugifyLabel(c.label));
      if (!id) continue;
      const existed = rawDb.prepare("SELECT 1 FROM lg_concepts WHERE id = ?").get(id);
      if (!existed) {
        insertConcept.run(id, c.label, c.kind, model);
        newIds.push(id);
      }
      insertPc.run(p.passageId, id, c.role, c.claim, model);
      for (const pre of c.prerequisites) insertPrereq.run(p.passageId, id, pre, model);
    }
    insertLedger.run(p.passageId, model, "ok", null);
    return newIds;
  });

  for (const p of passages) {
    result.processed++;
    if (status) {
      status.processed++;
      status.note = `${p.bookTitle.slice(0, 40)} · ${result.concepts} concepts`;
    }
    if (ledgerHit.get(p.passageId, model)) {
      result.cached++;
      continue;
    }
    const known = (knownStmt.all(themeId, KNOWN_LABELS_IN_PROMPT) as { label: string }[]).map(
      (r) => r.label,
    );
    try {
      const { outcome } = await extractOne(p, { kind: "theme", label: themeLabel }, known, model);
      if (outcome.status === "excluded") {
        insertLedger.run(p.passageId, model, "excluded", outcome.reason);
        result.excluded++;
      } else {
        const newIds = applyOne(p, outcome.concepts);
        pendingEmbeds.push(...newIds);
        if (pendingEmbeds.length >= 32) await flushEmbeds();
        result.extracted++;
      }
    } catch (e) {
      insertLedger.run(
        p.passageId,
        model,
        "error",
        (e instanceof Error ? e.message : String(e)).slice(0, 300),
      );
      result.errors++;
    }
    await tick();
  }
  await flushEmbeds();

  recomputeDf();
  result.concepts = refreshThemeConcepts(themeId).length;
  return result;
}

// ---------------------------------------------------------------------------
// Library-wide extraction (Phase 2) — every nonfiction prose passage, grouped
// by book. Themes come later from form-themes; this pass writes NO theme rows.
// ---------------------------------------------------------------------------

/** Nonfiction books in stable id order (resume order across re-POSTs). */
export function listNonfictionBooks(): Array<{ id: string; title: string }> {
  ensureBookClassTable();
  return rawDb
    .prepare(
      `SELECT b.id, b.title FROM books b
        JOIN cs_book_class cc ON cc.book_id = b.id AND cc.category = 'nonfiction'
       ORDER BY b.id`,
    )
    .all() as Array<{ id: string; title: string }>;
}

/** One book's prose passages in reading order. */
export function gatherBookPassages(bookId: string): ThemePassage[] {
  const rows = rawDb
    .prepare(
      `SELECT p.id AS passageId, p.text, p.book_id AS bookId,
              b.title AS bookTitle, b.authors AS authors, p.chapter_title AS chapterTitle
         FROM passages p
         JOIN books b ON b.id = p.book_id
         JOIN cs_passage_salience s ON s.passage_id = p.id
        WHERE p.book_id = ? AND s.prose >= 0.5
        ORDER BY p.ordinal`,
    )
    .all(bookId) as ThemePassage[];
  return rows.filter((r) => r.text.trim().split(/\s+/).length >= MIN_WORDS);
}

export interface ExtractLibraryResult {
  books: number;
  gathered: number;
  processed: number;
  cached: number;
  extracted: number;
  excluded: number;
  errors: number;
  concepts: number;
  passagesPerHour: number | null;
}

/** Consecutive-failure circuit breaker: an Ollama outage aborts cleanly
 *  instead of burning through the queue writing error rows. */
const CIRCUIT_BREAKER_ERRORS = 25;

/**
 * Extract the whole nonfiction library, book by book. Multi-day, fully
 * resumable: ok/excluded ledger rows skip in milliseconds, error rows retry,
 * and a restart just needs a re-POST. Vocabulary coherence is per-book (the
 * rolling known-labels seed); cross-book unification is reconcile's job.
 */
export async function extractLibrary(
  opts: { model?: string; limitBooks?: number },
  status?: PassStatus,
): Promise<ExtractLibraryResult> {
  ensureLgTables();
  const model = opts.model || OLLAMA_MODEL;

  let books = listNonfictionBooks();
  if (opts.limitBooks && opts.limitBooks > 0) books = books.slice(0, opts.limitBooks);

  const ledgerHit = rawDb.prepare(
    "SELECT 1 FROM lg_passage_extractions WHERE passage_id = ? AND model_id = ? AND status IN ('ok','excluded')",
  );
  const insertLedger = rawDb.prepare(
    `INSERT OR REPLACE INTO lg_passage_extractions (passage_id, model_id, status, reason, extracted_at)
     VALUES (?, ?, ?, ?, unixepoch())`,
  );
  const insertConcept = rawDb.prepare(
    "INSERT OR IGNORE INTO lg_concepts (id, label, kind, df, model_id) VALUES (?, ?, ?, 0, ?)",
  );
  const insertPc = rawDb.prepare(
    `INSERT OR REPLACE INTO lg_passage_concepts (passage_id, concept_id, role, claim, confidence, model_id)
     VALUES (?, ?, ?, ?, NULL, ?)`,
  );
  const insertPrereq = rawDb.prepare(
    "INSERT OR IGNORE INTO lg_prereq_mentions (passage_id, concept_id, prereq_label, model_id) VALUES (?, ?, ?, ?)",
  );
  // Seed a book's known-labels map from what's already extracted (mid-book
  // resume); incremented in memory afterwards — no per-passage SQL.
  const bookConceptsStmt = rawDb.prepare(
    `SELECT c.id AS id, c.label AS label, COUNT(*) AS n
       FROM lg_passage_concepts pc
       JOIN passages p ON p.id = pc.passage_id
       JOIN lg_concepts c ON c.id = pc.concept_id
      WHERE p.book_id = ? AND c.merged_into IS NULL
      GROUP BY c.id`,
  );
  const labelOf = (id: string): string =>
    (rawDb.prepare("SELECT label FROM lg_concepts WHERE id = ?").get(id) as { label: string })
      .label;

  const result: ExtractLibraryResult = {
    books: books.length,
    gathered: 0,
    processed: 0,
    cached: 0,
    extracted: 0,
    excluded: 0,
    errors: 0,
    concepts: 0,
    passagesPerHour: null,
  };

  let pendingEmbeds: string[] = [];
  const flushEmbeds = async () => {
    if (pendingEmbeds.length === 0) return;
    const batch = pendingEmbeds;
    pendingEmbeds = [];
    const vecs = await embedBatch(batch.map((id) => labelOf(id)));
    const upd = rawDb.prepare("UPDATE lg_concepts SET embedding = ? WHERE id = ?");
    for (let i = 0; i < batch.length; i++) upd.run(vectorToBuffer(vecs[i]), batch[i]);
  };

  const applyOne = rawDb.transaction((p: ThemePassage, concepts: ExtractedConcept[]) => {
    const newIds: string[] = [];
    for (const c of concepts) {
      const id = resolveConceptId(slugifyLabel(c.label));
      if (!id) continue;
      const existed = rawDb.prepare("SELECT 1 FROM lg_concepts WHERE id = ?").get(id);
      if (!existed) {
        insertConcept.run(id, c.label, c.kind, model);
        newIds.push(id);
      }
      insertPc.run(p.passageId, id, c.role, c.claim, model);
      for (const pre of c.prerequisites) insertPrereq.run(p.passageId, id, pre, model);
    }
    insertLedger.run(p.passageId, model, "ok", null);
    return newIds;
  });

  const t0 = Date.now();
  let llmProcessed = 0;
  let consecutiveErrors = 0;
  let conceptTotal = (
    rawDb.prepare("SELECT COUNT(*) AS n FROM lg_concepts WHERE merged_into IS NULL").get() as {
      n: number;
    }
  ).n;

  for (let bi = 0; bi < books.length; bi++) {
    const book = books[bi];
    const passages = gatherBookPassages(book.id);
    result.gathered += passages.length;
    if (status) status.total = result.gathered; // grows as books are gathered

    // Rolling per-book vocabulary: id → {label, count}, seeded once.
    const bookConcepts = new Map<string, { label: string; count: number }>();
    for (const r of bookConceptsStmt.all(book.id) as Array<{
      id: string;
      label: string;
      n: number;
    }>) {
      bookConcepts.set(r.id, { label: r.label, count: r.n });
    }
    const topKnown = (): string[] =>
      [...bookConcepts.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, KNOWN_LABELS_IN_PROMPT)
        .map((c) => c.label);

    for (const p of passages) {
      result.processed++;
      if (status) status.processed++;
      if (ledgerHit.get(p.passageId, model)) {
        result.cached++;
        continue;
      }
      try {
        const { outcome } = await extractOne(p, { kind: "book" }, topKnown(), model);
        consecutiveErrors = 0;
        if (outcome.status === "excluded") {
          insertLedger.run(p.passageId, model, "excluded", outcome.reason);
          result.excluded++;
        } else {
          const newIds = applyOne(p, outcome.concepts);
          conceptTotal += newIds.length;
          for (const c of outcome.concepts) {
            const id = resolveConceptId(slugifyLabel(c.label));
            const entry = bookConcepts.get(id);
            if (entry) entry.count++;
            else bookConcepts.set(id, { label: c.label, count: 1 });
          }
          pendingEmbeds.push(...newIds);
          if (pendingEmbeds.length >= 32) await flushEmbeds();
          result.extracted++;
        }
      } catch (e) {
        insertLedger.run(
          p.passageId,
          model,
          "error",
          (e instanceof Error ? e.message : String(e)).slice(0, 300),
        );
        result.errors++;
        if (++consecutiveErrors >= CIRCUIT_BREAKER_ERRORS) {
          await flushEmbeds();
          throw new Error(
            `aborting after ${consecutiveErrors} consecutive extraction errors (LLM backend down?) — error rows retry on the next POST`,
          );
        }
      }
      llmProcessed++;
      if (status) {
        const hours = (Date.now() - t0) / 3_600_000;
        const rate = hours > 0.01 ? Math.round(llmProcessed / hours) : 0;
        const remaining = result.gathered - result.processed;
        const eta = rate > 0 ? (remaining / rate).toFixed(1) : "?";
        status.note = `book ${bi + 1}/${books.length} · ${book.title.slice(0, 30)} · ${conceptTotal.toLocaleString()} concepts · ${rate}/h · ETA ${eta}h`;
      }
      await tick();
    }

    // Periodic df refresh for admin visibility during the multi-day grind.
    if (bi > 0 && bi % 25 === 0) recomputeDf();
  }
  await flushEmbeds();
  recomputeDf();

  result.concepts = conceptTotal;
  const hours = (Date.now() - t0) / 3_600_000;
  result.passagesPerHour = hours > 0.01 ? Math.round(llmProcessed / hours) : null;
  return result;
}

export interface SampleResult {
  model: string;
  requested: number;
  processed: number;
  excluded: number;
  parseFailures: number;
  tokensPerSec: number | null;
  avgSecondsPerPassage: number | null;
  items: Array<{
    passageId: string;
    bookTitle: string;
    snippet: string;
    outcome: ExtractionOutcome | { status: "error"; reason: string };
  }>;
}

/**
 * Dry-run extraction over random nonfiction prose (library-wide, or a topic's
 * passages when topicId is given). Writes NOTHING — this is the 7B-vs-14B
 * quality/latency benchmark, and the Phase-2 feasibility number: with no fleet
 * left, server throughput is the whole ingest budget.
 */
export async function sampleExtraction(
  opts: { limit?: number; topicId?: string; model?: string },
  status?: PassStatus,
): Promise<SampleResult> {
  ensureLgTables();
  ensureBookClassTable(); // the nonfiction gate below joins this runtime-DDL table
  const limit = opts.limit ?? 50;
  const model = opts.model || OLLAMA_MODEL;

  let passages: ThemePassage[];
  if (opts.topicId) {
    passages = gatherThemePassages(opts.topicId, "topic");
    // Deterministic spread over the theme instead of the head of one book.
    const step = Math.max(1, Math.floor(passages.length / limit));
    passages = passages.filter((_p, i) => i % step === 0).slice(0, limit);
  } else {
    passages = (
      rawDb
        .prepare(
          `SELECT p.id AS passageId, p.text, p.book_id AS bookId, b.title AS bookTitle,
                  b.authors AS authors, p.chapter_title AS chapterTitle
             FROM passages p
             JOIN books b ON b.id = p.book_id
             JOIN cs_book_class cc ON cc.book_id = p.book_id AND cc.category = 'nonfiction'
             JOIN cs_passage_salience s ON s.passage_id = p.id
            WHERE s.prose >= 0.5
            ORDER BY (p.rowid * 2654435761) % 4294967296
            LIMIT ?`,
        )
        .all(limit) as ThemePassage[]
    ).filter((r) => r.text.trim().split(/\s+/).length >= MIN_WORDS);
  }

  const result: SampleResult = {
    model,
    requested: limit,
    processed: 0,
    excluded: 0,
    parseFailures: 0,
    tokensPerSec: null,
    avgSecondsPerPassage: null,
    items: [],
  };
  if (status) status.total = passages.length;

  let totalEvalTokens = 0;
  let totalEvalNs = 0;
  const t0 = Date.now();
  for (const p of passages) {
    result.processed++;
    if (status) {
      status.processed++;
      status.note = p.bookTitle.slice(0, 60);
    }
    try {
      const { outcome, evalCount, evalDurationNs } = await extractOne(
        p,
        { kind: "book" },
        [],
        model,
      );
      if (evalCount && evalDurationNs) {
        totalEvalTokens += evalCount;
        totalEvalNs += evalDurationNs;
      }
      if (outcome.status === "excluded") result.excluded++;
      result.items.push({
        passageId: p.passageId,
        bookTitle: p.bookTitle,
        snippet: p.text.replace(/\s+/g, " ").trim().slice(0, 200),
        outcome,
      });
    } catch (e) {
      result.parseFailures++;
      result.items.push({
        passageId: p.passageId,
        bookTitle: p.bookTitle,
        snippet: p.text.replace(/\s+/g, " ").trim().slice(0, 200),
        outcome: { status: "error", reason: e instanceof Error ? e.message : String(e) },
      });
    }
    await tick();
  }
  if (totalEvalNs > 0) result.tokensPerSec = totalEvalTokens / (totalEvalNs / 1e9);
  if (result.processed > 0) {
    result.avgSecondsPerPassage = (Date.now() - t0) / 1000 / result.processed;
  }
  return result;
}
