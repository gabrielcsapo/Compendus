/**
 * Registered fabric job kinds. Importing this module populates the registry —
 * routes and workers import it for its side effect.
 *
 * `echo` — the protocol-proving kind (F1).
 * `reembed-book` — F2's first real workload: a docked laptop embeds one book's
 *   passages with its local model and posts the vectors back; the server-side
 *   `apply` writes them into the substrate `embeddings` table. Payload carries
 *   the passage texts (work moves, not the world — a book is a few hundred KB);
 *   results are validated structurally (count, dim, base64 int8) and recorded
 *   under the worker's modelId, so a model migration is just "enqueue
 *   reembed-book for every book and let the fleet chew through it overnight."
 */
import { readFileSync, copyFileSync, openSync, readSync, closeSync, statSync } from "node:fs";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { rawDb } from "../db";
import { upsertEmbedding } from "../knowledge/substrate";
import { applyExtraction, markAnalysisErrorIfRunning } from "../knowledge/extraction-apply";
import { registerKind } from "./index";
import { storeCcdBundle } from "../storage";
import { ensureBookClassTable } from "../reckoning/classify";
import { ensureJourneyColumns } from "../concept/wander";

export interface ReembedPayload {
  bookId: string;
  model: string; // model the worker must use (pinned)
  /** v2: ids only — workers fetch texts via GET /api/fabric/passages/:bookId.
   * Inline text made each row hundreds of KB (see extract-entities v3). */
  passageIds: string[];
}

export interface ReembedResult {
  count: number;
  dim: number;
  /** base64( int8 vectors, count*dim bytes ) in payload passage order */
  vectorsB64: string;
  /** per-vector dequant scales, count floats */
  scales: number[];
}

registerKind({
  kind: "reembed-book",
  project: "compendus",
  version: 2, // v2: payload carries passageIds only (texts fetched by ref)
  validate: (payload, result) => {
    const p = payload as ReembedPayload | null;
    const r = result as ReembedResult | null;
    if (!p?.bookId || !Array.isArray(p.passageIds)) {
      return { ok: false, error: "payload must carry bookId + passageIds" };
    }
    if (!r || typeof r.vectorsB64 !== "string" || !Array.isArray(r.scales)) {
      return { ok: false, error: "result must carry vectorsB64 + scales" };
    }
    if (r.count !== p.passageIds.length || r.scales.length !== r.count) {
      return { ok: false, error: `count mismatch: ${r.count} vs ${p.passageIds.length} passages` };
    }
    if (!Number.isInteger(r.dim) || r.dim < 64 || r.dim > 4096) {
      return { ok: false, error: `implausible dim ${r.dim}` };
    }
    const bytes = Buffer.from(r.vectorsB64, "base64");
    if (bytes.length !== r.count * r.dim) {
      return { ok: false, error: `vector bytes ${bytes.length} != count*dim ${r.count * r.dim}` };
    }
    if (r.scales.some((s) => typeof s !== "number" || !(s > 0) || s > 1)) {
      return { ok: false, error: "scales must be positive floats ≤ 1" };
    }
    return { ok: true };
  },
  apply: (payload, result, ctx) => {
    const p = payload as ReembedPayload;
    const r = result as ReembedResult;
    const bytes = Buffer.from(r.vectorsB64, "base64");
    for (let i = 0; i < r.count; i++) {
      const slice = bytes.subarray(i * r.dim, (i + 1) * r.dim);
      const vec = new Float32Array(r.dim);
      for (let d = 0; d < r.dim; d++) vec[d] = slice.readInt8(d) * r.scales[i];
      upsertEmbedding("passage", p.passageIds[i], vec, ctx.modelId);
    }
    // Belt-and-braces: only known passage ids should have landed.
    const known = rawDb
      .prepare("SELECT COUNT(*) AS n FROM passages WHERE book_id = ?")
      .get(p.bookId) as { n: number };
    if (known.n === 0) throw new Error(`book ${p.bookId} has no passages`);
  },
});

// Code-mobility proof kind: payload carries a kernelHash; any js-kernel host
// fetches the bundle by hash and executes it. New kernels reach the fleet via
// server deploy — no app/harness release needed.
registerKind({
  kind: "kernel-wordstats",
  project: "compendus",
  version: 1,
  validate: (payload, result) => {
    const p = payload as { kernelHash?: string; texts?: string[] } | null;
    const r = result as {
      stats?: Array<{ words: number; unique: number; longest: string }>;
    } | null;
    if (!p?.kernelHash || !/^[0-9a-f]{64}$/.test(p.kernelHash) || !Array.isArray(p.texts)) {
      return { ok: false, error: "payload must carry kernelHash + texts" };
    }
    if (!r || !Array.isArray(r.stats) || r.stats.length !== p.texts.length) {
      return { ok: false, error: "stats must align with texts" };
    }
    for (const st of r.stats) {
      if (typeof st?.words !== "number" || typeof st?.unique !== "number") {
        return { ok: false, error: "malformed stats row" };
      }
    }
    return { ok: true };
  },
});

export interface ExtractEntitiesPayload {
  bookId: string;
  /** v3: ids only — workers fetch texts via GET /api/fabric/passages/:bookId
   * and verify the id sets match (a re-analysis mints new ids → stale job).
   * Keeping full passage text inline made every work_items row hundreds of
   * KB, which the lease scan and queue observability paid for constantly. */
  passageIds: string[];
  /** Transcripts pay a higher mention-confidence bar in apply (Whisper noise). */
  sourceKind?: "text" | "transcript";
}

export interface ExtractEntitiesResult {
  /** Per passage (payload order): extracted entity spans WITH offsets — the
   * graph anchors mentions to exact character ranges; dropping them silently
   * degrades highlights and provenance. */
  entities: Array<
    Array<{
      name: string;
      type: string;
      score: number;
      surfaceText: string;
      charStart: number;
      charEnd: number;
    }>
  >;
}

// The box's heaviest CPU (GLiNER inference) offloaded to any fleet device
// running the Node harness. FIRE-AND-CONTINUE: the analysis pipeline enqueues
// this and moves on to the next book — the queue slot frees, the book stays
// "running", and when a device posts the spans the apply hook below runs the
// full post-processing (mentions → relations → concepts → stats) and
// finalizes book_analysis. onFailed flips the book to "error" so the analyze
// sweep re-picks it (local fallback) instead of leaving it running forever.
// Idempotency gives content-addressed caching: re-analyzing an unchanged book
// reuses the fleet's previous result instantly.
registerKind({
  kind: "extract-entities",
  project: "compendus",
  version: 3, // v3: payload carries passageIds only (texts fetched by ref); v2 added span offsets
  validate: (payload, result) => {
    const p = payload as ExtractEntitiesPayload | null;
    const r = result as ExtractEntitiesResult | null;
    if (!p?.bookId || !Array.isArray(p.passageIds) || p.passageIds.length === 0) {
      return { ok: false, error: "payload must carry bookId + passageIds" };
    }
    if (!r || !Array.isArray(r.entities)) {
      return { ok: false, error: "result must carry entities[][]" };
    }
    if (r.entities.length !== p.passageIds.length) {
      return {
        ok: false,
        error: `entities length ${r.entities.length} != passageIds ${p.passageIds.length}`,
      };
    }
    for (const list of r.entities) {
      if (!Array.isArray(list) || list.length > 64) {
        return { ok: false, error: "each passage's entity list must be an array of ≤64" };
      }
      for (const e of list) {
        if (
          typeof e?.name !== "string" ||
          e.name.length === 0 ||
          e.name.length > 200 ||
          typeof e.type !== "string" ||
          typeof e.score !== "number" ||
          !(e.score >= 0 && e.score <= 1) ||
          typeof e.surfaceText !== "string" ||
          !Number.isInteger(e.charStart) ||
          !Number.isInteger(e.charEnd) ||
          e.charEnd < e.charStart
        ) {
          return { ok: false, error: "malformed entity span (offsets required)" };
        }
      }
    }
    return { ok: true };
  },
  apply: async (payload, result) => {
    const p = payload as ExtractEntitiesPayload;
    const r = result as ExtractEntitiesResult;
    // Stale-passage results (book re-analyzed mid-flight) apply as a no-op:
    // applyExtraction returns null without writing, the newer run owns the
    // book, and the item still completes (the result stays cached).
    // v3 payloads carry ids only — applyExtraction reads texts from the DB.
    await applyExtraction({
      bookId: p.bookId,
      passageIds: p.passageIds,
      entities: r.entities,
      sourceKind: p.sourceKind === "transcript" ? "transcript" : "text",
    });
  },
  onFailed: (payload, error) => {
    const p = payload as ExtractEntitiesPayload | null;
    if (!p?.bookId) return;
    markAnalysisErrorIfRunning(p.bookId, `fleet extraction failed: ${error}`);
  },
});

export interface ScaffoldPayload {
  curriculumId: string;
  topicId: string;
  topicLabel: string | null;
  module: string;
  items: Array<{ ordinal: number; role: string; bookTitle: string; text: string }>;
}

export interface ScaffoldResult {
  /** Study-path title; applied only from the first module's job. */
  title: string;
  transitions: Array<{ ordinal: number; text: string }>;
}

// Curriculum Tier B (C2): a device generates polished module titles and
// transitions with its on-device model. Rule 2 holds: the model arranges and
// annotates — items stay passages; only scaffolding text is authored, and it
// is structurally validated here before it can land.
registerKind({
  kind: "curriculum-scaffold",
  project: "compendus",
  validate: (payload, result) => {
    const p = payload as ScaffoldPayload | null;
    const r = result as ScaffoldResult | null;
    if (!p?.curriculumId || !Array.isArray(p.items) || p.items.length === 0) {
      return { ok: false, error: "payload must carry curriculumId + items" };
    }
    if (!r || typeof r.title !== "string" || !Array.isArray(r.transitions)) {
      return { ok: false, error: "result must carry title + transitions" };
    }
    const title = r.title.trim();
    if (title.length < 3 || title.length > 80) {
      return { ok: false, error: `title length ${title.length} outside 3..80` };
    }
    const wanted = new Set(p.items.map((i) => i.ordinal));
    const got = new Set(r.transitions.map((t) => t.ordinal));
    if (wanted.size !== got.size || [...wanted].some((o) => !got.has(o))) {
      return { ok: false, error: "transitions must cover exactly the payload ordinals" };
    }
    for (const t of r.transitions) {
      const text = (t.text ?? "").trim();
      if (text.length < 10 || text.length > 220) {
        return { ok: false, error: `transition for ordinal ${t.ordinal} outside 10..220 chars` };
      }
    }
    return { ok: true };
  },
  apply: (payload, result) => {
    const p = payload as ScaffoldPayload;
    const r = result as ScaffoldResult;
    const update = rawDb.prepare(
      "UPDATE curriculum_items SET transition = ? WHERE curriculum_id = ? AND ordinal = ?",
    );
    for (const t of r.transitions) update.run(t.text.trim(), p.curriculumId, t.ordinal);
    // The first module's job names the whole study path; every module flips
    // the builder so the UI can show device-authored scaffolding.
    if (p.items.some((i) => i.ordinal === 1)) {
      rawDb
        .prepare("UPDATE curricula SET title = ?, builder = 'device' WHERE id = ?")
        .run(r.title.trim(), p.curriculumId);
    } else {
      rawDb.prepare("UPDATE curricula SET builder = 'device' WHERE id = ?").run(p.curriculumId);
    }
  },
});

export interface ConvertPdfCcdPayload {
  bookId: string;
  kernelHash: string;
  fileRef: string;
  expectCcdVersion: string;
}

export interface ConvertPdfCcdResult {
  artifactHash: string;
  chapters: number;
  totalVirtual: number;
  ccdVersion: string;
}

// PDF → CCD on the fleet: hosts download the source via fileRef, run the
// pdf-ccd kernel, upload the bundle as a content-addressed artifact; apply
// pins it onto the book exactly like generateCcd would have.
registerKind({
  kind: "convert-pdf-ccd",
  project: "compendus",
  version: 1,
  validate: (payload, result) => {
    const p = payload as ConvertPdfCcdPayload | null;
    const r = result as ConvertPdfCcdResult | null;
    if (!p?.bookId || !p.kernelHash || !p.fileRef) {
      return { ok: false, error: "payload must carry bookId + kernelHash + fileRef" };
    }
    if (!r || !/^[0-9a-f]{64}$/.test(r.artifactHash ?? "")) {
      return { ok: false, error: "result must carry a sha256 artifactHash (upload first)" };
    }
    if (r.ccdVersion !== p.expectCcdVersion) {
      return { ok: false, error: `ccdVersion ${r.ccdVersion} != expected ${p.expectCcdVersion}` };
    }
    if (!Number.isInteger(r.chapters) || r.chapters < 1 || !(r.totalVirtual > 0)) {
      return { ok: false, error: "implausible chapters/totalVirtual" };
    }
    return { ok: true };
  },
  apply: (payload, _result, ctx) => {
    const p = payload as ConvertPdfCcdPayload;
    if (!ctx.artifactPath) throw new Error("artifact blob missing");
    // blob paths are stored relative to the data dir
    const abs = isAbsolute(ctx.artifactPath)
      ? ctx.artifactPath
      : resolvePath(
          process.env.COMPENDUS_DATA_DIR || resolvePath(process.cwd(), "data"),
          ctx.artifactPath,
        );
    const json = readFileSync(abs, "utf8");
    const bundle = JSON.parse(json) as { bookId?: string; chapters?: unknown[] };
    if (bundle.bookId !== p.bookId) throw new Error("bundle bookId mismatch");
    if (!Array.isArray(bundle.chapters) || bundle.chapters.length === 0) {
      throw new Error("bundle has no chapters");
    }
    const ccdPath = storeCcdBundle(p.bookId, json);
    rawDb
      .prepare("UPDATE books SET ccd_path = ?, ccd_version = ?, ccd_error = NULL WHERE id = ?")
      .run(ccdPath, p.expectCcdVersion, p.bookId);
  },
});

export interface ConvertPdfEpubPayload {
  bookId: string;
  kernelHash: string;
  fileRef: string;
  title?: string;
  authors?: string[];
  language?: string;
}

export interface ConvertPdfEpubResult {
  artifactHash: string;
  bytes: number;
}

// PDF → EPUB on the fleet: the conversion that OOM-killed the 2-core box
// (400+-page image-heavy PDFs) runs on whatever device leases it. Hosts
// download the source via fileRef, run the pdf-epub kernel, upload the EPUB
// as a binary artifact (artifactB64 host protocol); apply copies the blob
// into place exactly like convertBookToEpub would have — without ever
// holding the EPUB in box memory.
registerKind({
  kind: "convert-pdf-epub",
  project: "compendus",
  version: 1,
  validate: (payload, result) => {
    const p = payload as ConvertPdfEpubPayload | null;
    const r = result as ConvertPdfEpubResult | null;
    if (!p?.bookId || !p.kernelHash || !p.fileRef) {
      return { ok: false, error: "payload must carry bookId + kernelHash + fileRef" };
    }
    if (!r || !/^[0-9a-f]{64}$/.test(r.artifactHash ?? "")) {
      return { ok: false, error: "result must carry a sha256 artifactHash (upload first)" };
    }
    if (!Number.isInteger(r.bytes) || r.bytes < 1024) {
      return { ok: false, error: `implausible EPUB size ${r.bytes}` };
    }
    return { ok: true };
  },
  apply: (payload, result, ctx) => {
    const p = payload as ConvertPdfEpubPayload;
    const r = result as ConvertPdfEpubResult;
    if (!ctx.artifactPath) throw new Error("artifact blob missing");
    const abs = isAbsolute(ctx.artifactPath)
      ? ctx.artifactPath
      : resolvePath(
          process.env.COMPENDUS_DATA_DIR || resolvePath(process.cwd(), "data"),
          ctx.artifactPath,
        );
    // Sanity-check the ZIP magic without loading the (potentially GB-sized)
    // EPUB into memory, then move it into place with a file copy.
    const fd = openSync(abs, "r");
    const magic = Buffer.alloc(2);
    readSync(fd, magic, 0, 2, 0);
    closeSync(fd);
    if (magic.toString("latin1") !== "PK") throw new Error("artifact is not a ZIP/EPUB");
    const size = statSync(abs).size;
    if (size !== r.bytes) throw new Error(`artifact size ${size} != reported ${r.bytes}`);
    const epubRel = `data/books/${p.bookId}.epub`;
    const epubAbs = resolvePath(process.cwd(), epubRel);
    copyFileSync(abs, epubAbs);
    rawDb
      .prepare("UPDATE books SET converted_epub_path = ?, converted_epub_size = ? WHERE id = ?")
      .run(epubRel, size, p.bookId);
  },
});

export interface TrailRenderPayload {
  trailId: string;
  voiceIndex: number;
  segments: Array<{ passageId: string; text: string }>;
}

export interface TrailRenderResult {
  /** Content hash of the uploaded WAV artifact blob. */
  artifactHash: string;
  durationSec: number;
  sampleCount: number;
}

// Audio wander (S5): a device renders a saved trail's passages to narration
// with its local Kokoro voice and uploads the WAV as a content-addressed
// artifact; apply pins the hash onto the trail so /api/trails/:id/audio can
// stream it to every device forever after (compute once, reuse everywhere).
registerKind({
  kind: "tts-render-trail",
  project: "compendus",
  validate: (payload, result) => {
    const p = payload as TrailRenderPayload | null;
    const r = result as TrailRenderResult | null;
    if (!p?.trailId || !Array.isArray(p.segments) || p.segments.length === 0) {
      return { ok: false, error: "payload must carry trailId + segments" };
    }
    if (!r || typeof r.artifactHash !== "string" || !/^[0-9a-f]{64}$/.test(r.artifactHash)) {
      return {
        ok: false,
        error: "result must carry a sha256 artifactHash (upload the blob first)",
      };
    }
    if (!(r.durationSec > 0) || !(r.sampleCount > 0)) {
      return { ok: false, error: "implausible duration/sampleCount" };
    }
    // Sanity: ~24kHz mono — duration and samples must agree within 20%.
    const impliedSec = r.sampleCount / 24000;
    if (Math.abs(impliedSec - r.durationSec) > Math.max(1, impliedSec * 0.2)) {
      return { ok: false, error: "durationSec does not match sampleCount at 24kHz" };
    }
    return { ok: true };
  },
  apply: (payload, result) => {
    const p = payload as TrailRenderPayload;
    const r = result as TrailRenderResult;
    const updated = rawDb
      .prepare("UPDATE trails SET audio_hash = ? WHERE id = ?")
      .run(r.artifactHash, p.trailId);
    if (updated.changes === 0) throw new Error(`trail ${p.trailId} not found`);
  },
});

export interface RealmLabelPayload {
  realmKey: string;
  /** Evidence the device names from: member topic labels + their books + sample prose. */
  topics: Array<{ label: string; books: string[] }>;
  samples: string[];
  /** Names of neighboring realms — the new name must be clearly distinct (v2). */
  siblings?: string[];
  /** Names this realm must NOT resemble (collision re-name, v2). */
  avoid?: string[];
}

export interface RealmLabelResult {
  label: string;
  blurb: string;
}

// Journeys' categorical layer (realms): the clusters are deterministic
// embedding geometry; the device's on-device model only AUTHORS the name —
// like a bookstore section sign. Rule 2 again: structure from the substrate,
// words from the model, structurally validated before landing.
registerKind({
  kind: "realm-label",
  project: "compendus",
  version: 2, // v2: sibling-aware naming (payload carries siblings/avoid)
  validate: (payload, result) => {
    const p = payload as RealmLabelPayload | null;
    const r = result as RealmLabelResult | null;
    if (!p?.realmKey || !/^[0-9a-f]{64}$/.test(p.realmKey)) {
      return { ok: false, error: "payload must carry a realmKey hash" };
    }
    if (!r || typeof r.label !== "string" || typeof r.blurb !== "string") {
      return { ok: false, error: "result must carry label + blurb" };
    }
    const label = r.label.trim();
    const blurb = r.blurb.trim();
    if (label.length < 3 || label.length > 40 || /\n/.test(label)) {
      return { ok: false, error: `label length ${label.length} outside 3..40 / multiline` };
    }
    if (label.split(/\s+/).length > 5) {
      return { ok: false, error: "label must be at most 5 words (a section sign, not a sentence)" };
    }
    if (blurb.length < 10 || blurb.length > 160) {
      return { ok: false, error: `blurb length ${blurb.length} outside 10..160` };
    }
    return { ok: true };
  },
  apply: (payload, result, ctx) => {
    const p = payload as RealmLabelPayload;
    const r = result as RealmLabelResult;
    rawDb
      .prepare(
        `INSERT INTO realm_labels (realm_key, label, blurb, model_id, created_at)
         VALUES (?, ?, ?, ?, unixepoch())
         ON CONFLICT(realm_key) DO UPDATE SET label=excluded.label, blurb=excluded.blurb, model_id=excluded.model_id`,
      )
      .run(p.realmKey, r.label.trim(), r.blurb.trim(), ctx.modelId);
  },
});

export interface TopicLabelPayload {
  topicKey: string;
  books: string[];
  samples: string[];
  /** Names of nearby roads (same books) — the new name must be clearly distinct (v2). */
  siblings?: string[];
  /** Names this road must NOT resemble (collision re-name, v2). */
  avoid?: string[];
}

// Road names: a single theme gets a short title from the device's model —
// "The Duel at Weehawken", not "Inside Alexander Hamilton ×8". Same contract
// as realm-label: geometry decides the road exists; the model only names it.
registerKind({
  kind: "topic-label",
  project: "compendus",
  version: 2, // v2: sibling-aware naming (payload carries siblings/avoid)
  validate: (payload, result) => {
    const p = payload as TopicLabelPayload | null;
    const r = result as RealmLabelResult | null;
    if (!p?.topicKey || !/^[0-9a-f]{64}$/.test(p.topicKey)) {
      return { ok: false, error: "payload must carry a topicKey hash" };
    }
    if (!Array.isArray(p.samples) || p.samples.length === 0) {
      return { ok: false, error: "payload must carry sample passages" };
    }
    if (!r || typeof r.label !== "string" || typeof r.blurb !== "string") {
      return { ok: false, error: "result must carry label + blurb" };
    }
    const label = r.label.trim();
    if (label.length < 3 || label.length > 48 || /\n/.test(label)) {
      return { ok: false, error: `label length ${label.length} outside 3..48 / multiline` };
    }
    if (label.split(/\s+/).length > 6) {
      return { ok: false, error: "label must be at most 6 words" };
    }
    if (r.blurb.trim().length < 10 || r.blurb.trim().length > 160) {
      return { ok: false, error: "blurb outside 10..160" };
    }
    return { ok: true };
  },
  apply: (payload, result, ctx) => {
    const p = payload as TopicLabelPayload;
    const r = result as RealmLabelResult;
    rawDb
      .prepare(
        `INSERT INTO topic_labels (topic_key, label, blurb, model_id, created_at)
         VALUES (?, ?, ?, ?, unixepoch())
         ON CONFLICT(topic_key) DO UPDATE SET label=excluded.label, blurb=excluded.blurb, model_id=excluded.model_id`,
      )
      .run(p.topicKey, r.label.trim(), r.blurb.trim(), ctx.modelId);
  },
});

// ---------------------------------------------------------------------------
// classify-book (Reckoning prerequisite): a one-time fleet sweep that labels
// each book fiction|nonfiction so mining can run over the nonfiction subset
// only. The box samples a few prose passages; an idle Mac's local LLM decides.
// Rule 2 holds — the model only LABELS an existing book; the verdict is
// structurally validated and stored in cs_book_class (mine.ts's allowlist).
// ---------------------------------------------------------------------------
export interface ClassifyBookPayload {
  bookId: string;
  title: string;
  author: string;
  sample: string;
}
export interface ClassifyBookResult {
  category: "fiction" | "nonfiction";
  confidence: number;
  reason: string;
}
const BOOK_CATEGORIES = new Set(["fiction", "nonfiction"]);

registerKind({
  kind: "classify-book",
  project: "compendus",
  version: 1,
  validate: (payload, result) => {
    const p = payload as ClassifyBookPayload | null;
    const r = result as ClassifyBookResult | null;
    if (!p?.bookId) return { ok: false, error: "payload must carry bookId" };
    if (!r || !BOOK_CATEGORIES.has(r.category)) {
      return { ok: false, error: "category must be fiction|nonfiction" };
    }
    if (typeof r.confidence !== "number" || r.confidence < 0 || r.confidence > 1) {
      return { ok: false, error: "confidence must be a number in 0..1" };
    }
    return { ok: true };
  },
  apply: (payload, result, ctx) => {
    const p = payload as ClassifyBookPayload;
    const r = result as ClassifyBookResult;
    ensureBookClassTable();
    rawDb
      .prepare(
        `INSERT INTO cs_book_class (book_id, category, confidence, reason, model_id, created_at)
         VALUES (?, ?, ?, ?, ?, unixepoch())
         ON CONFLICT(book_id) DO UPDATE SET
           category=excluded.category, confidence=excluded.confidence,
           reason=excluded.reason, model_id=excluded.model_id, created_at=excluded.created_at`,
      )
      .run(p.bookId, r.category, r.confidence, (r.reason ?? "").slice(0, 500), ctx.modelId);
  },
});

// ---------------------------------------------------------------------------
// name-topic (Journeys quality): a fleet device names a nonfiction journey topic
// from its distinctive concepts + a few sample passages — a human "shelf card"
// ("The Founding of the Treasury") instead of the regex concept-join label. The
// authored name lands in cs_topics.fleet_label, preferred over display_label.
// Rule 2: structure (the topic cluster) from the substrate; only the NAME from
// the model, structurally bounded here.
// ---------------------------------------------------------------------------
export interface NameTopicPayload {
  topicId: string;
  concepts: string[];
  samples: string[];
}
export interface NameTopicResult {
  label: string;
  blurb: string;
}
registerKind({
  kind: "name-topic",
  project: "compendus",
  version: 1,
  validate: (payload, result) => {
    const p = payload as NameTopicPayload | null;
    const r = result as NameTopicResult | null;
    if (!p?.topicId) return { ok: false, error: "payload must carry topicId" };
    if (!r || typeof r.label !== "string") return { ok: false, error: "result must carry label" };
    const l = r.label.trim();
    if (l.length < 3 || l.length > 60 || /\n/.test(l)) {
      return { ok: false, error: `label length ${l.length} outside 3..60 / multiline` };
    }
    if (l.split(/\s+/).length > 7) {
      return { ok: false, error: "label must be at most 7 words (a shelf card, not a sentence)" };
    }
    return { ok: true };
  },
  apply: (payload, result, ctx) => {
    const p = payload as NameTopicPayload;
    const r = result as NameTopicResult;
    ensureJourneyColumns();
    rawDb
      .prepare(
        "UPDATE cs_topics SET fleet_label = ?, fleet_blurb = ?, fleet_model = ? WHERE id = ?",
      )
      .run(r.label.trim(), (r.blurb ?? "").trim().slice(0, 200), ctx.modelId, p.topicId);
  },
});

registerKind({
  kind: "echo",
  project: "fabric-test",
  validate: (payload, result) => {
    const p = payload as { text?: unknown } | null;
    const r = result as { echoed?: unknown } | null;
    if (typeof p?.text !== "string") return { ok: false, error: "payload.text must be a string" };
    if (typeof r?.echoed !== "string")
      return { ok: false, error: "result.echoed must be a string" };
    if (r.echoed !== p.text.toUpperCase()) {
      return { ok: false, error: "result.echoed must be payload.text uppercased" };
    }
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// judge-tension (Reckoning prove-or-kill): the box mines candidate cross-book
// passage pairs; an idle Mac with a local LLM (Ollama) adjudicates each into
// agree/contradict/qualify/neutral, with a one-line tension, a stance question,
// and VERBATIM spans quoted from each passage (grounding — the model may only
// point at the owner's text, never assert a free-standing fact). Validation
// rejects any result whose spans aren't real substrings of the passages.
// ---------------------------------------------------------------------------
export interface JudgeTensionPayload {
  pairId: string;
  subject: string; // the shared concepts, for context
  textA: string;
  textB: string;
}
export interface JudgeTensionResult {
  verdict: "agree" | "contradict" | "qualify" | "neutral";
  tension: string;
  stanceQuestion: string;
  spanA: string;
  spanB: string;
}
const TENSION_VERDICTS = new Set(["agree", "contradict", "qualify", "neutral"]);
/** Loose substring check tolerant of whitespace/quote normalization. */
function spanGrounded(span: string, text: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[‘’“”]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  const s = norm(span);
  return s.length >= 8 && norm(text).includes(s);
}

registerKind({
  kind: "judge-tension",
  project: "compendus",
  validate: (payload, result) => {
    const p = payload as JudgeTensionPayload | null;
    const r = result as JudgeTensionResult | null;
    if (!p?.pairId || typeof p.textA !== "string" || typeof p.textB !== "string") {
      return { ok: false, error: "payload must carry pairId + textA + textB" };
    }
    if (!r || !TENSION_VERDICTS.has(r.verdict)) {
      return { ok: false, error: `verdict must be one of ${[...TENSION_VERDICTS].join("/")}` };
    }
    // Grounding: a real relationship must quote real spans from both passages.
    if (r.verdict === "contradict" || r.verdict === "qualify" || r.verdict === "agree") {
      if (!spanGrounded(r.spanA ?? "", p.textA)) {
        return { ok: false, error: "spanA is not a verbatim quote from passage A" };
      }
      if (!spanGrounded(r.spanB ?? "", p.textB)) {
        return { ok: false, error: "spanB is not a verbatim quote from passage B" };
      }
      if ((r.tension ?? "").trim().length < 8) {
        return { ok: false, error: "tension statement too short" };
      }
    }
    return { ok: true };
  },
  apply: (payload, result) => {
    const p = payload as JudgeTensionPayload;
    const r = result as JudgeTensionResult;
    rawDb
      .prepare(
        `UPDATE cs_tension_candidates
         SET status = 'judged', verdict = ?, tension = ?, stance_question = ?, span_a = ?, span_b = ?, judged_at = unixepoch()
         WHERE id = ?`,
      )
      .run(
        r.verdict,
        r.tension ?? "",
        r.stanceQuestion ?? "",
        r.spanA ?? "",
        r.spanB ?? "",
        p.pairId,
      );
  },
});
