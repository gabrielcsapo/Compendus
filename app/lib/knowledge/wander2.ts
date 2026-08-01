/**
 * Wander v2 — passage-centric exploration over the semantic substrate
 * (wander-semantic-substrate-proposal.md §6).
 *
 * The unit of a stop is a PASSAGE (real author's words, entities highlighted,
 * jump-to-reader one tap away), not an entity. Steps are a scored blend over
 * precomputed structure, so a stop is table lookups — no inference, no scans:
 *
 *   same_idea       kNN edge into a different book
 *   relationship    typed edge from an entity on this passage ("X conquered Y")
 *   different_take  same entity, maximally distant vector (perspectives)
 *   deeper          same topic, higher centrality, unvisited
 *   leave           bridge edge out of this topic ("somewhere else entirely")
 *
 * Every step is grounded: it IS a passage, with a reason. Dead ends are
 * structurally impossible (every passage has K neighbors by construction).
 */
import { rawDb } from "../db";
import { embed } from "./embeddings";
import { getEmbedding, nearestByCentroid, recordSeen } from "./substrate";

export interface StopEntity {
  id: string;
  name: string;
  type: string;
}

export interface WanderStep {
  kind: "same_idea" | "relationship" | "different_take" | "deeper" | "leave";
  passageId: string;
  bookId: string;
  bookTitle: string;
  snippet: string;
  reason: string;
  score: number;
}

export interface WanderStop {
  passageId: string;
  bookId: string;
  bookTitle: string;
  chapterTitle: string | null;
  spineIndex: number | null;
  /** Progress within the chapter (0-1) — pairs with spineIndex as a reader locator. */
  chapterProgress: number | null;
  text: string;
  topicId: string | null;
  topicLabel: string | null;
  entities: StopEntity[];
  steps: WanderStep[];
}

// Passage text can carry HTML from EPUB extraction — syntax-highlighted code
// (<code class="…">, <span>), entities (&amp;), etc. Native clients render text,
// not markup, so strip tags + decode the common entities at serve time. (The
// deeper fix is stripping at ingestion; this keeps the read surfaces clean now.)
export function cleanPassageText(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function snippet(text: string, max = 220): string {
  const t = cleanPassageText(text);
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

interface PassageRow {
  id: string;
  bookId: string;
  bookTitle: string;
  chapterTitle: string | null;
  spineIndex: number | null;
  text: string;
}

// These statements sit on every Wander tap. Preparing them once avoids paying
// SQLite parse/codegen cost repeatedly while preserving bound parameters.
const passageStmt = rawDb.prepare(
  `SELECT p.id, p.book_id AS bookId, b.title AS bookTitle, p.chapter_title AS chapterTitle,
          p.spine_index AS spineIndex, p.text
   FROM passages p JOIN books b ON b.id = p.book_id WHERE p.id = ?`,
);

const entitiesStmt = rawDb.prepare(
  `SELECT e.id, e.canonical_name AS name, e.type
     FROM canonical_mentions m JOIN entities e ON e.id = m.entity_id
    WHERE m.passage_id = ? GROUP BY e.id
    ORDER BY e.book_count DESC, e.mention_count DESC LIMIT ?`,
);

const topicStmt = rawDb.prepare(
  `SELECT t.id, t.label FROM passage_topics pt JOIN topics t ON t.id = pt.topic_id
    WHERE pt.passage_id = ?`,
);

function getPassage(id: string): PassageRow | undefined {
  return passageStmt.get(id) as PassageRow | undefined;
}

function entitiesOf(passageId: string, limit = 6): StopEntity[] {
  return entitiesStmt.all(passageId, limit) as StopEntity[];
}

function topicOf(passageId: string): { id: string; label: string | null } | undefined {
  return topicStmt.get(passageId) as { id: string; label: string | null } | undefined;
}

// --- step generation -----------------------------------------------------------------

function buildSteps(
  passageId: string,
  visited: Set<string>,
  limit = 6,
  knownPassage?: PassageRow,
  knownContext?: {
    topic: { id: string; label: string | null } | undefined;
    entities: StopEntity[];
  },
): WanderStep[] {
  const here = knownPassage ?? getPassage(passageId);
  if (!here) return [];
  const steps: WanderStep[] = [];
  const used = new Set<string>([passageId, ...visited]);
  const passageCache = new Map<string, PassageRow>([[here.id, here]]);

  const cachedPassage = (id: string): PassageRow | undefined => {
    const cached = passageCache.get(id);
    if (cached) return cached;
    const passage = getPassage(id);
    if (passage) passageCache.set(id, passage);
    return passage;
  };

  const push = (kind: WanderStep["kind"], pid: string, reason: string, score: number): boolean => {
    if (used.has(pid)) return false;
    const p = cachedPassage(pid);
    if (!p) return false;
    used.add(pid);
    steps.push({
      kind,
      passageId: pid,
      bookId: p.bookId,
      bookTitle: p.bookTitle,
      snippet: snippet(p.text),
      reason,
      score,
    });
    return true;
  };

  // 1. relationship — a typed edge from this passage's most salient entity.
  const ents = knownContext?.entities.slice(0, 3) ?? entitiesOf(passageId, 3);
  for (const ent of ents) {
    const rel = rawDb
      .prepare(
        `SELECT r.type, r.description, r.evidence_passage_id AS pid,
                e2.canonical_name AS other
         FROM entity_relationships r
         JOIN entities e2 ON e2.id = (CASE WHEN r.source_entity_id = ? THEN r.target_entity_id ELSE r.source_entity_id END)
         WHERE (r.source_entity_id = ? OR r.target_entity_id = ?)
           AND r.evidence_passage_id IS NOT NULL AND r.evidence_passage_id != ?
         ORDER BY r.confidence DESC LIMIT 3`,
      )
      .all(ent.id, ent.id, ent.id, passageId) as {
      type: string;
      description: string | null;
      pid: string;
      other: string;
    }[];
    for (const r of rel) {
      if (
        push(
          "relationship",
          r.pid,
          r.description || `${ent.name} ${r.type.replace(/_/g, " ")} ${r.other}`,
          0.9,
        )
      )
        break;
    }
    if (steps.some((s) => s.kind === "relationship")) break;
  }

  // 2. same_idea — strongest kNN edges into a DIFFERENT book.
  const cross = rawDb
    .prepare(
      `SELECT neighbor_id AS pid, score FROM passage_neighbors
       WHERE passage_id = ? AND cross_book = 1 ORDER BY score DESC LIMIT 6`,
    )
    .all(passageId) as { pid: string; score: number }[];
  let sameIdeaCount = 0;
  for (const e of cross) {
    const p = cachedPassage(e.pid);
    if (!p) continue;
    if (push("same_idea", e.pid, `The same idea in “${p.bookTitle}”`, 0.8 + e.score / 10)) {
      if (++sameIdeaCount >= 2) break;
    }
  }

  // 3. different_take — same top entity, maximally DISTANT vector (perspectives).
  const hereVec = getEmbedding("passage", passageId);
  if (hereVec && ents[0]) {
    const mentions = rawDb
      .prepare(
        `SELECT DISTINCT m.passage_id AS pid FROM canonical_mentions m
         JOIN passages p ON p.id = m.passage_id
         WHERE m.entity_id = ? AND m.passage_id != ? LIMIT 40`,
      )
      .all(ents[0].id, passageId) as { pid: string }[];
    let worst: { pid: string; s: number } | null = null;
    for (const m of mentions) {
      const v = getEmbedding("passage", m.pid);
      if (!v) continue;
      let s = 0;
      for (let d = 0; d < Math.min(v.length, hereVec.length); d++) s += v[d] * hereVec[d];
      if (!worst || s < worst.s) worst = { pid: m.pid, s };
    }
    if (worst && worst.s < 0.6) {
      push("different_take", worst.pid, `A very different take on ${ents[0].name}`, 0.7);
    }
  }

  // 4. deeper — same topic, highest centrality, unvisited.
  const topic = knownContext ? knownContext.topic : topicOf(passageId);
  if (topic) {
    const deeper = rawDb
      .prepare(
        `SELECT pt.passage_id AS pid FROM passage_topics pt
         JOIN passage_rank pr ON pr.passage_id = pt.passage_id
         WHERE pt.topic_id = ? AND pt.passage_id != ? AND pr.prose >= 0.5
         ORDER BY pr.book_norm DESC, pr.centrality DESC LIMIT 8`,
      )
      .all(topic.id, passageId) as { pid: string }[];
    for (const d of deeper) {
      if (
        push(
          "deeper",
          d.pid,
          topic.label ? `Deeper into ${topic.label.split(",")[0]}` : "Deeper into this theme",
          0.6,
        )
      )
        break;
    }
  }

  // 5. leave — a bridge out of this topic ("somewhere else entirely").
  const bridge = rawDb
    .prepare(
      `SELECT CASE WHEN passage_a = ? THEN passage_b ELSE passage_a END AS pid, score
       FROM bridges WHERE passage_a = ? OR passage_b = ? ORDER BY score DESC LIMIT 3`,
    )
    .all(passageId, passageId, passageId) as { pid: string; score: number }[];
  for (const b of bridge) {
    if (push("leave", b.pid, "Somewhere else entirely — a hidden connection", 0.5)) break;
  }
  if (!steps.some((s) => s.kind === "leave")) {
    // No direct bridge from this passage: borrow a global one for serendipity.
    const any = rawDb
      .prepare("SELECT passage_a AS pid FROM bridges ORDER BY RANDOM() LIMIT 3")
      .all() as { pid: string }[];
    for (const b of any) {
      if (push("leave", b.pid, "Somewhere else entirely — a hidden connection", 0.4)) break;
    }
  }

  return steps.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function stepsFor(passageId: string, visited: Set<string>, limit = 6): WanderStep[] {
  return buildSteps(passageId, visited, limit);
}

// --- stops -----------------------------------------------------------------------------

/** Chapter-anchored progress for the native reader's locator. */
function chapterProgressOf(
  passageId: string,
  bookId: string,
  spineIndex: number | null,
): number | null {
  if (spineIndex == null) return null;
  const row = rawDb
    .prepare(
      `SELECT MIN(char_start) AS lo, MAX(char_end) AS hi,
              (SELECT char_start FROM passages WHERE id = ?) AS at
       FROM passages WHERE book_id = ? AND spine_index = ?`,
    )
    .get(passageId, bookId, spineIndex) as {
    lo: number | null;
    hi: number | null;
    at: number | null;
  };
  if (row.lo == null || row.hi == null || row.at == null || row.hi <= row.lo) return null;
  return Math.max(0, Math.min(1, (row.at - row.lo) / (row.hi - row.lo)));
}

export function getStop(
  passageId: string,
  opts: { visited?: string[]; profileId?: string } = {},
): WanderStop | null {
  const p = getPassage(passageId);
  if (!p) return null;
  const topic = topicOf(passageId);
  const entities = entitiesOf(passageId);
  if (opts.profileId) recordSeen(opts.profileId, passageId, "wander");
  return {
    passageId: p.id,
    bookId: p.bookId,
    bookTitle: p.bookTitle,
    chapterTitle: p.chapterTitle,
    spineIndex: p.spineIndex,
    chapterProgress: chapterProgressOf(p.id, p.bookId, p.spineIndex),
    text: cleanPassageText(p.text),
    topicId: topic?.id ?? null,
    topicLabel: topic?.label ?? null,
    entities,
    steps: buildSteps(passageId, new Set(opts.visited ?? []), 6, p, { topic, entities }),
  };
}

// --- seeded entry ------------------------------------------------------------------------

function topPassageOfTopic(topicId: string): string | undefined {
  const row = rawDb
    .prepare(
      `SELECT pt.passage_id AS pid FROM passage_topics pt
       JOIN passage_rank pr ON pr.passage_id = pt.passage_id
       WHERE pt.topic_id = ? AND pr.prose >= 0.5
       ORDER BY pr.book_norm DESC, pr.centrality DESC LIMIT 1`,
    )
    .get(topicId) as { pid: string } | undefined;
  return row?.pid;
}

// Has the fiction/nonfiction classification landed? When it has, wander
// gates its start to nonfiction so a random walk begins in an *idea* (a how-to,
// a history) rather than a novel. Cached; falls back gracefully if the
// cs_book_class table isn't present yet.
let nfReady: boolean | null = null;
function nonfictionReady(): boolean {
  if (nfReady !== null) return nfReady;
  try {
    const n = (
      rawDb
        .prepare("SELECT COUNT(*) AS n FROM cs_book_class WHERE category = 'nonfiction'")
        .get() as {
        n: number;
      }
    ).n;
    nfReady = n > 0;
  } catch {
    nfReady = false;
  }
  return nfReady;
}

/** The topic's top passage, restricted to nonfiction books (or undefined). */
function topNonfictionPassageOfTopic(topicId: string): string | undefined {
  const row = rawDb
    .prepare(
      `SELECT pt.passage_id AS pid FROM passage_topics pt
       JOIN passage_rank pr ON pr.passage_id = pt.passage_id
       JOIN passages p ON p.id = pt.passage_id
       JOIN cs_book_class cc ON cc.book_id = p.book_id AND cc.category = 'nonfiction'
       WHERE pt.topic_id = ? AND pr.prose >= 0.5
       ORDER BY pr.book_norm DESC, pr.centrality DESC LIMIT 1`,
    )
    .get(topicId) as { pid: string } | undefined;
  return row?.pid;
}

export function startRandom(): string | null {
  // Weighted by PROSE size over substantial topics: connected serendipity,
  // citations/front-matter communities excluded by construction. When the
  // classification is available, the topics (and final passage) are gated to
  // nonfiction so wander begins in an idea, not a novel.
  const gate = nonfictionReady();
  const candidateSql = gate
    ? `SELECT t.id, COUNT(*) AS size FROM topics t
       JOIN passage_topics pt ON pt.topic_id = t.id
       JOIN passage_rank pr ON pr.passage_id = pt.passage_id
       JOIN passages p ON p.id = pt.passage_id
       JOIN cs_book_class cc ON cc.book_id = p.book_id AND cc.category = 'nonfiction'
       WHERE t.size >= 10 AND pr.prose >= 0.5
       GROUP BY t.id HAVING size >= 8 ORDER BY size DESC LIMIT 40`
    : `SELECT t.id, COUNT(*) AS size FROM topics t
       JOIN passage_topics pt ON pt.topic_id = t.id
       JOIN passage_rank pr ON pr.passage_id = pt.passage_id
       WHERE t.size >= 10 AND pr.prose >= 0.5
       GROUP BY t.id HAVING size >= 8 ORDER BY size DESC LIMIT 40`;
  const candidates = rawDb.prepare(candidateSql).all() as { id: string; size: number }[];
  const pick = (topicId: string): string | undefined =>
    (gate ? topNonfictionPassageOfTopic(topicId) : undefined) ?? topPassageOfTopic(topicId);

  if (candidates.length === 0) {
    const any = rawDb
      .prepare(
        "SELECT passage_id AS pid FROM passage_rank WHERE prose >= 0.5 ORDER BY centrality DESC LIMIT 25",
      )
      .all() as { pid: string }[];
    return any.length ? any[Math.floor(Math.random() * any.length)].pid : null;
  }
  const total = candidates.reduce((a, c) => a + c.size, 0);
  let roll = Math.random() * total;
  for (const c of candidates) {
    roll -= c.size;
    if (roll <= 0) return pick(c.id) ?? null;
  }
  return pick(candidates[0].id) ?? null;
}

export async function startFromQuery(query: string): Promise<string | null> {
  const qv = await embed(query);
  // Match query against entity and topic centroids (short↔short, symmetric).
  const [ents, tops] = [nearestByCentroid("entity", qv, 3), nearestByCentroid("topic", qv, 3)];
  const bestEnt = ents[0];
  const bestTop = tops[0];
  if (bestEnt && (!bestTop || bestEnt.score >= bestTop.score)) {
    const row = rawDb
      .prepare(
        `SELECT m.passage_id AS pid FROM canonical_mentions m
         JOIN passage_rank pr ON pr.passage_id = m.passage_id
         WHERE m.entity_id = ? AND pr.prose >= 0.4
         ORDER BY pr.book_norm DESC LIMIT 1`,
      )
      .get(bestEnt.refId) as { pid: string } | undefined;
    if (row) return row.pid;
  }
  if (bestTop) return topPassageOfTopic(bestTop.refId) ?? null;
  return startRandom();
}

export function startFromBook(bookId: string): string | null {
  const row = rawDb
    .prepare(
      `SELECT pr.passage_id AS pid FROM passage_rank pr
       JOIN passages p ON p.id = pr.passage_id
       WHERE p.book_id = ? AND pr.prose >= 0.5
       ORDER BY pr.book_norm DESC, pr.centrality DESC LIMIT 1`,
    )
    .get(bookId) as { pid: string } | undefined;
  return row?.pid ?? null;
}
