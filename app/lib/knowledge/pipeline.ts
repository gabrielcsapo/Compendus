/**
 * Living Library analysis pipeline: turns one book into graph rows.
 *
 *   extract clean text + images → chunk → insert passages → persist figures
 *   → embed (best-effort) → extract entities (GLiNER encoder) → resolve
 *   → recompute cross-library stats → mark analyzed
 *
 * Re-runnable: re-analyzing a book clears its prior passages (mentions cascade),
 * relationships, and figures first, so results are idempotent per pipeline
 * version. EPUB only for now (the source extractor is EPUB-based).
 */
import { resolve as pathResolve } from "path";
import { rmSync } from "fs";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import {
  db,
  books,
  passages,
  entityMentions,
  entityRelationships,
  bookAnalysis,
  bookImages,
} from "../db";
import { ensureEpub } from "../processing/ensure-epub";
import { readCcdBundle } from "../storage";
import type { ContentBundle } from "../content-ast/types";
import { extractBookSource, bookSourceFromCcd, type BookSection } from "./book-source";
import { chunkSections, type PassageChunk } from "./chunker";
import { embedBatch, vectorToBuffer, EMBEDDING_MODEL } from "./embeddings";
import { extractEntitiesBatch, ensureGlinerReady, isNoiseSpan } from "./gliner-extract";
import { EntityResolver, recomputeStatsForBook, rebuildCanonicalMapping } from "./resolution";
import { extractRelations, relationKey, type RelEntity, type ExtractedRelation } from "./relations";
import { extractKeyphrases } from "./keyphrase";

const PIPELINE_VERSION = "2.1.0";
const EXTRACT_MODEL = "gliner_small-v2";

export interface AnalyzeOptions {
  onProgress?: (progress: number, message: string) => void;
  onLog?: (line: string) => void;
  signal?: AbortSignal;
}

export interface AnalyzeResult {
  passageCount: number;
  entityCount: number;
  relationshipCount: number;
  imageCount: number;
}

const EMBED_BATCH = 8;
const EXTRACT_BATCH = 8;

interface PassageRef {
  id: string;
  charStart: number;
}

export async function analyzeBook(
  bookId: string,
  opts: AnalyzeOptions = {},
): Promise<AnalyzeResult> {
  try {
    return await runAnalysis(bookId, opts);
  } catch (err) {
    // Don't leave book_analysis stuck at "running" when the pipeline throws.
    upsertStatus(bookId, "error", err instanceof Error ? err.message : "Analysis failed");
    throw err;
  }
}

async function runAnalysis(bookId: string, opts: AnalyzeOptions): Promise<AnalyzeResult> {
  const { onProgress, onLog, signal } = opts;
  const aborted = () => signal?.aborted === true;
  // Log to container stdout (visible via `deploy logs`) and the job log.
  const log = (m: string) => {
    console.log(`[KG ${bookId.slice(0, 8)}] ${m}`);
    onLog?.(m);
  };

  upsertStatus(bookId, "running");
  log("analysis started");

  const book = db.select().from(books).where(eq(books.id, bookId)).get();
  if (!book) {
    upsertStatus(bookId, "error", "Book not found");
    throw new Error("Book not found");
  }

  // Idempotent reset: clear prior graph rows + figures for this book.
  const figuresDir = pathResolve(process.cwd(), "data", "figures", bookId);
  clearBookGraph(bookId);
  rmSync(figuresDir, { recursive: true, force: true });

  // 1. Source text. Prefer the canonical CCD bundle (already-clean, correct
  // reading order incl. de-interleaved PDF columns — one substrate for every
  // format). Fall back to EPUB extraction for books not yet backfilled.
  onProgress?.(2, "Reading book text…");
  let src: Awaited<ReturnType<typeof extractBookSource>>;
  const bundle = book.ccdPath ? readCcdBundle<ContentBundle>(book.ccdPath) : null;
  if (bundle) {
    log(`using CCD bundle (${bundle.chapters.length} chapters, ${bundle.sourceFormat})`);
    src = bookSourceFromCcd(bundle);
  } else {
    onProgress?.(1, "Preparing EPUB…");
    const epubPath = await ensureEpub(book, {
      onProgress: (p, m) => onProgress?.(Math.max(1, Math.round(p * 0.1)), `Converting: ${m}`),
    });
    log(
      book.format === "epub"
        ? "using original EPUB (no CCD yet)"
        : `prepared EPUB from ${book.format} (no CCD yet)`,
    );
    src = await extractBookSource(epubPath, figuresDir);
  }
  if ("unsupported" in src) {
    upsertStatus(bookId, "error", src.unsupported);
    throw new Error(src.unsupported);
  }

  const totalImages = src.sections.reduce((n, s) => n + s.images.length, 0);
  log(
    `extracted ${src.sections.length} sections, ${src.totalCharacters} chars, ${totalImages} images`,
  );

  // 2. Chunk into passages.
  const { chunks } = chunkSections(src.sections);
  if (chunks.length === 0) {
    finalizeStatus(bookId, 0, 0, 0);
    return { passageCount: 0, entityCount: 0, relationshipCount: 0, imageCount: 0 };
  }
  log(`chunked into ${chunks.length} passages; embedding…`);

  // 3. Insert ALL passages first (no embedding). Extraction must never be
  //    blocked by embedding, so passage rows are written up front.
  onProgress?.(4, `Indexing ${chunks.length} passages…`);
  const passageRefs: PassageRef[] = [];
  const now = new Date();
  for (let i = 0; i < chunks.length; i += 64) {
    const rows = chunks.slice(i, i + 64).map((c) => {
      const id = randomUUID();
      passageRefs.push({ id, charStart: c.charStart });
      return {
        id,
        bookId,
        spineIndex: c.spineIndex,
        page: c.page,
        charStart: c.charStart,
        charEnd: c.charEnd,
        ordinal: c.ordinal,
        chapterTitle: c.chapterTitle,
        text: c.text,
        tokenCount: null,
        embedding: null,
        embeddingModel: null,
        createdAt: now,
      };
    });
    db.insert(passages).values(rows).run();
  }
  log(`inserted ${passageRefs.length} passages`);

  // 4. Persist figures, linked to the nearest passage by position.
  const imageCount = persistImages(bookId, src.sections, passageRefs);
  log(`persisted ${imageCount} figures`);

  // 5. Best-effort embeddings for semantic search. onnxruntime-node has
  //    deadlocked mid-run in this container (CPU idle, blocked) regardless of
  //    thread settings; a per-batch timeout + circuit breaker means a stall
  //    degrades semantic wander but NEVER blocks the graph build.
  onProgress?.(15, "Embedding passages for semantic search…");
  const embedded = await embedPassagesBestEffort(chunks, passageRefs, log, onProgress, aborted);
  log(`embedded ${embedded}/${chunks.length} passages`);

  // 6. Load the GLiNER entity model (encoder — fast, light; can't lock up the
  //    shared host the way an autoregressive LLM would).
  onProgress?.(19, "Loading entity model…");
  log("loading GLiNER…");
  await ensureGlinerReady(onLog);
  log("GLiNER ready; extracting entities…");

  // 7. Extract entities in batches (one encoder forward pass per batch) and
  //    persist mentions. Relationships are derived at query time from
  //    co-occurrence + semantic neighbors (no generative model needed).
  const resolver = new EntityResolver();
  const touched = new Set<string>();
  // Typed edges (the GLiREL substitute), deduped per book by relationKey; we keep
  // the highest-confidence occurrence and its evidence passage.
  const relations = new Map<string, ExtractedRelation & { passageId: string }>();

  for (let i = 0; i < chunks.length; i += EXTRACT_BATCH) {
    if (aborted()) {
      return {
        passageCount: passageRefs.length,
        entityCount: touched.size,
        relationshipCount: 0,
        imageCount,
      };
    }
    const slice = chunks.slice(i, i + EXTRACT_BATCH);
    let batch: Awaited<ReturnType<typeof extractEntitiesBatch>>;
    try {
      batch = await withTimeout(extractEntitiesBatch(slice.map((c) => c.text)), 60000);
    } catch (e) {
      log(
        `extraction stalled at ${i}/${chunks.length} (${e instanceof Error ? e.message : "error"}); skipping batch`,
      );
      continue;
    }

    for (let j = 0; j < slice.length; j++) {
      const passageId = passageRefs[i + j].id;
      const relEnts: RelEntity[] = [];
      for (const ent of batch[j]) {
        const entityId = await resolver.resolve({ name: ent.name, type: ent.type });
        touched.add(entityId);
        db.insert(entityMentions)
          .values({
            id: randomUUID(),
            entityId,
            passageId,
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
          type: ent.type,
          name: ent.name,
          charStart: ent.charStart,
          charEnd: ent.charEnd,
        });
      }
      // Derive typed relationships from the text between co-located entities.
      for (const rel of extractRelations(slice[j].text, relEnts)) {
        const key = relationKey(rel);
        const prev = relations.get(key);
        if (!prev || rel.confidence > prev.confidence) relations.set(key, { ...rel, passageId });
      }
    }

    onProgress?.(
      20 + Math.round((i / chunks.length) * 75),
      `Extracting ideas… ${Math.min(i + EXTRACT_BATCH, chunks.length)}/${chunks.length}`,
    );
    if (i % 80 === 0)
      log(
        `extracted ${Math.min(i + EXTRACT_BATCH, chunks.length)}/${chunks.length} — ${touched.size} entities`,
      );
  }

  // 7b. Concept keyphrases (YAKE — pure JS, no model) for the distinctive
  //     multi-word ideas GLiNER misses. Each becomes a grounded `concept` entity
  //     anchored to up to a few passages that contain it verbatim.
  onProgress?.(90, "Surfacing key concepts…");
  const conceptMentions = await extractConcepts(
    src.sections,
    chunks,
    passageRefs,
    bookId,
    resolver,
    touched,
  );
  log(`added concept keyphrases (${conceptMentions} grounded mentions)`);

  // 7c. Persist the typed relationship edges derived during extraction.
  onProgress?.(94, "Connecting people, places and ideas…");
  const relationshipCount = persistRelationships(bookId, relations);
  log(`persisted ${relationshipCount} typed relationships`);

  // 8. Rebuild the canonical identity mapping (merges variants, flags noise) and
  //    recompute canonical-level counts. Non-destructive: extraction rows are
  //    untouched, only the derived mapping + count caches change.
  onProgress?.(96, "Linking ideas across your library…");
  rebuildCanonicalMapping();
  recomputeStatsForBook();

  finalizeStatus(bookId, chunks.length, touched.size, relationshipCount);
  onProgress?.(100, "Analysis complete");
  return {
    passageCount: chunks.length,
    entityCount: touched.size,
    relationshipCount,
    imageCount,
  };
}

/** Max passages to anchor a single concept keyphrase to (provenance, not noise). */
const CONCEPT_MAX_MENTIONS = 5;

/**
 * Run YAKE over the whole book, keep the distinctive *multi-word* concepts, and
 * ground each to the passages that contain it. Single-word phrases are dropped:
 * they overlap GLiNER's named entities and are where its stopword noise lives.
 * Returns the number of grounded mentions written.
 */
async function extractConcepts(
  sections: BookSection[],
  chunks: PassageChunk[],
  refs: PassageRef[],
  bookId: string,
  resolver: EntityResolver,
  touched: Set<string>,
): Promise<number> {
  const fullText = sections.map((s) => s.text).join("\n");
  const keyphrases = extractKeyphrases(fullText, 60).filter(
    // Multi-word only, and reject the same verb-fragment / titled-person noise we
    // drop from GLiNER spans — YAKE surfaces "Father Kleinsorge said" too.
    (k) => k.normalized.includes(" ") && !isNoiseSpan(k.phrase, "concept"),
  );
  let mentions = 0;
  for (const kp of keyphrases.slice(0, 40)) {
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
        passageId: refs[k].id,
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

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`embed timeout after ${ms}ms`)), ms),
    ),
  ]);
}

/**
 * Embed passages into passages.embedding, best-effort. On the first stalled batch
 * (onnxruntime-node deadlock — CPU idle, never returns) we circuit-break: the
 * wedged native call won't recover, so we stop, leave remaining embeddings null,
 * and let the pipeline finish a complete graph. Semantic wander degrades; edges
 * and co-occurrence still work.
 */
async function embedPassagesBestEffort(
  chunks: PassageChunk[],
  refs: PassageRef[],
  log: (m: string) => void,
  onProgress?: (p: number, m: string) => void,
  aborted?: () => boolean,
): Promise<number> {
  let embedded = 0;
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    if (aborted?.()) {
      log(`embedding aborted at ${i}/${chunks.length}`);
      return embedded;
    }
    const slice = chunks.slice(i, i + EMBED_BATCH);
    let vecs: Float32Array[];
    try {
      vecs = await withTimeout(embedBatch(slice.map((c) => c.text)), 30000);
    } catch (e) {
      log(
        `embedding stalled at ${i}/${chunks.length} (${e instanceof Error ? e.message : "error"}); ` +
          `continuing without remaining embeddings — semantic search degraded`,
      );
      return embedded;
    }
    for (let j = 0; j < slice.length; j++) {
      db.update(passages)
        .set({ embedding: vectorToBuffer(vecs[j]), embeddingModel: EMBEDDING_MODEL })
        .where(eq(passages.id, refs[i + j].id))
        .run();
      embedded++;
    }
    if (i % 80 === 0) {
      log(
        `embedded ${embedded}/${chunks.length} (rss ${Math.round(process.memoryUsage().rss / 1048576)}MB)`,
      );
      onProgress?.(
        15 + Math.round((i / chunks.length) * 3),
        `Embedding… ${embedded}/${chunks.length}`,
      );
    }
  }
  return embedded;
}

/** Insert book_images rows, linking each figure to the nearest preceding passage. */
function persistImages(bookId: string, sections: BookSection[], refs: PassageRef[]): number {
  const sorted = [...refs].sort((a, b) => a.charStart - b.charStart);
  let ordinal = 0;
  let count = 0;
  for (const section of sections) {
    for (const img of section.images) {
      let passageId: string | null = null;
      for (const p of sorted) {
        if (p.charStart <= img.charStart) passageId = p.id;
        else break;
      }
      db.insert(bookImages)
        .values({
          id: randomUUID(),
          bookId,
          passageId,
          spineIndex: section.spineIndex,
          ordinal: ordinal++,
          charStart: img.charStart,
          storedPath: `data/figures/${bookId}/${img.storedPath}`,
          mimeType: img.mimeType,
          alt: img.alt,
          caption: img.caption,
          createdAt: new Date(),
        })
        .run();
      count++;
    }
  }
  return count;
}

// --- status + reset helpers ----------------------------------------------------

function upsertStatus(bookId: string, status: string, error?: string): void {
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

function finalizeStatus(bookId: string, p: number, e: number, r: number): void {
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

/** Clear a book's prior graph so re-analysis is idempotent. Deletes mentions
 *  explicitly (not relying on cascade) so it also cleans any orphans from runs
 *  made before foreign keys were enabled. */
function clearBookGraph(bookId: string): void {
  db.delete(bookImages).where(eq(bookImages.bookId, bookId)).run();
  db.delete(entityRelationships).where(eq(entityRelationships.bookId, bookId)).run();
  db.delete(entityMentions).where(eq(entityMentions.bookId, bookId)).run();
  db.delete(passages).where(eq(passages.bookId, bookId)).run();
}
