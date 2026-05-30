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
import { createHash } from "crypto";
import { db, rawDb, entities, entityCanonical, type Entity } from "../db";
import { type EntityType } from "../db/schema";
import { embed, vectorToBuffer, bufferToVector, cosine } from "./embeddings";
import { matchPersonName } from "./person-name";
import { isNoiseSpan } from "./gliner-extract";

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deterministic entity id = hash(type | normalizedName), formatted as a UUID.
 *
 * Using a content hash instead of a random UUID makes the graph *reproducible*:
 * the same (type, normalized name) always yields the same id, so re-analysis is
 * idempotent, a wiped-and-rebuilt graph reproduces identical ids, and merges
 * converge instead of minting fresh randoms each run. This does NOT dedup
 * variants ("mr tanimoto" vs "tanimoto" hash differently) — that's the job of
 * the matching/clustering passes; this only fixes id *stability*.
 */
export function stableEntityId(type: string, normalizedName: string): string {
  const h = createHash("sha256").update(`${type}|${normalizedName}`).digest("hex");
  // Format the first 32 hex chars as a UUID (purely cosmetic; any stable TEXT works).
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export interface ResolveInput {
  name: string;
  type: EntityType;
  dateText?: string | null;
}

/**
 * Resolver for the IMMUTABLE extraction layer — insert-only. Each distinct
 * (type, normalized name) becomes one stable-id `entities` row plus a self
 * `entity_canonical` mapping. It performs NO merging: identity (which extracted
 * entities are the same canonical node, which are excluded as noise) is decided
 * by rebuildCanonicalMapping(), so it can be re-run, re-tuned, and corrected
 * without ever mutating extraction data. Caches per-id within one book's run so
 * repeated surface forms reuse the row (and accrue aliases).
 */
export class EntityResolver {
  private byId = new Map<string, Entity>();

  async resolve(input: ResolveInput): Promise<string> {
    const norm = normalizeName(input.name);
    const effectiveNorm = norm.length === 0 ? input.name.trim().toLowerCase() : norm;
    const id = stableEntityId(input.type, effectiveNorm);

    const existing =
      this.byId.get(id) ?? db.select().from(entities).where(eq(entities.id, id)).get();
    if (existing) {
      this.byId.set(id, existing);
      this.addAlias(existing, input.name);
      this.maybePromoteCanonical(existing, input.name);
      return id;
    }

    // New extracted entity: embed its normalized name for later clustering.
    const vec = effectiveNorm ? await embed(effectiveNorm) : null;
    const now = new Date();
    const row: typeof entities.$inferInsert = {
      id,
      type: input.type,
      canonicalName: input.name.trim(),
      normalizedName: effectiveNorm,
      aliases: JSON.stringify([input.name.trim()]),
      embedding: vec ? vectorToBuffer(vec) : null,
      dateText: input.dateText ?? null,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(entities).values(row).onConflictDoNothing().run();
    // Self-mapping: every extracted entity is its own canonical node by default;
    // rebuildCanonicalMapping() may later repoint it. Insert-only — never clobber
    // an existing (possibly pinned) decision.
    db.insert(entityCanonical)
      .values({ entityId: id, canonicalId: id, method: "self", updatedAt: now })
      .onConflictDoNothing()
      .run();
    this.byId.set(id, row as unknown as Entity);
    return id;
  }

  /** Promote the display name to a longer surface form when one appears. Only
   *  touches `canonicalName` (display); normalizedName/id are immutable. */
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
 * Recompute denormalized counts. With the canonical layer, the meaningful counts
 * are at the *canonical* level: mention_count / book_count on a canonical entity
 * aggregate every mention attributed to it through the mapping (excluding noise).
 * Cheap at personal-library scale, so we recompute globally rather than per-book.
 *
 * Extraction rows are NEVER deleted here — that's the whole point of the
 * immutable layer. Non-canonical members keep their own per-extraction counts;
 * read queries surface canonical entities via the mapping/view. The `_bookId`
 * arg is kept for call-site compatibility but the recompute is global.
 */
export function recomputeStatsForBook(_bookId?: string): void {
  rawDb
    .prepare(
      `UPDATE entities SET
         mention_count = (
           SELECT COUNT(*) FROM canonical_mentions WHERE entity_id = entities.id
         ),
         book_count = (
           SELECT COUNT(DISTINCT book_id) FROM canonical_mentions WHERE entity_id = entities.id
         ),
         updated_at = unixepoch()`,
    )
    .run();
}

export interface ConsolidateResult {
  /** Extracted entities flagged as noise (hidden, not deleted). */
  excluded: number;
  /** Probable-duplicate candidate links proposed by the person-name heuristic. */
  personNameCandidates: number;
  /** Probable-duplicate candidate links proposed by the embedding heuristic. */
  embeddingCandidates: number;
  /** Open candidate links awaiting human review after the rebuild. */
  openCandidates: number;
  /** Human-confirmed links applied as canonical pins. */
  confirmedApplied: number;
  /** Distinct canonical entities (self-pointers + non-excluded). */
  canonicalGroups: number;
  /** Human pin decisions preserved. */
  pinnedPreserved: number;
}

/**
 * Cosine threshold for *proposing* two same-type entities as a probable
 * duplicate. High by design — we'd rather miss a suggestion than spam weak ones.
 * Note this no longer drives any merge: it only emits a candidate link a human
 * can confirm.
 */
const CLUSTER_THRESHOLD = 0.92;

/** Order a pair deterministically so (a,b) and (b,a) are the same row. */
function orderPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

/**
 * Rebuild the derived identity layer. Conservative identity model: heuristics
 * NEVER assert that two entities are the same — they only PROPOSE it as a
 * candidate link a human can confirm. The only automatic identity is exact-name
 * collapse (free at the extraction layer: same normalized name → same stable id).
 *
 * Idempotent and reversible — touches only `entity_canonical` (pins + exclusions)
 * and `entity_candidate_links` (open proposals). Human verdicts are preserved:
 * `pinned` canonical rows and `confirmed`/`rejected` candidate links are never
 * overwritten; confirmed links are (re)applied as pins.
 *
 *   1. Ensure a self-mapping per entity; reset non-pinned mappings to self.
 *   2. Flag noise entities as excluded (non-pinned only).
 *   3. Clear OPEN candidate links (keep confirmed/rejected human verdicts).
 *   4. Person-name + embedding passes → emit OPEN candidate links (skip pairs a
 *      human already rejected).
 *   5. Apply confirmed links as canonical pins; path-compress.
 */
export function rebuildCanonicalMapping(): ConsolidateResult {
  const res: ConsolidateResult = {
    excluded: 0,
    personNameCandidates: 0,
    embeddingCandidates: 0,
    openCandidates: 0,
    confirmedApplied: 0,
    canonicalGroups: 0,
    pinnedPreserved: 0,
  };

  const pinned = new Set(
    (
      rawDb
        .prepare("SELECT entity_id AS id FROM entity_canonical WHERE pinned = 1")
        .all() as Array<{
        id: string;
      }>
    ).map((r) => r.id),
  );
  res.pinnedPreserved = pinned.size;
  const isPinned = (id: string) => pinned.has(id);

  // 1. Self-mapping per entity; reset non-pinned to self.
  rawDb
    .prepare(
      `INSERT OR IGNORE INTO entity_canonical (entity_id, canonical_id, method, updated_at)
       SELECT id, id, 'self', unixepoch() FROM entities`,
    )
    .run();
  rawDb
    .prepare(
      `UPDATE entity_canonical SET canonical_id = entity_id, method = 'self', score = NULL,
         excluded = 0, updated_at = unixepoch() WHERE pinned = 0`,
    )
    .run();

  const all = db.select().from(entities).all();

  // 2. Exclude noise (non-pinned).
  const setExcluded = rawDb.prepare(
    "UPDATE entity_canonical SET excluded = 1, method = 'noise', updated_at = unixepoch() WHERE entity_id = ? AND pinned = 0",
  );
  for (const e of all) {
    if (!isPinned(e.id) && isNoiseSpan(e.canonicalName, e.type)) {
      setExcluded.run(e.id);
      res.excluded++;
    }
  }
  const excluded = new Set(
    (
      rawDb
        .prepare("SELECT entity_id AS id FROM entity_canonical WHERE excluded = 1")
        .all() as Array<{ id: string }>
    ).map((r) => r.id),
  );

  // 3. Clear stale OPEN proposals; remember human verdicts so we don't re-propose.
  rawDb.prepare("DELETE FROM entity_candidate_links WHERE status = 'open'").run();
  const verdicts = new Set(
    (
      rawDb
        .prepare(
          "SELECT entity_a AS a, entity_b AS b FROM entity_candidate_links WHERE status IN ('confirmed','rejected')",
        )
        .all() as Array<{ a: string; b: string }>
    ).map((r) => `${r.a}|${r.b}`),
  );

  const proposeLink = rawDb.prepare(
    `INSERT INTO entity_candidate_links (id, entity_a, entity_b, method, score, status, updated_at)
     VALUES (?, ?, ?, ?, ?, 'open', unixepoch())
     ON CONFLICT(entity_a, entity_b) DO NOTHING`,
  );
  const propose = (x: string, y: string, method: string, score: number | null): boolean => {
    const [a, b] = orderPair(x, y);
    if (verdicts.has(`${a}|${b}`)) return false; // human already decided this pair
    const r = proposeLink.run(candidateId(a, b), a, b, method, score) as { changes: number };
    return r.changes > 0;
  };

  // 4a. Person-name pass → candidate links (variants of one person).
  const people = all
    .filter((e) => e.type === "person" && !excluded.has(e.id))
    .sort((a, b) => a.normalizedName.split(" ").length - b.normalizedName.split(" ").length);
  for (const e of people) {
    const peers = people.filter((c) => c.id !== e.id);
    const target = matchPersonName(e.normalizedName, peers);
    if (target && propose(e.id, target.id, "person_name", null)) res.personNameCandidates++;
  }

  // 4b. Embedding pass → candidate links (near-identical same-type names).
  res.embeddingCandidates = proposeEmbeddingCandidates(all, excluded, propose);

  // 5. Apply human-confirmed links as pins, then path-compress.
  res.confirmedApplied = applyConfirmedLinks();
  compressCanonicalChains();

  res.openCandidates = (
    rawDb
      .prepare("SELECT COUNT(*) AS c FROM entity_candidate_links WHERE status = 'open'")
      .get() as { c: number }
  ).c;
  res.canonicalGroups = (
    rawDb
      .prepare("SELECT COUNT(DISTINCT canonical_id) AS c FROM entity_canonical WHERE excluded = 0")
      .get() as { c: number }
  ).c;
  return res;
}

/** Deterministic id for a candidate pair (already ordered a<b). */
function candidateId(a: string, b: string): string {
  return createHash("sha256").update(`cand|${a}|${b}`).digest("hex").slice(0, 32);
}

/** Propose near-identical same-type entities as candidate links via name
 *  embeddings. Returns the number of new open links created. */
function proposeEmbeddingCandidates(
  all: Entity[],
  excluded: Set<string>,
  propose: (x: string, y: string, method: string, score: number | null) => boolean,
): number {
  let count = 0;
  const byType = new Map<string, Entity[]>();
  for (const e of all) {
    if (excluded.has(e.id) || !e.embedding) continue;
    (byType.get(e.type) ?? byType.set(e.type, []).get(e.type)!).push(e);
  }
  for (const rows of byType.values()) {
    if (rows.length < 2) continue;
    const vecs = new Map<string, Float32Array>();
    for (const e of rows) vecs.set(e.id, bufferToVector(e.embedding as Buffer));
    for (let i = 0; i < rows.length; i++) {
      const av = vecs.get(rows[i].id)!;
      for (let j = i + 1; j < rows.length; j++) {
        const score = cosine(av, vecs.get(rows[j].id)!);
        if (score >= CLUSTER_THRESHOLD && propose(rows[i].id, rows[j].id, "embedding", score)) {
          count++;
        }
      }
    }
  }
  return count;
}

/** Apply each human-confirmed candidate link as a canonical pin (entity_b →
 *  entity_a) so confirmed identities survive future rebuilds. Returns count. */
function applyConfirmedLinks(): number {
  const confirmed = rawDb
    .prepare(
      "SELECT entity_a AS a, entity_b AS b, score AS score FROM entity_candidate_links WHERE status = 'confirmed'",
    )
    .all() as Array<{ a: string; b: string; score: number | null }>;
  const pin = rawDb.prepare(
    `INSERT INTO entity_canonical (entity_id, canonical_id, method, score, pinned, updated_at)
     VALUES (?, ?, 'pinned', ?, 1, unixepoch())
     ON CONFLICT(entity_id) DO UPDATE SET canonical_id = excluded.canonical_id,
       method = 'pinned', score = excluded.score, pinned = 1, updated_at = unixepoch()`,
  );
  for (const c of confirmed) pin.run(c.b, c.a, c.score);
  return confirmed.length;
}

/** Collapse pointer chains so canonical_id always references a final root
 *  (a row whose canonical_id is itself). Bounded iterations guard against cycles. */
function compressCanonicalChains(): void {
  const rows = rawDb
    .prepare("SELECT entity_id AS id, canonical_id AS cid FROM entity_canonical")
    .all() as Array<{ id: string; cid: string }>;
  const parent = new Map(rows.map((r) => [r.id, r.cid]));
  const root = (id: string): string => {
    let cur = id;
    for (let i = 0; i < 16 && parent.get(cur) && parent.get(cur) !== cur; i++)
      cur = parent.get(cur)!;
    return cur;
  };
  const upd = rawDb.prepare("UPDATE entity_canonical SET canonical_id = ? WHERE entity_id = ?");
  for (const r of rows) {
    const final = root(r.id);
    if (final !== r.cid) upd.run(final, r.id);
  }
}

/** @deprecated old name — alias retained for the route layer. */
export const consolidateGraph = rebuildCanonicalMapping;

export interface CandidateLinkView {
  id: string;
  method: string;
  score: number | null;
  status: string;
  a: { id: string; name: string; type: string };
  b: { id: string; name: string; type: string };
}

/** List candidate duplicate links for human review (open first, newest first). */
export function listCandidateLinks(status = "open", limit = 100): CandidateLinkView[] {
  const rows = rawDb
    .prepare(
      `SELECT l.id AS id, l.method AS method, l.score AS score, l.status AS status,
              ea.id AS aId, ea.canonical_name AS aName, ea.type AS aType,
              eb.id AS bId, eb.canonical_name AS bName, eb.type AS bType
       FROM entity_candidate_links l
       JOIN entities ea ON ea.id = l.entity_a
       JOIN entities eb ON eb.id = l.entity_b
       WHERE l.status = ?
       ORDER BY l.score DESC NULLS LAST, l.updated_at DESC
       LIMIT ?`,
    )
    .all(status, limit) as Array<{
    id: string;
    method: string;
    score: number | null;
    status: string;
    aId: string;
    aName: string;
    aType: string;
    bId: string;
    bName: string;
    bType: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    method: r.method,
    score: r.score,
    status: r.status,
    a: { id: r.aId, name: r.aName, type: r.aType },
    b: { id: r.bId, name: r.bName, type: r.bType },
  }));
}

/**
 * Record a human verdict on a candidate link. `confirmed` immediately pins the
 * merge (entity_b → entity_a) and compresses; `rejected` suppresses future
 * re-proposals of the pair. Returns true if a row was updated.
 */
export function setCandidateStatus(id: string, status: "confirmed" | "rejected"): boolean {
  const link = rawDb
    .prepare(
      "SELECT entity_a AS a, entity_b AS b, score AS score FROM entity_candidate_links WHERE id = ?",
    )
    .get(id) as { a: string; b: string; score: number | null } | undefined;
  if (!link) return false;

  rawDb
    .prepare("UPDATE entity_candidate_links SET status = ?, updated_at = unixepoch() WHERE id = ?")
    .run(status, id);

  if (status === "confirmed") {
    rawDb
      .prepare(
        `INSERT INTO entity_canonical (entity_id, canonical_id, method, score, pinned, updated_at)
         VALUES (?, ?, 'pinned', ?, 1, unixepoch())
         ON CONFLICT(entity_id) DO UPDATE SET canonical_id = excluded.canonical_id,
           method = 'pinned', score = excluded.score, pinned = 1, updated_at = unixepoch()`,
      )
      .run(link.b, link.a, link.score);
    compressCanonicalChains();
    recomputeStatsForBook();
  }
  return true;
}

/**
 * Undo a human verdict, returning the candidate link to `open` so it can be
 * re-reviewed. Humans make mistakes — a confirmed merge or a rejection should be
 * reversible. Undoing a confirm also UNPINS entity_b (resets its canonical
 * mapping back to self) so the entities split apart again. Non-destructive
 * throughout (no extraction data touched). Returns true if a row was updated.
 */
export function undoCandidateReview(id: string): boolean {
  const link = rawDb
    .prepare(
      "SELECT entity_a AS a, entity_b AS b, status AS status FROM entity_candidate_links WHERE id = ?",
    )
    .get(id) as { a: string; b: string; status: string } | undefined;
  if (!link) return false;
  if (link.status === "open") return true; // already open — nothing to undo

  if (link.status === "confirmed") {
    // Reset entity_b's mapping to self only if it's still pinned to entity_a (a
    // later pin elsewhere shouldn't be clobbered by this undo).
    rawDb
      .prepare(
        `UPDATE entity_canonical
         SET canonical_id = entity_id, method = 'self', score = NULL, pinned = 0, updated_at = unixepoch()
         WHERE entity_id = ? AND canonical_id = ?`,
      )
      .run(link.b, link.a);
    // Re-point anything that had been path-compressed onto entity_b's group.
    compressCanonicalChains();
    recomputeStatsForBook();
  }

  rawDb
    .prepare(
      "UPDATE entity_candidate_links SET status = 'open', updated_at = unixepoch() WHERE id = ?",
    )
    .run(id);
  return true;
}
