/**
 * Read-side queries for the Living Library knowledge graph: the entity browser
 * and entity detail (cross-book mentions + relationships). Wandering itself is
 * passage-centric and lives in wander2.ts over the semantic substrate.
 */
import { eq } from "drizzle-orm";
import { db, rawDb, entities } from "../db";
import type { EntityType } from "../db/schema";

function snippet(text: string, max = 240): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function humanizeRelType(type: string): string {
  return type.replace(/_/g, " ");
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
