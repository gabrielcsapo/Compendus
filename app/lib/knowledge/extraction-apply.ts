/**
 * Post-extraction processing — the second half of the analysis pipeline,
 * shared by BOTH execution paths:
 *
 *   - local: pipeline.ts runs GLiNER inline and calls applyExtraction()
 *   - fleet (fire-and-continue): pipeline.ts enqueues extract-entities and
 *     RETURNS; when a device posts the result, the kind's apply hook calls
 *     applyExtraction() and the book finalizes in the background.
 *
 * Everything downstream of "we have entity spans per passage" lives here:
 * mention insertion + cross-book resolution, typed relationship derivation,
 * YAKE concept keyphrases, canonical-mapping rebuild, stats, and the
 * book_analysis status finalize.
 *
 * Import-cycle guard: this module must never import pipeline.ts or
 * fabric/kinds.ts — kinds.ts imports US (for its apply hook) and pipeline
 * imports us too.
 */
import { randomUUID } from "crypto";
import { and, eq, lt } from "drizzle-orm";
import { db, rawDb, passages, entityMentions, entityRelationships, bookAnalysis } from "../db";
import type { EntityType } from "../db/schema";
import { EntityResolver, recomputeStatsForBook, rebuildCanonicalMapping } from "./resolution";
import { extractRelations, relationKey, type RelEntity, type ExtractedRelation } from "./relations";
import { extractKeyphrases } from "./keyphrase";
import { isNoiseSpan } from "./gliner-extract";

export const PIPELINE_VERSION = "2.1.0";
export const EXTRACT_MODEL = "gliner_small-v2";

/** One extracted entity span (the extract-entities v2 result shape). */
export interface ExtractedSpan {
  name: string;
  type: string;
  score: number;
  surfaceText: string;
  charStart: number;
  charEnd: number;
}

export interface ApplyExtractionInput {
  bookId: string;
  /** Passage ids in extraction order (the enqueue payload order) — texts are
   * read from the DB here, so fabric payloads stay light (ids, not prose). */
  passageIds: string[];
  /** Per-passage entity spans, aligned with `passageIds`. */
  entities: ExtractedSpan[][];
  /** Transcripts pay a higher confidence bar (Whisper mangles proper nouns). */
  sourceKind: "text" | "transcript";
  log?: (m: string) => void;
}

export interface ApplyExtractionResult {
  entityCount: number;
  relationshipCount: number;
  conceptMentions: number;
}

/**
 * Persist one book's extraction: mentions → relationships → concepts →
 * canonical rebuild → stats → finalize book_analysis.
 *
 * Returns null (without touching anything) when the payload's passage ids no
 * longer exist — the book was re-analyzed while this result was in flight, so
 * applying would anchor mentions to deleted rows. The newer run owns the book.
 *
 * SERIALIZED: fire-and-continue means several fleet results can land at once
 * (each apply runs inside its result POST), stacking EntityResolver embeds on
 * top of the queue's own embedding work — concurrent applies OOM-killed the
 * 2-core container. One apply at a time keeps the memory envelope flat; the
 * fleet items just wait a few extra seconds in their HTTP requests.
 */
let applyChain: Promise<unknown> = Promise.resolve();

/** Last O(corpus) canonical-mapping/stats recompute (debounced — see below). */
let lastGlobalRecompute = 0;
const RECOMPUTE_EVERY_MS = 10 * 60 * 1000;

export function applyExtraction(
  input: ApplyExtractionInput,
): Promise<ApplyExtractionResult | null> {
  const run = applyChain.then(
    () => applyExtractionInner(input),
    () => applyExtractionInner(input),
  );
  applyChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function applyExtractionInner(
  input: ApplyExtractionInput,
): Promise<ApplyExtractionResult | null> {
  const { bookId, sourceKind } = input;
  const log = input.log ?? ((m: string) => console.log(`[KG ${bookId.slice(0, 8)}] ${m}`));

  // Staleness guard: a re-analysis clears + re-inserts passages under new ids.
  const probeId = input.passageIds[0];
  if (!probeId) return null;
  const alive = db
    .select({ id: passages.id })
    .from(passages)
    .where(and(eq(passages.id, probeId), eq(passages.bookId, bookId)))
    .get();
  if (!alive) {
    log("extraction result arrived for stale passages (book re-analyzed) — skipping apply");
    return null;
  }

  // Texts come from the DB (payloads carry ids only). Preserve PAYLOAD order
  // — the entity arrays are index-aligned with passageIds.
  const textById = new Map<string, string>();
  const CHUNK = 400; // stay under SQLite's bound-parameter limit
  for (let i = 0; i < input.passageIds.length; i += CHUNK) {
    const ids = input.passageIds.slice(i, i + CHUNK);
    const rows = rawDb
      .prepare(`SELECT id, text FROM passages WHERE id IN (${ids.map(() => "?").join(",")})`)
      .all(...ids) as Array<{ id: string; text: string }>;
    for (const r of rows) textById.set(r.id, r.text);
  }
  const passageList = input.passageIds.map((id) => ({ id, text: textById.get(id) ?? "" }));
  const missing = passageList.filter((p) => !p.text).length;
  if (missing > 0) {
    log(`apply: ${missing}/${passageList.length} payload passages missing from DB — skipping`);
    return null;
  }

  // Idempotent re-apply: a crash/restart mid-apply leaves partial mentions; a
  // retried or deferred apply must not double them. Scoped clear (mentions +
  // relationships only — passages/embeddings/figures untouched).
  db.delete(entityRelationships).where(eq(entityRelationships.bookId, bookId)).run();
  db.delete(entityMentions).where(eq(entityMentions.bookId, bookId)).run();

  const resolver = new EntityResolver();
  // Batch-embed every new entity name up front (a handful of forward passes)
  // — per-name embeds inside the loop were the apply's dominant CPU.
  const allSpans: Array<{ name: string; type: EntityType }> = [];
  for (let i = 0; i < passageList.length; i++) {
    for (const ent of input.entities[i] ?? []) {
      if (sourceKind === "transcript" && ent.score < 0.65) continue;
      allSpans.push({ name: ent.name, type: ent.type as EntityType });
    }
  }
  await resolver.preEmbed(allSpans);

  const touched = new Set<string>();
  // Typed edges (the GLiREL substitute), deduped per book by relationKey; we keep
  // the highest-confidence occurrence and its evidence passage.
  const relations = new Map<string, ExtractedRelation & { passageId: string }>();

  for (let i = 0; i < passageList.length; i++) {
    const passage = passageList[i];
    const relEnts: RelEntity[] = [];
    for (const ent of input.entities[i] ?? []) {
      // Whisper mangles proper nouns; transcripts pay a higher confidence
      // bar so mis-heard names don't pollute the canonical graph.
      if (sourceKind === "transcript" && ent.score < 0.65) continue;
      // Fleet results carry type as a validated string; the resolver treats
      // unknown types like GLiNER's own labels (same cast the pipeline used).
      const entityId = await resolver.resolve({ name: ent.name, type: ent.type as EntityType });
      touched.add(entityId);
      db.insert(entityMentions)
        .values({
          id: randomUUID(),
          entityId,
          passageId: passage.id,
          bookId,
          surfaceText: ent.surfaceText,
          charStart: ent.charStart,
          charEnd: ent.charEnd,
          role: null,
          confidence: ent.score,
          createdAt: new Date(),
        })
        .run();
      relEnts.push({
        entityId,
        type: ent.type as EntityType,
        name: ent.name,
        charStart: ent.charStart,
        charEnd: ent.charEnd,
      });
    }
    // Derive typed relationships from the text between co-located entities.
    for (const rel of extractRelations(passage.text, relEnts)) {
      const key = relationKey(rel);
      const prev = relations.get(key);
      if (!prev || rel.confidence > prev.confidence)
        relations.set(key, { ...rel, passageId: passage.id });
    }
    if (i > 0 && i % 200 === 0) log(`mentions persisted for ${i}/${passageList.length} passages`);
    // Yield the event loop every few passages: with embeds batched up front,
    // this loop is near-pure synchronous SQLite work — without yields a
    // 16k-passage apply held the loop for 30+ minutes and the box served
    // nothing (the recurring "unreachable" alerts). A setImmediate every 20
    // passages costs <1% throughput and keeps HTTP alive throughout.
    if (i % 20 === 19) await new Promise((r) => setImmediate(r));
  }

  // Concept keyphrases (YAKE — pure JS, no model) for the distinctive
  // multi-word ideas GLiNER misses.
  const conceptMentions = await extractConcepts(passageList, bookId, resolver, touched);
  log(`added concept keyphrases (${conceptMentions} grounded mentions)`);

  const relationshipCount = persistRelationships(bookId, relations);
  log(`persisted ${relationshipCount} typed relationships`);

  // Rebuild the canonical identity mapping (merges variants, flags noise) and
  // recompute canonical-level counts. Non-destructive: extraction rows are
  // untouched, only the derived mapping + count caches change. DEBOUNCED:
  // both are O(corpus) synchronous better-sqlite3 work on the main thread —
  // at 40k+ passages they block the event loop for minutes, taking the whole
  // server offline (HTTP dead, fleet backoffs) once per applied book. They're
  // derived caches, so intermediate books finalize with slightly-stale
  // canonical counts that the next recompute trues up.
  if (Date.now() - lastGlobalRecompute > RECOMPUTE_EVERY_MS) {
    rebuildCanonicalMapping();
    recomputeStatsForBook();
    lastGlobalRecompute = Date.now();
    log("canonical mapping + stats recomputed");
  } else {
    log("canonical recompute deferred (debounced — next pass trues up counts)");
  }

  finalizeStatus(bookId, passageList.length, touched.size, relationshipCount);
  log(`analysis finalized: ${touched.size} entities, ${relationshipCount} relationships`);
  return { entityCount: touched.size, relationshipCount, conceptMentions };
}

/** Max passages to anchor a single concept keyphrase to (provenance, not noise). */
const CONCEPT_MAX_MENTIONS = 5;

/**
 * Run YAKE over the whole book, keep the distinctive *multi-word* concepts, and
 * ground each to the passages that contain it. Single-word phrases are dropped:
 * they overlap GLiNER's named entities and are where its stopword noise lives.
 * Operates on passage chunks (not source sections) so the fleet apply path —
 * which only has the enqueue payload — produces identical concepts to local.
 * Returns the number of grounded mentions written.
 */
async function extractConcepts(
  chunks: Array<{ id: string; text: string }>,
  bookId: string,
  resolver: EntityResolver,
  touched: Set<string>,
): Promise<number> {
  const fullText = chunks.map((c) => c.text).join("\n");
  const keyphrases = extractKeyphrases(fullText, 60).filter(
    // Multi-word only, and reject the same verb-fragment / titled-person noise we
    // drop from GLiNER spans — YAKE surfaces "Father Kleinsorge said" too.
    (k) => k.normalized.includes(" ") && !isNoiseSpan(k.phrase, "concept"),
  );
  let mentions = 0;
  for (const kp of keyphrases.slice(0, 40)) {
    // Same event-loop courtesy as the mention loop: each phrase scans every
    // passage's text (a 16k-passage book = 16k indexOf calls per phrase).
    await new Promise((r) => setImmediate(r));
    // Ground FIRST: find passages containing the phrase verbatim. YAKE can build
    // n-grams that cross punctuation/sentence boundaries (e.g. "park. Father
    // Kleinsorge" → "park father kleinsorge"), which never match a contiguous
    // substring — those are noise. Only create the entity if it actually grounds,
    // so we never mint a zero-mention phantom concept.
    const hits: Array<{ passageId: string; charStart: number; surfaceText: string }> = [];
    for (let k = 0; k < chunks.length && hits.length < CONCEPT_MAX_MENTIONS; k++) {
      const idx = chunks[k].text.toLowerCase().indexOf(kp.normalized);
      if (idx < 0) continue;
      hits.push({
        passageId: chunks[k].id,
        charStart: idx,
        surfaceText: chunks[k].text.slice(idx, idx + kp.normalized.length),
      });
    }
    if (hits.length === 0) continue; // ungrounded phrase — skip entirely

    const entityId = await resolver.resolve({ name: kp.phrase, type: "concept" });
    touched.add(entityId);
    for (const h of hits) {
      db.insert(entityMentions)
        .values({
          id: randomUUID(),
          entityId,
          passageId: h.passageId,
          bookId,
          surfaceText: h.surfaceText,
          charStart: h.charStart,
          charEnd: h.charStart + kp.normalized.length,
          role: "concept",
          confidence: null,
          createdAt: new Date(),
        })
        .run();
      mentions++;
    }
  }
  return mentions;
}

/** Insert the deduped typed edges; returns the count written. */
function persistRelationships(
  bookId: string,
  relations: Map<string, ExtractedRelation & { passageId: string }>,
): number {
  if (relations.size === 0) return 0;
  const now = new Date();
  const rows = [...relations.values()].map((r) => ({
    id: randomUUID(),
    sourceEntityId: r.sourceEntityId,
    targetEntityId: r.targetEntityId,
    type: r.type,
    description: r.description,
    evidencePassageId: r.passageId,
    bookId,
    confidence: r.confidence,
    createdAt: now,
  }));
  for (let i = 0; i < rows.length; i += 64) {
    db.insert(entityRelationships)
      .values(rows.slice(i, i + 64))
      .run();
  }
  return rows.length;
}

// --- book_analysis status helpers --------------------------------------------------

export function upsertStatus(bookId: string, status: string, error?: string): void {
  const now = new Date();
  db.insert(bookAnalysis)
    .values({
      bookId,
      status,
      error: error ?? null,
      pipelineVersion: PIPELINE_VERSION,
      model: EXTRACT_MODEL,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: bookAnalysis.bookId,
      set: {
        status,
        error: error ?? null,
        pipelineVersion: PIPELINE_VERSION,
        model: EXTRACT_MODEL,
        updatedAt: now,
      },
    })
    .run();
}

export function finalizeStatus(bookId: string, p: number, e: number, r: number): void {
  db.update(bookAnalysis)
    .set({
      status: "completed",
      passageCount: p,
      entityCount: e,
      relationshipCount: r,
      error: null,
      analyzedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(bookAnalysis.bookId, bookId))
    .run();
}

/**
 * Mark a book's analysis as errored — but only if it is still "running", so a
 * fleet failure never clobbers a newer completed re-analysis. Used by the
 * extract-entities onFailed hook.
 */
export function markAnalysisErrorIfRunning(bookId: string, error: string): void {
  db.update(bookAnalysis)
    .set({ status: "error", error, updatedAt: new Date() })
    .where(and(eq(bookAnalysis.bookId, bookId), eq(bookAnalysis.status, "running")))
    .run();
}

/**
 * Fire-and-continue means a book can sit at "running" with no local process
 * attached (the pipeline returned; the fleet apply finalizes later). If the
 * fleet item is lost without tripping onFailed (queue wiped, kind retired,
 * server died mid-apply), nothing would ever finalize it — so anything still
 * "running" after 2h flips to error and the analyze sweep re-picks it.
 * A benign race exists with a slow fleet item that completes after the flip:
 * apply's staleness guard (or the error→completed overwrite) keeps it safe.
 */
export function recoverStaleAnalyses(maxAgeMs = 2 * 60 * 60 * 1000): number {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const stale = db
    .select({ bookId: bookAnalysis.bookId })
    .from(bookAnalysis)
    .where(and(eq(bookAnalysis.status, "running"), lt(bookAnalysis.updatedAt, cutoff)))
    .all();
  for (const row of stale) {
    markAnalysisErrorIfRunning(
      row.bookId,
      "analysis stalled — no completion within 2h (recovered)",
    );
  }
  if (stale.length > 0) {
    console.log(`[KG] recovered ${stale.length} stale running analyses → error (re-analyzable)`);
  }
  return stale.length;
}
