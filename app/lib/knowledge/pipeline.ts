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
import { rmSync, readFileSync } from "fs";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db, books, passages, entityMentions, entityRelationships, bookImages } from "../db";
import { ensureEpub } from "../processing/ensure-epub";
import { readCcdBundle } from "../storage";
import type { ContentBundle } from "../content-ast/types";
import {
  extractBookSource,
  bookSourceFromCcd,
  bookSourceFromTranscript,
  type BookSection,
} from "./book-source";
import { chunkSections, type PassageChunk } from "./chunker";
import { embedBatch, vectorToBuffer, EMBEDDING_MODEL } from "./embeddings";
import { linkBook, rebuildStructureIfDue } from "./substrate";
import { extractEntitiesBatch, ensureGlinerReady, type GlinerEntity } from "./gliner-extract";
import { enqueueWork, runtimeOnFleet, waitForWorkResult } from "../fabric";
import "../fabric/kinds";
import {
  applyExtraction,
  upsertStatus,
  finalizeStatus,
  recoverStaleAnalyses,
} from "./extraction-apply";

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
  // Fire-and-continue books finalize from the fleet apply hook; anything
  // orphaned at "running" >2h flips to error here so the sweep re-picks it.
  recoverStaleAnalyses();
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
  let sourceKind: "text" | "transcript" = "text";
  const bundle = book.ccdPath ? readCcdBundle<ContentBundle>(book.ccdPath) : null;
  if (bundle) {
    log(`using CCD bundle (${bundle.chapters.length} chapters, ${bundle.sourceFormat})`);
    src = bookSourceFromCcd(bundle);
  } else if (book.transcriptPath) {
    // Audiobooks: the Whisper transcript IS the text. Sections split on long
    // narration pauses; everything downstream (chunk → embed → link → GLiNER)
    // is format-blind from here.
    const transcriptFile = pathResolve(process.cwd(), book.transcriptPath);
    const transcript = JSON.parse(readFileSync(transcriptFile, "utf8"));
    src = bookSourceFromTranscript(transcript);
    sourceKind = "transcript";
    log(`using audiobook transcript (${transcript.segments?.length ?? 0} segments)`);
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
  // Breadcrumb: the worker has crashed here on large books before the first
  // per-batch rss line lands, so stamp memory at the entry to the embed phase.
  log(
    `chunked into ${chunks.length} passages; embedding… (rss ${Math.round(process.memoryUsage().rss / 1048576)}MB)`,
  );

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

  // 5. Embeddings for semantic search — FLEET FIRST: this was the last heavy
  //    inference still running on the box. If a device with the onnx-embed
  //    runtime checked in recently, ship the passage ids (texts fetched by
  //    ref) and wait briefly — a laptop embeds a book in seconds, and the
  //    reembed-book apply hook writes the vectors straight into the substrate
  //    embeddings table. Local best-effort inference stays the fallback
  //    (per-batch timeout + circuit breaker — onnxruntime has deadlocked in
  //    this container before; a stall degrades wander but never blocks).
  onProgress?.(15, "Embedding passages for semantic search…");
  const payloadIds = chunks.map((_c, x) => passageRefs[x].id);
  let embedded = 0;
  if (runtimeOnFleet("onnx-embed")) {
    try {
      const { item } = enqueueWork({
        project: "compendus",
        kind: "reembed-book",
        payload: { bookId, model: EMBEDDING_MODEL, passageIds: payloadIds },
        requirements: { runtimes: ["onnx-embed"], estMinutes: 2 },
      });
      log(`embedding offered to the fleet (${chunks.length} passages)…`);
      const beat = setInterval(() => onProgress?.(15, "Fleet is embedding…"), 20_000);
      try {
        const res = await waitForWorkResult(item.id, {
          timeoutMs: 4 * 60 * 1000,
          leaseWithinMs: 90 * 1000,
          signal,
        });
        if (res) {
          embedded = chunks.length;
          log("fleet embedded the book — skipping local inference");
        } else {
          log("fleet didn't embed in time — embedding locally");
        }
      } finally {
        clearInterval(beat);
      }
    } catch (e) {
      log(`fleet embedding unavailable (${e instanceof Error ? e.message : e}); embedding locally`);
    }
  }
  if (embedded === 0) {
    embedded = await embedPassagesBestEffort(chunks, passageRefs, log, onProgress, aborted);
  }
  log(`embedded ${embedded}/${chunks.length} passages`);

  // 5b. Link into the semantic substrate (kNN graph, topics, centrality,
  //     bridges, roles). This is the embed-first reorder: the book is
  //     wanderable from here, before the slow GLiNER pass below — names and
  //     provenance fill in when extraction catches up.
  if (embedded > 0) {
    onProgress?.(17, "Linking into your library…");
    // The structure rebuild runs minutes on its worker thread with no job
    // progress of its own — without a heartbeat the queue watchdog declares
    // the job stuck at ~3 min, aborts it, and the re-run wastes a full
    // re-analysis (the "running: N" zombie pile-up). Tick while we wait.
    const linkBeat = setInterval(() => onProgress?.(17, "Linking into your library…"), 20_000);
    try {
      const stats = await linkBook(bookId, log);
      if (stats) {
        log(`substrate linked: ${stats.topicCount} topics, ${stats.bridgeCount} bridges`);
        // A rebuild mints new/reshaped topics. Touch the atlas read-models so
        // their lazy naming enqueues fire NOW — otherwise the fleet sits idle
        // until someone happens to open /journeys.
        try {
          const atlas = await import("./atlas");
          atlas.listRealms(undefined);
          atlas.listTopics({ limit: 80 });
          atlas.listTopics({ limit: 80, offset: 80 });
        } catch (e) {
          log(`naming sweep skipped: ${e instanceof Error ? e.message : e}`);
        }
      }
    } catch (e) {
      log(`substrate link failed (non-fatal): ${e instanceof Error ? e.message : e}`);
    } finally {
      clearInterval(linkBeat);
    }
  }

  // 6. Entity extraction — FLEET FIRST, fire-and-continue. GLiNER inference is
  //    the box's heaviest CPU; if a fleet device with the gliner runtime (the
  //    Node harness on a charging laptop) checked in recently, enqueue the
  //    passages and RETURN: the queue slot frees for the next book while the
  //    fleet chews. The extract-entities apply hook runs the full
  //    post-processing when the result lands and finalizes book_analysis —
  //    until then the book stays "running"; onFailed (or the 2h stale-running
  //    recovery) flips abandoned runs to error so the sweep re-picks them.
  onProgress?.(19, "Extracting entities…");
  let fleetEntities: GlinerEntity[][] | null = null;
  if (runtimeOnFleet("gliner")) {
    try {
      const { item, deduped } = enqueueWork({
        project: "compendus",
        kind: "extract-entities",
        payload: {
          bookId,
          // resultContract busts the content-addressed cache across contract
          // changes (v2 added offsets; v3 dropped inline text for ids).
          resultContract: 3,
          sourceKind,
          passageIds: payloadIds,
        },
        requirements: { runtimes: ["gliner"], estMinutes: 5 },
      });
      // Re-analysis mints new passage ids, so a dedupe hit is near-impossible —
      // but if one lands on a done item, reuse its cached spans inline.
      if (deduped && item.status === "done" && item.result) {
        const cached = JSON.parse(item.result) as { entities?: GlinerEntity[][] };
        if (Array.isArray(cached.entities) && cached.entities.length === chunks.length) {
          fleetEntities = cached.entities;
          log("fleet cache hit — reusing previous extraction result");
        }
      }
      if (!fleetEntities) {
        log(
          `extraction offloaded to fleet (${chunks.length} passages) — analysis finishes in background`,
        );
        onProgress?.(100, "Entity extraction offloaded to the fleet");
        return { passageCount: chunks.length, entityCount: 0, relationshipCount: 0, imageCount };
      }
    } catch (e) {
      log(`fleet extraction unavailable (${e instanceof Error ? e.message : e}); running locally`);
    }
  }
  if (!fleetEntities) {
    onProgress?.(19, "Loading entity model…");
    log("loading GLiNER…");
    await ensureGlinerReady(onLog);
    log("GLiNER ready; extracting entities…");
  }

  // 7. Run inference in batches (one encoder forward pass per batch). The
  //    spans then go through the SAME post-processing module the fleet apply
  //    hook uses, so both paths produce identical graphs.
  const allEntities: GlinerEntity[][] = [];
  for (let i = 0; i < chunks.length; i += EXTRACT_BATCH) {
    if (aborted()) {
      // Status stays "running"; the stale-running recovery flips it to a
      // re-analyzable error if nothing finishes the book within 2h.
      return {
        passageCount: passageRefs.length,
        entityCount: 0,
        relationshipCount: 0,
        imageCount,
      };
    }
    const slice = chunks.slice(i, i + EXTRACT_BATCH);
    if (fleetEntities) {
      allEntities.push(...fleetEntities.slice(i, i + EXTRACT_BATCH));
    } else {
      try {
        const batch = await withTimeout(extractEntitiesBatch(slice.map((c) => c.text)), 60000);
        allEntities.push(...batch);
      } catch (e) {
        log(
          `extraction stalled at ${i}/${chunks.length} (${e instanceof Error ? e.message : "error"}); skipping batch`,
        );
        for (let j = 0; j < slice.length; j++) allEntities.push([]);
      }
    }
    onProgress?.(
      20 + Math.round((i / chunks.length) * 70),
      `Extracting ideas… ${Math.min(i + EXTRACT_BATCH, chunks.length)}/${chunks.length}`,
    );
    if (i % 80 === 0)
      log(`extracted ${Math.min(i + EXTRACT_BATCH, chunks.length)}/${chunks.length}`);
  }

  // 7b–8. Shared post-processing: mentions + cross-book resolution, typed
  //       relationships, concept keyphrases, canonical rebuild, stats, and the
  //       book_analysis finalize — one code path for local and fleet results.
  onProgress?.(90, "Connecting people, places and ideas…");
  const applied = await applyExtraction({
    bookId,
    passageIds: payloadIds,
    entities: allEntities,
    sourceKind,
    log,
  });
  const entityCount = applied?.entityCount ?? 0;
  const relationshipCount = applied?.relationshipCount ?? 0;

  // 8b. Refresh substrate structure now that entities exist: topic labels
  //     (NPMI-distinctive canonical entities) and role/bridge stats pick up the
  //     freshly extracted names. Cheap (seconds) and idempotent.
  if (embedded > 0) {
    const refreshBeat = setInterval(
      () => onProgress?.(96, "Refreshing library structure…"),
      20_000,
    );
    try {
      await rebuildStructureIfDue(log);
    } catch (e) {
      log(`substrate refresh failed (non-fatal): ${e instanceof Error ? e.message : e}`);
    } finally {
      clearInterval(refreshBeat);
    }
  }

  onProgress?.(100, "Analysis complete");
  return {
    passageCount: chunks.length,
    entityCount,
    relationshipCount,
    imageCount,
  };
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

// --- reset helper ----------------------------------------------------------------
// (status helpers live in extraction-apply.ts — shared with the fleet apply hook)

/** Clear a book's prior graph so re-analysis is idempotent. Deletes mentions
 *  explicitly (not relying on cascade) so it also cleans any orphans from runs
 *  made before foreign keys were enabled. */
function clearBookGraph(bookId: string): void {
  db.delete(bookImages).where(eq(bookImages.bookId, bookId)).run();
  db.delete(entityRelationships).where(eq(entityRelationships.bookId, bookId)).run();
  db.delete(entityMentions).where(eq(entityMentions.bookId, bookId)).run();
  db.delete(passages).where(eq(passages.bookId, bookId)).run();
}
