/**
 * Read-side queries for the Living Library knowledge graph: the entity browser,
 * entity detail (cross-book mentions + relationships), and the wander engine.
 *
 * The wander engine is the heart of the experience: given an entity it returns a
 * handful of *grounded* next steps — relationship edges, co-occurring entities,
 * and semantic neighbors — each carrying a human-readable reason ("why this
 * connection") and a source passage. Nothing is surfaced without a passage.
 */
import { and, desc, eq, like } from "drizzle-orm";
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

  const conds = [];
  if (opts.type) conds.push(eq(entities.type, opts.type as EntityType));
  if (opts.q) conds.push(like(entities.normalizedName, `%${opts.q.toLowerCase()}%`));

  const rows = db
    .select()
    .from(entities)
    .where(conds.length ? and(...conds) : undefined)
    // Rank by cross-library breadth first — entities spanning many books are the
    // most rewarding to wander into.
    .orderBy(desc(entities.bookCount), desc(entities.mentionCount))
    .limit(limit)
    .offset(offset)
    .all();

  return rows.map(toSummary);
}

// --- entity detail -------------------------------------------------------------

export interface MentionView {
  passageId: string;
  bookId: string;
  bookTitle: string;
  chapterTitle: string | null;
  spineIndex: number | null;
  page: number | null;
  position: number | null; // normalized 0-1 reader position (best-effort)
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

/** Approx book length from stored passages — avoids re-parsing to get a position. */
function bookMaxChar(bookId: string): number {
  const row = rawDb
    .prepare("SELECT MAX(char_end) AS m FROM passages WHERE book_id = ?")
    .get(bookId) as { m: number | null };
  return row?.m && row.m > 0 ? row.m : 0;
}

export function getEntityDetail(id: string, mentionLimit = 50): EntityDetail | null {
  const entity = db.select().from(entities).where(eq(entities.id, id)).get();
  if (!entity) return null;

  const mentionRows = rawDb
    .prepare(
      `SELECT m.passage_id AS passageId, m.book_id AS bookId, m.surface_text AS surfaceText,
              p.chapter_title AS chapterTitle, p.spine_index AS spineIndex, p.page AS page,
              p.char_start AS charStart, p.text AS text, b.title AS bookTitle
       FROM entity_mentions m
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

  const maxCharByBook = new Map<string, number>();
  const mentions: MentionView[] = mentionRows.map((r) => {
    if (!maxCharByBook.has(r.bookId)) maxCharByBook.set(r.bookId, bookMaxChar(r.bookId));
    const total = maxCharByBook.get(r.bookId)!;
    return {
      passageId: r.passageId,
      bookId: r.bookId,
      bookTitle: r.bookTitle,
      chapterTitle: r.chapterTitle,
      spineIndex: r.spineIndex,
      page: r.page,
      position: r.charStart != null && total > 0 ? r.charStart / total : null,
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
  kind: "relationship" | "co_occurrence" | "semantic";
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
    rawDb.prepare("SELECT COUNT(DISTINCT passage_id) AS n FROM entity_mentions").get() as {
      n: number;
    }
  ).n;
  const cx = (
    rawDb
      .prepare("SELECT COUNT(DISTINCT passage_id) AS c FROM entity_mentions WHERE entity_id = ?")
      .get(entityId) as { c: number }
  ).c;
  const coRows = rawDb
    .prepare(
      `SELECT em2.entity_id AS otherId, e.canonical_name AS otherName, e.type AS otherType,
              e.book_count AS bookCount,
              COUNT(DISTINCT em2.passage_id) AS shared, MIN(em2.passage_id) AS pid,
              (SELECT COUNT(DISTINCT passage_id) FROM entity_mentions WHERE entity_id = em2.entity_id) AS cy
       FROM entity_mentions em1
       JOIN entity_mentions em2 ON em2.passage_id = em1.passage_id AND em2.entity_id != em1.entity_id
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
        `SELECT p.embedding AS embedding FROM entity_mentions m
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
            .prepare("SELECT passage_id AS pid FROM entity_mentions WHERE entity_id = ?")
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
             FROM entity_mentions m JOIN entities e ON e.id = m.entity_id
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
