/**
 * Cross-book entity resolution — the make-or-break step that turns per-book
 * annotations into a *connected* library ("Caesar" in book A === "Julius Caesar"
 * in book B).
 *
 * Strategy, deliberately conservative (a wrong merge corrupts the graph worse
 * than a missed one):
 *   1. Exact normalized-name + type match → reuse the canonical entity.
 *   2. High-threshold embedding match within the same type → reuse + record alias.
 *   3. Otherwise create a new canonical entity.
 */
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, rawDb, entities, type Entity } from "../db";
import { type EntityType } from "../db/schema";
import { embed, vectorToBuffer, bufferToVector, cosine } from "./embeddings";
import { matchPersonName } from "./person-name";
import { isNoiseSpan } from "./gliner-extract";

/** Only merge on embeddings when very confident — avoids conflating distinct entities. */
const FUZZY_THRESHOLD = 0.9;

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ResolveInput {
  name: string;
  type: EntityType;
  dateText?: string | null;
}

/**
 * Resolves extracted entities to canonical ids, caching same-type candidates in
 * memory for the duration of one book's analysis. Newly created entities are
 * added to the cache so later mentions in the same run resolve to them.
 */
export class EntityResolver {
  private cacheByType = new Map<string, Entity[]>();

  private candidates(type: string): Entity[] {
    let list = this.cacheByType.get(type);
    if (!list) {
      list = db.select().from(entities).where(eq(entities.type, type)).all();
      this.cacheByType.set(type, list);
    }
    return list;
  }

  async resolve(input: ResolveInput): Promise<string> {
    const norm = normalizeName(input.name);
    if (norm.length === 0) return this.create(input, norm, null);

    const list = this.candidates(input.type);

    // 1. Exact normalized match.
    const exact = list.find((e) => e.normalizedName === norm);
    if (exact) {
      this.addAlias(exact, input.name);
      this.maybePromoteCanonical(exact, input.name);
      return exact.id;
    }

    // 1b. Person-name aware match: collapse title/surname variants of one person
    //     (e.g. "Mr. Tanimoto" / "Tanimoto"), abstaining on any ambiguity.
    if (input.type === "person") {
      const match = matchPersonName(norm, list);
      if (match) {
        this.addAlias(match, input.name);
        this.maybePromoteCanonical(match, input.name);
        return match.id;
      }
    }

    // 2. Conservative embedding match.
    const vec = await embed(norm);
    let best: { e: Entity; score: number } | null = null;
    for (const e of list) {
      if (!e.embedding) continue;
      const score = cosine(vec, bufferToVector(e.embedding as Buffer));
      if (!best || score > best.score) best = { e, score };
    }
    if (best && best.score >= FUZZY_THRESHOLD) {
      this.addAlias(best.e, input.name);
      return best.e.id;
    }

    // 3. New canonical entity.
    return this.create(input, norm, vec);
  }

  private create(input: ResolveInput, norm: string, vec: Float32Array | null): string {
    const id = randomUUID();
    const now = new Date();
    const row: typeof entities.$inferInsert = {
      id,
      type: input.type,
      canonicalName: input.name.trim(),
      normalizedName: norm,
      aliases: JSON.stringify([input.name.trim()]),
      embedding: vec ? vectorToBuffer(vec) : null,
      dateText: input.dateText ?? null,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(entities).values(row).run();
    this.candidates(input.type).push(row as unknown as Entity);
    return id;
  }

  /** When a longer surface form of a matched entity appears, prefer it for
   *  display (e.g. promote "Tanimoto" → "Reverend Mr. Kiyoshi Tanimoto"). The
   *  normalizedName key is left unchanged so existing matches stay stable. */
  private maybePromoteCanonical(e: Entity, name: string): void {
    const trimmed = name.trim();
    const tokenCount = (s: string) => s.trim().split(/\s+/).length;
    if (tokenCount(trimmed) > tokenCount(e.canonicalName)) {
      db.update(entities)
        .set({ canonicalName: trimmed, updatedAt: new Date() })
        .where(eq(entities.id, e.id))
        .run();
      e.canonicalName = trimmed;
    }
  }

  private addAlias(e: Entity, name: string): void {
    const trimmed = name.trim();
    const aliases: string[] = e.aliases ? JSON.parse(e.aliases) : [];
    if (aliases.some((a) => a.toLowerCase() === trimmed.toLowerCase())) return;
    aliases.push(trimmed);
    const json = JSON.stringify(aliases);
    db.update(entities)
      .set({ aliases: json, updatedAt: new Date() })
      .where(eq(entities.id, e.id))
      .run();
    e.aliases = json;
  }
}

/**
 * Recompute denormalized cross-library counts (mention_count, book_count) for
 * every entity referenced by the given book. book_count is the cross-book signal
 * that powers ranking and the wander experience.
 */
export function recomputeStatsForBook(bookId: string): void {
  rawDb
    .prepare(
      `UPDATE entities SET
         mention_count = (SELECT COUNT(*) FROM entity_mentions WHERE entity_id = entities.id),
         book_count = (SELECT COUNT(DISTINCT book_id) FROM entity_mentions WHERE entity_id = entities.id),
         updated_at = unixepoch()
       WHERE id IN (SELECT DISTINCT entity_id FROM entity_mentions WHERE book_id = ?)`,
    )
    .run(bookId);

  // Drop any entity with no real mentions left — including orphans carrying a
  // stale non-zero mention_count from before foreign keys were enabled.
  rawDb
    .prepare(
      `DELETE FROM entities WHERE NOT EXISTS (SELECT 1 FROM entity_mentions WHERE entity_id = entities.id)`,
    )
    .run();
}

export interface ConsolidateResult {
  noiseEntitiesDropped: number;
  mentionsReassigned: number;
  duplicatesMerged: number;
  entitiesDeleted: number;
}

/**
 * One-shot, graph-wide cleanup that retroactively applies the quality fixes to
 * entities that already exist — necessary because re-analyzing a single book
 * cannot merge or remove rows created by an earlier pipeline run (exact-name
 * match short-circuits resolve(), and clearBookGraph deletes mentions, not the
 * global `entities` rows). Idempotent: safe to run repeatedly.
 *
 *   1. Delete noise entities (verb fragments / titled persons typed as concept),
 *      cascading their mentions.
 *   2. Within each type, merge person title/surname variants of one person
 *      (matchPersonName), reassigning mentions + relationships to the survivor.
 *   3. Recompute counts and drop now-orphaned rows.
 */
export function consolidateGraph(): ConsolidateResult {
  const res: ConsolidateResult = {
    noiseEntitiesDropped: 0,
    mentionsReassigned: 0,
    duplicatesMerged: 0,
    entitiesDeleted: 0,
  };

  // 1. Drop noise entities (mentions cascade via FK).
  const all = db.select().from(entities).all();
  const noiseIds = all.filter((e) => isNoiseSpan(e.canonicalName, e.type)).map((e) => e.id);
  for (let i = 0; i < noiseIds.length; i += 200) {
    const batch = noiseIds.slice(i, i + 200);
    const ph = batch.map(() => "?").join(",");
    rawDb.prepare(`DELETE FROM entity_mentions WHERE entity_id IN (${ph})`).run(...batch);
    rawDb
      .prepare(
        `DELETE FROM entity_relationships WHERE source_entity_id IN (${ph}) OR target_entity_id IN (${ph})`,
      )
      .run(...batch, ...batch);
    rawDb.prepare(`DELETE FROM entities WHERE id IN (${ph})`).run(...batch);
  }
  res.noiseEntitiesDropped = noiseIds.length;

  // 2. Merge person duplicates, grouped by type so matchPersonName sees peers.
  const survivors = db.select().from(entities).where(eq(entities.type, "person")).all();
  // Process shortest-name first so each merges into a fuller surviving form.
  const ordered = [...survivors].sort(
    (a, b) => a.normalizedName.split(" ").length - b.normalizedName.split(" ").length,
  );
  const removed = new Set<string>();
  for (const e of ordered) {
    if (removed.has(e.id)) continue;
    const peers = survivors.filter((c) => c.id !== e.id && !removed.has(c.id));
    const target = matchPersonName(e.normalizedName, peers);
    if (!target) continue;
    // Reassign e's mentions + relationships to target, then delete e.
    res.mentionsReassigned += (
      rawDb
        .prepare("UPDATE entity_mentions SET entity_id = ? WHERE entity_id = ?")
        .run(target.id, e.id) as { changes: number }
    ).changes;
    rawDb
      .prepare("UPDATE entity_relationships SET source_entity_id = ? WHERE source_entity_id = ?")
      .run(target.id, e.id);
    rawDb
      .prepare("UPDATE entity_relationships SET target_entity_id = ? WHERE target_entity_id = ?")
      .run(target.id, e.id);
    rawDb.prepare("DELETE FROM entities WHERE id = ?").run(e.id);
    removed.add(e.id);
    res.duplicatesMerged++;
  }

  // 3. Recompute counts globally and drop orphans.
  rawDb
    .prepare(
      `UPDATE entities SET
         mention_count = (SELECT COUNT(*) FROM entity_mentions WHERE entity_id = entities.id),
         book_count = (SELECT COUNT(DISTINCT book_id) FROM entity_mentions WHERE entity_id = entities.id),
         updated_at = unixepoch()`,
    )
    .run();
  res.entitiesDeleted = (
    rawDb
      .prepare(
        `DELETE FROM entities WHERE NOT EXISTS (SELECT 1 FROM entity_mentions WHERE entity_id = entities.id)`,
      )
      .run() as { changes: number }
  ).changes;

  return res;
}
