/**
 * Heuristic typed-relationship extraction — a CPU-light, no-LLM stand-in for a
 * zero-shot relation model (GLiREL et al.).
 *
 * Why heuristic: GLiREL has no JS/ONNX runtime and the `gliner` npm package is
 * NER-only, so a learned relation pass would mean a fragile custom ONNX export —
 * exactly the native-runtime weight we avoid on the shared host. Instead we read
 * the *text between* two entities GLiNER already located in a passage and match a
 * deliberately small, high-precision trigger lexicon onto the closed
 * TIER1_RELATIONSHIPS vocabulary, gated by entity-type compatibility.
 *
 * Philosophy matches the rest of the pipeline: high precision over recall (a
 * wrong edge corrupts the graph worse than a missing one), and nothing is emitted
 * without a source passage. Generic relatedness is intentionally NOT produced
 * here — that stays as query-time co-occurrence (NPMI) and semantic neighbors in
 * graph.ts. This pass only emits *explicit, typed* edges.
 */
import type { EntityType } from "../db/schema";

/**
 * Restrained, explicit relationship vocabulary — the closed set of typed edges
 * this pass may emit. Kept deliberately small for precision; intellectual/causal
 * edges ("influenced", "critiqued", "caused") are a deeper, lower-recall problem
 * left for later. Lives here now that the old generative extraction/llm path is
 * gone — this is the single source of truth for the relationship type set.
 */
export const TIER1_RELATIONSHIPS = [
  "located_in",
  "part_of",
  "member_of",
  "founded",
  "authored",
  "created",
  "invented",
  "discovered",
  "ruled",
  "fought",
  "defeated",
  "occurred_during",
  "preceded",
  "contemporary_of",
  "parent_of",
  "child_of",
  "spouse_of",
  "sibling_of",
  "teacher_of",
  "related_to",
] as const;

/** An entity GLiNER located in a passage, already resolved to a canonical id. */
export interface RelEntity {
  entityId: string;
  type: EntityType;
  name: string;
  /** Offsets within the passage text. */
  charStart: number;
  charEnd: number;
}

export interface ExtractedRelation {
  sourceEntityId: string;
  targetEntityId: string;
  type: (typeof TIER1_RELATIONSHIPS)[number];
  description: string;
  confidence: number;
}

type TypeSet = ReadonlySet<EntityType>;
const PERSON: TypeSet = new Set(["person"]);
const PERSON_ORG: TypeSet = new Set(["person", "organization"]);
const PLACE: TypeSet = new Set(["place"]);
const PLACE_ORG: TypeSet = new Set(["place", "organization"]);
const ORG: TypeSet = new Set(["organization"]);
const WORK: TypeSet = new Set(["work"]);
const EVENT: TypeSet = new Set(["event"]);
const ERA: TypeSet = new Set(["era"]);

interface Pattern {
  re: RegExp;
  type: (typeof TIER1_RELATIONSHIPS)[number];
  /** Allowed types for the edge's source / target after direction is applied. */
  src: TypeSet;
  tgt: TypeSet;
  /** When true the right-hand entity is the source (e.g. "A, student of B"). */
  reverse?: boolean;
  /** When true the edge is order-independent (A↔B); deduped on a sorted key. */
  symmetric?: boolean;
  confidence: number;
}

/**
 * Trigger lexicon. Each `re` is tested against the lowercased text BETWEEN the
 * two entities (left entity first in reading order). Keep entries explicit and
 * unambiguous — a vague trigger costs precision across the whole library.
 */
const PATTERNS: Pattern[] = [
  // Kinship — high precision, both people.
  {
    re: /\b(?:son|daughter|child) of\b/,
    type: "child_of",
    src: PERSON,
    tgt: PERSON,
    confidence: 0.8,
  },
  {
    re: /\b(?:father|mother|parent) of\b/,
    type: "parent_of",
    src: PERSON,
    tgt: PERSON,
    confidence: 0.8,
  },
  {
    re: /\b(?:brother|sister|sibling) of\b/,
    type: "sibling_of",
    src: PERSON,
    tgt: PERSON,
    symmetric: true,
    confidence: 0.8,
  },
  {
    re: /\b(?:married|wife of|husband of|spouse of|wed)\b/,
    type: "spouse_of",
    src: PERSON,
    tgt: PERSON,
    symmetric: true,
    confidence: 0.75,
  },
  // Mentorship — note the reversed "student of" form.
  {
    re: /\b(?:taught|teacher of|mentor of|tutored|instructed)\b/,
    type: "teacher_of",
    src: PERSON,
    tgt: PERSON,
    confidence: 0.7,
  },
  {
    re: /\b(?:student of|studied under|pupil of|apprentice(?:d)? (?:to|of)|disciple of)\b/,
    type: "teacher_of",
    src: PERSON,
    tgt: PERSON,
    reverse: true,
    confidence: 0.7,
  },
  // Authorship / creation.
  {
    re: /\b(?:wrote|authored|penned|author of)\b/,
    type: "authored",
    src: PERSON,
    tgt: WORK,
    confidence: 0.8,
  },
  {
    re: /\b(?:invented|devised|pioneered|conceived)\b/,
    type: "invented",
    src: PERSON_ORG,
    tgt: new Set(["invention", "concept", "object"]),
    confidence: 0.75,
  },
  {
    re: /\b(?:discovered|identified)\b/,
    type: "discovered",
    src: PERSON_ORG,
    tgt: new Set(["concept", "object", "place"]),
    confidence: 0.65,
  },
  {
    re: /\b(?:created|composed|designed|built|produced|painted|sculpted)\b/,
    type: "created",
    src: PERSON_ORG,
    tgt: new Set(["work", "object", "invention"]),
    confidence: 0.6,
  },
  {
    re: /\b(?:founded|co-?founded|established)\b/,
    type: "founded",
    src: PERSON_ORG,
    tgt: PLACE_ORG,
    confidence: 0.75,
  },
  // Membership / part-of.
  {
    re: /\b(?:member of|joined|belonged to)\b/,
    type: "member_of",
    src: PERSON,
    tgt: ORG,
    confidence: 0.7,
  },
  {
    re: /\b(?:part of|division of|subsidiary of|branch of)\b/,
    type: "part_of",
    src: new Set(["organization", "place", "object", "concept"]),
    tgt: new Set(["organization", "place", "concept"]),
    confidence: 0.65,
  },
  // Location.
  {
    re: /\b(?:located in|based in|born in|situated in|lies in|capital of)\b/,
    type: "located_in",
    src: new Set(["person", "organization", "place"]),
    tgt: PLACE,
    confidence: 0.65,
  },
  // Power / conflict.
  {
    re: /\b(?:ruled|reigned over|governed|king of|queen of|emperor of|empress of|pharaoh of)\b/,
    type: "ruled",
    src: PERSON,
    tgt: PLACE_ORG,
    confidence: 0.75,
  },
  {
    re: /\b(?:defeated|conquered|vanquished|overthrew)\b/,
    type: "defeated",
    src: PERSON_ORG,
    tgt: new Set(["person", "organization", "place"]),
    confidence: 0.7,
  },
  {
    re: /\b(?:fought|battled|warred|clashed with|at war with)\b/,
    type: "fought",
    src: PERSON_ORG,
    tgt: PERSON_ORG,
    symmetric: true,
    confidence: 0.6,
  },
  // Time.
  {
    re: /\b(?:during|amid|in the (?:era|age|reign|time) of)\b/,
    type: "occurred_during",
    src: EVENT,
    tgt: ERA,
    confidence: 0.6,
  },
  {
    re: /\b(?:contemporary of|contemporaries|colleague of)\b/,
    type: "contemporary_of",
    src: PERSON,
    tgt: PERSON,
    symmetric: true,
    confidence: 0.55,
  },
];

/** Max characters of gap text between two entities we'll inspect for a trigger. */
const MAX_GAP = 80;

/**
 * Max non-trigger words allowed in the gap between the two entities. The trigger
 * must be (nearly) the *whole* connector — "Caesar, son of Gaius" has 0 residual
 * words, whereas "the Society, whose mission stood on grounds that were part of
 * the Bank" has many, signalling the trigger belongs to a different clause and
 * the pairing is incidental. This is the main precision guard against the
 * co-location false positives (e.g. a spurious `part_of`).
 */
const MAX_RESIDUAL_WORDS = 3;

function inSet(t: EntityType, set: TypeSet): boolean {
  return set.has(t);
}

/**
 * Extract typed relationships from one passage's resolved entities. Only
 * *adjacent* entities (in reading order) are paired, and only when no sentence
 * boundary sits between them — both guards keep a trigger that belongs to one
 * pair from leaking onto another (e.g. "Caesar, son of Gaius, defeated Pompey"
 * must not yield Caesar→Pompey). Emits at most one (highest-confidence) edge per
 * adjacent pair.
 */
export function extractRelations(passageText: string, ents: RelEntity[]): ExtractedRelation[] {
  if (ents.length < 2) return [];
  const sorted = [...ents].sort((a, b) => a.charStart - b.charStart);
  const out: ExtractedRelation[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (a.entityId === b.entityId) continue;
    const gap = b.charStart - a.charEnd;
    if (gap < 0 || gap > MAX_GAP) continue;
    const between = passageText.slice(a.charEnd, b.charStart);
    // Two entities in different sentences are almost never in a stated relation;
    // a trigger spanning the boundary is noise.
    if (/[.!?]/.test(between)) continue;
    const lower = between.toLowerCase();

    let best: ExtractedRelation | null = null;
    for (const p of PATTERNS) {
      const m = p.re.exec(lower);
      if (!m) continue;
      // Reject when the trigger is buried in a longer gap (it belongs to another
      // clause, not to this entity pair) — the main guard against co-location
      // false positives like a spurious `part_of`.
      const residual = (lower.slice(0, m.index) + lower.slice(m.index + m[0].length))
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
      if (residual && residual.split(/\s+/).length > MAX_RESIDUAL_WORDS) continue;
      // Apply direction, then gate on entity types.
      const source = p.reverse ? b : a;
      const target = p.reverse ? a : b;
      if (!inSet(source.type, p.src) || !inSet(target.type, p.tgt)) continue;
      if (best && p.confidence <= best.confidence) continue;
      const trigger = m[0].replace(/\s+/g, " ").trim();
      best = {
        sourceEntityId: source.entityId,
        targetEntityId: target.entityId,
        type: p.type,
        description: `${source.name} ${trigger} ${target.name}`.slice(0, 160),
        confidence: p.confidence,
      };
    }
    if (best) out.push(best);
  }
  return out;
}

/**
 * Stable de-dupe key for a relation within a book. Symmetric edges (sibling_of,
 * spouse_of, fought, contemporary_of) collapse regardless of direction so we
 * don't store both A→B and B→A.
 */
export function relationKey(r: ExtractedRelation): string {
  const symmetric = new Set(["sibling_of", "spouse_of", "fought", "contemporary_of"]);
  if (symmetric.has(r.type)) {
    const [x, y] = [r.sourceEntityId, r.targetEntityId].sort();
    return `${r.type}|${x}|${y}`;
  }
  return `${r.type}|${r.sourceEntityId}|${r.targetEntityId}`;
}
