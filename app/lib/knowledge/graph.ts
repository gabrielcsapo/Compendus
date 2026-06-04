/**
 * Read-side queries for the Living Library knowledge graph: the entity browser,
 * entity detail (cross-book mentions + relationships), and the wander engine.
 *
 * The wander engine is the heart of the experience: given an entity it returns a
 * handful of *grounded* next steps — relationship edges, co-occurring entities,
 * and semantic neighbors — each carrying a human-readable reason ("why this
 * connection") and a source passage. Nothing is surfaced without a passage.
 */
import { eq } from "drizzle-orm";
import { db, rawDb, entities, passages } from "../db";
import { bufferToVector, cosine } from "./embeddings";
import type { EntityType } from "../db/schema";

function snippet(text: string, max = 240): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function humanizeRelType(type: string): string {
  return type.replace(/_/g, " ");
}

/**
 * Normalized pointwise mutual information for a co-occurrence over passages.
 * Returns a value in [-1, 1]: >0 means the two entities co-occur more than
 * chance, 0 is independence, <0 is anti-association. Guards the degenerate
 * cases (zero counts → 0; perfect co-occurrence where -log(p) is 0 → 1).
 */
function npmi(cooc: number, cx: number, cy: number, n: number): number {
  if (cooc <= 0 || cx <= 0 || cy <= 0 || n <= 0) return 0;
  const pxy = cooc / n;
  const pmi = Math.log(pxy / ((cx / n) * (cy / n)));
  const denom = -Math.log(pxy);
  return denom === 0 ? 1 : pmi / denom;
}

function parseAliases(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

// --- entity browser ------------------------------------------------------------

export interface EntitySummary {
  id: string;
  type: EntityType;
  canonicalName: string;
  summary: string | null;
  aliases: string[];
  mentionCount: number;
  bookCount: number;
  dateText: string | null;
}

function toSummary(e: typeof entities.$inferSelect): EntitySummary {
  return {
    id: e.id,
    type: e.type,
    canonicalName: e.canonicalName,
    summary: e.summary,
    aliases: parseAliases(e.aliases),
    mentionCount: e.mentionCount,
    bookCount: e.bookCount,
    dateText: e.dateText,
  };
}

export function listEntities(opts: {
  type?: string;
  q?: string;
  limit?: number;
  offset?: number;
}): EntitySummary[] {
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;

  // Only surface canonical, non-excluded entities (identity lives in the mapping):
  // a canonical entity is one whose mapping points at itself and isn't hidden.
  // `mention_count > 0` guards against any ungrounded entity (no resolved mentions).
  const where: string[] = ["c.canonical_id = e.id", "c.excluded = 0", "e.mention_count > 0"];
  const params: unknown[] = [];
  if (opts.type) {
    where.push("e.type = ?");
    params.push(opts.type);
  }
  if (opts.q) {
    where.push("e.normalized_name LIKE ?");
    params.push(`%${opts.q.toLowerCase()}%`);
  }
  const rows = rawDb
    .prepare(
      `SELECT e.id AS id, e.type AS type, e.canonical_name AS canonicalName,
              e.summary AS summary, e.aliases AS aliases,
              e.mention_count AS mentionCount, e.book_count AS bookCount,
              e.date_text AS dateText
       FROM entities e
       JOIN entity_canonical c ON c.entity_id = e.id
       WHERE ${where.join(" AND ")}
       ORDER BY e.book_count DESC, e.mention_count DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Array<{
    id: string;
    type: EntityType;
    canonicalName: string;
    summary: string | null;
    aliases: string | null;
    mentionCount: number;
    bookCount: number;
    dateText: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    canonicalName: r.canonicalName,
    summary: r.summary,
    aliases: parseAliases(r.aliases),
    mentionCount: r.mentionCount,
    bookCount: r.bookCount,
    dateText: r.dateText,
  }));
}

// --- entity detail -------------------------------------------------------------

export interface MentionView {
  passageId: string;
  bookId: string;
  bookTitle: string;
  chapterTitle: string | null;
  spineIndex: number | null;
  page: number | null;
  position: number | null; // normalized 0-1 reader position (best-effort, whole book)
  // Progress *within* the passage's chapter (0-1). Anchored at the spine
  // boundary the reader also knows, this survives the char-space mismatch
  // between the knowledge pipeline's clean text and the reader's rendered text
  // far better than `position` does. Deep-links should prefer spineIndex + this.
  chapterProgress: number | null;
  surfaceText: string;
  snippet: string;
}

export interface RelationshipView {
  type: string;
  label: string;
  direction: "out" | "in";
  reason: string | null;
  otherEntityId: string;
  otherEntityName: string;
  otherEntityType: string;
  evidencePassageId: string | null;
}

export interface EntityDetail extends EntitySummary {
  mentions: MentionView[];
  relationships: RelationshipView[];
}

/**
 * Approx book length from stored passages — avoids re-parsing to get a position.
 * Batched across books so an entity spanning many books costs one query, not one per book.
 */
function bookMaxChars(bookIds: string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (bookIds.length === 0) return out;
  const placeholders = bookIds.map(() => "?").join(", ");
  const rows = rawDb
    .prepare(
      `SELECT book_id AS b, MAX(char_end) AS m FROM passages WHERE book_id IN (${placeholders}) GROUP BY book_id`,
    )
    .all(...bookIds) as Array<{ b: string; m: number | null }>;
  for (const r of rows) out.set(r.b, r.m && r.m > 0 ? r.m : 0);
  return out;
}

/**
 * Per-spine [lo, hi] clean-text char range per book, so a passage's offset can
 * be expressed as progress *within its chapter*. Anchoring at the spine boundary
 * (the one structure the reader shares with the pipeline) is what makes the
 * deep-link land on the right page despite the two text spaces differing.
 * Batched across books — one query for the whole set.
 */
function bookSpineRanges(bookIds: string[]): Map<string, Map<number, { lo: number; hi: number }>> {
  const out = new Map<string, Map<number, { lo: number; hi: number }>>();
  if (bookIds.length === 0) return out;
  const placeholders = bookIds.map(() => "?").join(", ");
  const rows = rawDb
    .prepare(
      `SELECT book_id AS b, spine_index AS s, MIN(char_start) AS lo, MAX(char_end) AS hi
       FROM passages WHERE book_id IN (${placeholders}) AND spine_index IS NOT NULL
       GROUP BY book_id, spine_index`,
    )
    .all(...bookIds) as Array<{ b: string; s: number; lo: number; hi: number }>;
  for (const r of rows) {
    let inner = out.get(r.b);
    if (!inner) {
      inner = new Map();
      out.set(r.b, inner);
    }
    inner.set(r.s, { lo: r.lo, hi: r.hi });
  }
  return out;
}

export function getEntityDetail(id: string, mentionLimit = 50): EntityDetail | null {
  const entity = db.select().from(entities).where(eq(entities.id, id)).get();
  if (!entity) return null;

  const mentionRows = rawDb
    .prepare(
      `SELECT m.passage_id AS passageId, m.book_id AS bookId, m.surface_text AS surfaceText,
              p.chapter_title AS chapterTitle, p.spine_index AS spineIndex, p.page AS page,
              p.char_start AS charStart, p.text AS text, b.title AS bookTitle
       FROM canonical_mentions m
       JOIN passages p ON p.id = m.passage_id
       JOIN books b ON b.id = m.book_id
       WHERE m.entity_id = ?
       ORDER BY m.book_id, p.ordinal
       LIMIT ?`,
    )
    .all(id, mentionLimit) as Array<{
    passageId: string;
    bookId: string;
    surfaceText: string;
    chapterTitle: string | null;
    spineIndex: number | null;
    page: number | null;
    charStart: number | null;
    text: string;
    bookTitle: string;
  }>;

  const distinctBookIds = [...new Set(mentionRows.map((r) => r.bookId))];
  const maxCharByBook = bookMaxChars(distinctBookIds);
  const spineRangesByBook = bookSpineRanges(distinctBookIds);
  const mentions: MentionView[] = mentionRows.map((r) => {
    const total = maxCharByBook.get(r.bookId) ?? 0;
    const range =
      r.spineIndex != null ? spineRangesByBook.get(r.bookId)?.get(r.spineIndex) : undefined;
    const chapterProgress =
      range && r.charStart != null && range.hi > range.lo
        ? Math.max(0, Math.min(1, (r.charStart - range.lo) / (range.hi - range.lo)))
        : null;
    return {
      passageId: r.passageId,
      bookId: r.bookId,
      bookTitle: r.bookTitle,
      chapterTitle: r.chapterTitle,
      spineIndex: r.spineIndex,
      page: r.page,
      position: r.charStart != null && total > 0 ? r.charStart / total : null,
      chapterProgress,
      surfaceText: r.surfaceText,
      snippet: snippet(r.text),
    };
  });

  const relRows = rawDb
    .prepare(
      `SELECT r.type AS type, r.description AS reason, r.evidence_passage_id AS pid,
              CASE WHEN r.source_entity_id = ? THEN 'out' ELSE 'in' END AS dir,
              CASE WHEN r.source_entity_id = ? THEN r.target_entity_id ELSE r.source_entity_id END AS otherId,
              e.canonical_name AS otherName, e.type AS otherType
       FROM entity_relationships r
       JOIN entities e ON e.id = (CASE WHEN r.source_entity_id = ? THEN r.target_entity_id ELSE r.source_entity_id END)
       WHERE r.source_entity_id = ? OR r.target_entity_id = ?
       ORDER BY e.book_count DESC
       LIMIT 60`,
    )
    .all(id, id, id, id, id) as Array<{
    type: string;
    reason: string | null;
    pid: string | null;
    dir: "out" | "in";
    otherId: string;
    otherName: string;
    otherType: string;
  }>;

  const relationships: RelationshipView[] = relRows.map((r) => ({
    type: r.type,
    label: humanizeRelType(r.type),
    direction: r.dir,
    reason: r.reason,
    otherEntityId: r.otherId,
    otherEntityName: r.otherName,
    otherEntityType: r.otherType,
    evidencePassageId: r.pid,
  }));

  return { ...toSummary(entity), mentions, relationships };
}

// --- semantic neighbor index (cached) ------------------------------------------

interface PassageVec {
  id: string;
  bookId: string;
  vec: Float32Array;
}
let pvecCache: { built: number; count: number; items: PassageVec[] } | null = null;
const PVEC_TTL_MS = 60_000;

function passageVectors(): PassageVec[] {
  const count = (
    rawDb.prepare("SELECT COUNT(*) AS c FROM passages WHERE embedding IS NOT NULL").get() as {
      c: number;
    }
  ).c;
  if (pvecCache && pvecCache.count === count && Date.now() - pvecCache.built < PVEC_TTL_MS) {
    return pvecCache.items;
  }
  const rows = db
    .select({ id: passages.id, bookId: passages.bookId, embedding: passages.embedding })
    .from(passages)
    .all();
  const items: PassageVec[] = [];
  for (const r of rows) {
    if (r.embedding)
      items.push({ id: r.id, bookId: r.bookId, vec: bufferToVector(r.embedding as Buffer) });
  }
  pvecCache = { built: Date.now(), count, items };
  return items;
}

// --- wander engine -------------------------------------------------------------

export interface WanderStep {
  kind: "relationship" | "co_occurrence" | "semantic" | "same_as_candidate";
  reason: string;
  entityId: string | null;
  entityName: string | null;
  entityType: string | null;
  passageId: string | null;
  bookId: string | null;
  bookTitle: string | null;
  snippet: string | null;
}

export function wander(entityId: string, limit = 8): WanderStep[] {
  const entity = db.select().from(entities).where(eq(entities.id, entityId)).get();
  if (!entity) return [];

  const steps: WanderStep[] = [];
  const usedEntities = new Set<string>([entityId]);

  // 0. Probable-same-entity candidates — "is this the same person/place?" These
  //    are heuristic proposals, NOT asserted identity; surfaced first because a
  //    likely duplicate is the most relevant neighbor (and the cue to confirm/merge).
  const cands = rawDb
    .prepare(
      `SELECT CASE WHEN entity_a = ? THEN entity_b ELSE entity_a END AS otherId,
              method AS method, score AS score
       FROM entity_candidate_links
       WHERE status = 'open' AND (entity_a = ? OR entity_b = ?)
       ORDER BY score DESC NULLS LAST LIMIT 5`,
    )
    .all(entityId, entityId, entityId) as Array<{
    otherId: string;
    method: string;
    score: number | null;
  }>;
  for (const r of cands) {
    if (usedEntities.has(r.otherId)) continue;
    const other = db.select().from(entities).where(eq(entities.id, r.otherId)).get();
    if (!other) continue;
    usedEntities.add(r.otherId);
    steps.push({
      kind: "same_as_candidate",
      reason: `Possibly the same ${other.type} as ${entity.canonicalName}`,
      entityId: other.id,
      entityName: other.canonicalName,
      entityType: other.type,
      passageId: null,
      bookId: null,
      bookTitle: null,
      snippet: null,
    });
  }

  const passageInfo = (pid: string | null) => {
    if (!pid) return { snippet: null, bookId: null, bookTitle: null };
    const row = rawDb
      .prepare(
        `SELECT p.text AS text, p.book_id AS bookId, b.title AS bookTitle
         FROM passages p JOIN books b ON b.id = p.book_id WHERE p.id = ?`,
      )
      .get(pid) as { text: string; bookId: string; bookTitle: string } | undefined;
    return row
      ? { snippet: snippet(row.text), bookId: row.bookId, bookTitle: row.bookTitle }
      : { snippet: null, bookId: null, bookTitle: null };
  };

  // 1. Relationship edges — the strongest, most explicit connections.
  const rels = rawDb
    .prepare(
      `SELECT r.type AS type, r.description AS reason, r.evidence_passage_id AS pid,
              CASE WHEN r.source_entity_id = ? THEN r.target_entity_id ELSE r.source_entity_id END AS otherId,
              e.canonical_name AS otherName, e.type AS otherType
       FROM entity_relationships r
       JOIN entities e ON e.id = (CASE WHEN r.source_entity_id = ? THEN r.target_entity_id ELSE r.source_entity_id END)
       WHERE r.source_entity_id = ? OR r.target_entity_id = ?
       ORDER BY e.book_count DESC LIMIT 40`,
    )
    .all(entityId, entityId, entityId, entityId) as Array<{
    type: string;
    reason: string | null;
    pid: string | null;
    otherId: string;
    otherName: string;
    otherType: string;
  }>;
  for (const r of rels) {
    if (usedEntities.has(r.otherId)) continue;
    usedEntities.add(r.otherId);
    const info = passageInfo(r.pid);
    steps.push({
      kind: "relationship",
      reason: r.reason ?? `${entity.canonicalName} — ${humanizeRelType(r.type)} — ${r.otherName}`,
      entityId: r.otherId,
      entityName: r.otherName,
      entityType: r.otherType,
      passageId: r.pid,
      ...info,
    });
  }

  // 2. Co-occurrence — entities that show up alongside this one, ranked by NPMI
  //    (normalized pointwise mutual information over passages) rather than raw
  //    shared count. Raw counts let an entity that appears *everywhere* dominate
  //    every other entity's neighbors; NPMI rewards a genuinely distinctive
  //    pairing instead. NPMI ∈ [-1, 1]; we keep only positive associations.
  const N = (
    rawDb.prepare("SELECT COUNT(DISTINCT passage_id) AS n FROM canonical_mentions").get() as {
      n: number;
    }
  ).n;
  const cx = (
    rawDb
      .prepare("SELECT COUNT(DISTINCT passage_id) AS c FROM canonical_mentions WHERE entity_id = ?")
      .get(entityId) as { c: number }
  ).c;
  const coRows = rawDb
    .prepare(
      `SELECT em2.entity_id AS otherId, e.canonical_name AS otherName, e.type AS otherType,
              e.book_count AS bookCount,
              COUNT(DISTINCT em2.passage_id) AS shared, MIN(em2.passage_id) AS pid,
              (SELECT COUNT(DISTINCT passage_id) FROM canonical_mentions WHERE entity_id = em2.entity_id) AS cy
       FROM canonical_mentions em1
       JOIN canonical_mentions em2 ON em2.passage_id = em1.passage_id AND em2.entity_id != em1.entity_id
       JOIN entities e ON e.id = em2.entity_id
       WHERE em1.entity_id = ?
       GROUP BY em2.entity_id`,
    )
    .all(entityId) as Array<{
    otherId: string;
    otherName: string;
    otherType: string;
    bookCount: number;
    shared: number;
    pid: string | null;
    cy: number;
  }>;

  const co = coRows
    .map((r) => ({ ...r, npmi: npmi(r.shared, cx, r.cy, N) }))
    .filter((r) => r.npmi > 0)
    .sort((a, b) => b.npmi - a.npmi || b.bookCount - a.bookCount)
    .slice(0, 20);
  for (const r of co) {
    if (usedEntities.has(r.otherId)) continue;
    usedEntities.add(r.otherId);
    const info = passageInfo(r.pid);
    steps.push({
      kind: "co_occurrence",
      reason: info.bookTitle
        ? `Mentioned alongside ${entity.canonicalName} in “${info.bookTitle}”`
        : `Often mentioned alongside ${entity.canonicalName}`,
      entityId: r.otherId,
      entityName: r.otherName,
      entityType: r.otherType,
      passageId: r.pid,
      ...info,
    });
  }

  // 3. Semantic neighbors — passages that *feel* related, even without an edge.
  if (steps.length < limit) {
    const myPassages = rawDb
      .prepare(
        `SELECT p.embedding AS embedding FROM canonical_mentions m
         JOIN passages p ON p.id = m.passage_id
         WHERE m.entity_id = ? AND p.embedding IS NOT NULL LIMIT 12`,
      )
      .all(entityId) as Array<{ embedding: Buffer }>;
    if (myPassages.length > 0) {
      // Centroid of this entity's passages.
      const dim = bufferToVector(myPassages[0].embedding).length;
      const centroid = new Float32Array(dim);
      for (const p of myPassages) {
        const v = bufferToVector(p.embedding);
        for (let i = 0; i < dim; i++) centroid[i] += v[i];
      }
      for (let i = 0; i < dim; i++) centroid[i] /= myPassages.length;

      const mentionPassages = new Set(
        (
          rawDb
            .prepare("SELECT passage_id AS pid FROM canonical_mentions WHERE entity_id = ?")
            .all(entityId) as Array<{ pid: string }>
        ).map((r) => r.pid),
      );

      const scored = passageVectors()
        .filter((pv) => !mentionPassages.has(pv.id))
        .map((pv) => ({ pv, score: cosine(centroid, pv.vec) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 12);

      for (const { pv } of scored) {
        if (steps.length >= limit) break;
        // Represent the neighbor passage by its most cross-library-salient entity.
        const top = rawDb
          .prepare(
            `SELECT e.id AS id, e.canonical_name AS name, e.type AS type
             FROM canonical_mentions m JOIN entities e ON e.id = m.entity_id
             WHERE m.passage_id = ? ORDER BY e.book_count DESC, e.mention_count DESC LIMIT 1`,
          )
          .get(pv.id) as { id: string; name: string; type: string } | undefined;
        if (top && usedEntities.has(top.id)) continue;
        if (top) usedEntities.add(top.id);
        const info = passageInfo(pv.id);
        steps.push({
          kind: "semantic",
          reason: "A related idea elsewhere in your library",
          entityId: top?.id ?? null,
          entityName: top?.name ?? null,
          entityType: top?.type ?? null,
          passageId: pv.id,
          ...info,
        });
      }
    }
  }

  return steps.slice(0, limit);
}
