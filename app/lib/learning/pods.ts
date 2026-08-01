/**
 * The shared learning read model for web and native clients.
 *
 * A Pod is deliberately a read model over the library's current learning
 * substrate, not a third topic system. The lg_* graph is preferred when it is
 * live; old cs topic ids remain readable so saved links do not break. Every
 * item and question resolves to a passages row, which is the source-of-truth
 * anchor used by the readers.
 */
import { createHash, randomUUID } from "node:crypto";
import { rawDb } from "../db";
import {
  buildConceptCurriculum,
  conceptAdjacentTopics,
  listConceptJourneyTopics,
} from "../concept/wander";
import {
  lgAdjacentThemes,
  lgBuildCurriculum,
  lgJourneysLive,
  lgListJourneyTopics,
  type Curriculum,
  type JourneyTopicRow,
} from "../lg/read-models";

export type PodSource = "learning-graph" | "concept-fallback";

export interface SourceLocator {
  passageId: string;
  bookId: string;
  bookTitle: string;
  chapterTitle: string | null;
  spineIndex: number | null;
  page: number | null;
  charStart: number | null;
  charEnd: number | null;
}

export interface PodSummary {
  id: string;
  title: string;
  description: string | null;
  passageCount: number;
  bookCount: number;
  questionCount: number;
  source: PodSource;
}

export interface PodSessionItem {
  ordinal: number;
  passageId: string;
  bookId: string;
  bookTitle: string;
  snippet: string;
  module: "Orientation" | "Core ideas" | "Other perspectives" | "In practice";
  role: string;
  transition: string;
  seen: boolean;
  source: SourceLocator;
}

export interface PodQuestionChoice {
  id: string;
  text: string;
}

export interface PodQuestion {
  id: string;
  kind: "source-recall";
  prompt: string;
  choices: PodQuestionChoice[];
  afterOrdinal: number;
  evidence: SourceLocator & { excerpt: string };
  savedAnswer: PodSavedAnswer | null;
}

export interface PodSavedAnswer {
  selectedChoiceId: string;
  result: PodAttemptResult;
}

export interface PodSession {
  id: string;
  podId: string;
  title: string;
  revision: string;
  source: PodSource;
  items: PodSessionItem[];
  questions: PodQuestion[];
}

export interface PodAttemptResult {
  correct: boolean;
  feedback: string;
  evidence: PodQuestion["evidence"];
}

type PassageRow = {
  passageId: string;
  text: string;
  bookId: string;
  bookTitle: string;
  chapterTitle: string | null;
  spineIndex: number | null;
  page: number | null;
  charStart: number | null;
  charEnd: number | null;
  prose: number | null;
};

const SESSION_LIMIT = 10;
const SESSION_EXCERPT_CHARS = 900;
const MIN_SESSION_ITEMS = 3;
const MIN_SESSION_BOOKS = 3;
const MAX_PASSAGES_PER_BOOK = 2;
const MIN_PASSAGE_WORDS = 35;
const MIN_PROSE_SCORE = 0.58;

const NON_TEACHABLE_RE =
  /\b(isbn|copyright|all rights reserved|table of contents|bibliography|references|index)\b|<code\b|\b(function|const|var|println|printf|github\.com|https?:\/\/)\b/i;
const STRUCTURED_DATA_RE =
  /['"](?:id|text|title)['"]\s*:|(?:[/][^\s]+){3,}|[\w./-]+\.(?:flac|wav|mp3|json|jsonl|csv)\b/i;
const FRONT_MATTER_RE = /\bpraise for\b|^[—-][^.!?]{3,100},\s*[^.!?]{2,80}\s*[“"]/i;
const BOOK_META_RE =
  /\bbird on the cover\b|\bthank you for supporting\b.{0,100}\bpurchase\b|\bthis book presents\b|\bchapter \d+\b.{0,100}\bis an? (?:introductory|overview) chapter\b|\bis a machine learning engineer with expertise\b/i;
const REFERENCE_LIST_RE = /\((?:18|19|20)\d{2}[a-z]?\).{0,220}\((?:18|19|20)\d{2}[a-z]?\)/i;
const NON_CONTENT_CHAPTER_RE =
  /^(?:ref(?:erences?)?|bibliography|index|copyright|contents?|praise|also by|about the author|colophon|front matter)$|(?:^|[_-])(?:ref(?:erences?)?|bibliography|index|copyright|contents?|colophon)(?:[_-]|$)/i;

const GENERIC_POD_TITLE_TERMS = new Set([
  "deliver",
  "doing",
  "easier",
  "first",
  "four",
  "growth",
  "handsomely",
  "life",
  "making",
  "place",
  "positioned",
  "retrospective",
  "retrospectives",
  "rewarded",
  "smart",
  "something",
  "stupid",
  "well",
  "year",
  "years",
]);

const POD_RELEVANCE_STOP_WORDS = new Set([
  "about",
  "after",
  "against",
  "also",
  "and",
  "are",
  "book",
  "books",
  "concepts",
  "data",
  "exploring",
  "from",
  "have",
  "ideas",
  "information",
  "into",
  "more",
  "other",
  "techniques",
  "their",
  "these",
  "this",
  "through",
  "using",
  "various",
  "what",
  "when",
  "where",
  "which",
  "with",
]);

const tidy = (value: string) =>
  value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const excerpt = (value: string, max = 440) => {
  const clean = tidy(value);
  if (clean.length <= max) return clean;
  const head = clean.slice(0, max);
  const stop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  return `${head.slice(0, stop > max / 2 ? stop + 1 : max).trim()}…`;
};

const stableId = (prefix: string, ...parts: string[]) =>
  `${prefix}_${createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 20)}`;

const isLearningGraphPodId = (id: string) => id.startsWith("lgth_") || id.startsWith("lgt_");

/** Public for focused quality tests and future ingestion gates. */
export function isTeachablePodPassage(text: string, prose: number | null): boolean {
  const clean = tidy(text);
  if (prose !== null && prose < MIN_PROSE_SCORE) return false;
  if (clean.split(/\s+/).length < MIN_PASSAGE_WORDS) return false;
  if (NON_TEACHABLE_RE.test(clean)) return false;
  if (
    STRUCTURED_DATA_RE.test(clean) ||
    FRONT_MATTER_RE.test(clean) ||
    BOOK_META_RE.test(clean) ||
    REFERENCE_LIST_RE.test(clean)
  ) {
    return false;
  }
  const punctuation = (clean.match(/[.!?]/g) ?? []).length;
  return punctuation >= 2;
}

export function isQualityPodTitle(title: string): boolean {
  const clean = tidy(title);
  if (clean.length < 3 || clean.length > 72) return false;
  if (!/^\p{Lu}/u.test(clean)) return false;
  const words = clean.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length < 2 || words.length > 9) return false;
  const meaningful = words
    .map((word) => word.toLocaleLowerCase())
    .filter((word) => word.length >= 4)
    .filter((word) => !POD_RELEVANCE_STOP_WORDS.has(word))
    .filter((word) => !GENERIC_POD_TITLE_TERMS.has(word));
  return meaningful.length > 0;
}

export function isPodContentChapter(chapterTitle: string | null): boolean {
  return !chapterTitle || !NON_CONTENT_CHAPTER_RE.test(tidy(chapterTitle));
}

function relevanceTokens(value: string): Set<string> {
  const normalize = (token: string) => {
    if (token.length > 5 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
    if (token.length > 4 && token.endsWith("s") && !token.endsWith("ss")) {
      return token.slice(0, -1);
    }
    return token;
  };
  const tokens = tidy(value)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .map(normalize)
    .filter((token) => token.length >= 4 && !POD_RELEVANCE_STOP_WORDS.has(token));
  return new Set(tokens);
}

/**
 * Final request-time safety gate for stale or contaminated topic/spine data.
 * A Pod may return fewer than ten passages; it must never pad a session with
 * clean-looking prose that has no lexical support for the Pod readers opened.
 */
export function podPassageRelevance(
  title: string,
  description: string | null,
  passage: Pick<PassageRow, "text" | "bookTitle" | "chapterTitle">,
): { relevant: boolean; score: number; titleMatches: number; descriptionMatches: number } {
  const titleTerms = relevanceTokens(title);
  const descriptionTerms = relevanceTokens(description ?? "");
  for (const titleTerm of titleTerms) descriptionTerms.delete(titleTerm);
  const haystack = relevanceTokens(
    `${passage.bookTitle} ${passage.chapterTitle ?? ""} ${passage.text}`,
  );
  const matches = (terms: Set<string>) =>
    [...terms].reduce((count, term) => count + (haystack.has(term) ? 1 : 0), 0);
  const titleMatches = matches(titleTerms);
  const descriptionMatches = matches(descriptionTerms);
  const requiredTitleMatches =
    titleTerms.size === 0 ? Number.POSITIVE_INFINITY : Math.min(2, titleTerms.size);
  const relevant =
    titleMatches >= requiredTitleMatches ||
    (titleMatches >= 1 && descriptionMatches >= 2) ||
    (titleTerms.size === 0 && descriptionMatches >= 2);
  return {
    relevant,
    score: titleMatches * 4 + descriptionMatches,
    titleMatches,
    descriptionMatches,
  };
}

function sourceFor(row: PassageRow): SourceLocator {
  return {
    passageId: row.passageId,
    bookId: row.bookId,
    bookTitle: row.bookTitle,
    chapterTitle: row.chapterTitle,
    spineIndex: row.spineIndex,
    page: row.page,
    charStart: row.charStart,
    charEnd: row.charEnd,
  };
}

function moduleFor(role: string, ordinal: number): PodSessionItem["module"] {
  if (ordinal === 1 || role === "definition" || role === "entry") return "Orientation";
  if (role === "application" || role === "exercise") return "In practice";
  if (role === "example" || role === "caveat" || role === "anecdote") {
    return "Other perspectives";
  }
  return "Core ideas";
}

function sourcesForIds(passageIds: string[]): Map<string, PassageRow> {
  const uniqueIds = [...new Set(passageIds)];
  if (uniqueIds.length === 0) return new Map();
  const placeholders = uniqueIds.map(() => "?").join(",");
  const rows = rawDb
    .prepare(
      `SELECT p.id AS passageId, p.text, p.book_id AS bookId, b.title AS bookTitle,
              p.chapter_title AS chapterTitle, p.spine_index AS spineIndex,
              p.page, p.char_start AS charStart, p.char_end AS charEnd,
              s.prose
         FROM passages p
         JOIN books b ON b.id = p.book_id
         LEFT JOIN cs_passage_salience s ON s.passage_id = p.id
        WHERE p.id IN (${placeholders})`,
    )
    .all(...uniqueIds) as PassageRow[];
  return new Map(rows.map((row) => [row.passageId, row]));
}

type SessionSelection = {
  items: PodSessionItem[];
  passagesById: Map<string, PassageRow>;
};

function selectSessionItems(curriculum: Curriculum, description: string | null): SessionSelection {
  // Curriculum builders can return dozens of candidates. Resolve their source
  // anchors in one bounded query instead of preparing/running one statement per
  // candidate (and then repeating it for quiz evidence).
  const passagesById = sourcesForIds(curriculum.items.map((item) => item.passageId));
  const counts = new Map<string, number>();
  const selected: PodSessionItem[] = [];
  for (const candidate of curriculum.items) {
    const row = passagesById.get(candidate.passageId);
    if (!row || !isTeachablePodPassage(row.text, row.prose)) continue;
    if (!isPodContentChapter(row.chapterTitle)) continue;
    if (!podPassageRelevance(curriculum.title, description, row).relevant) continue;
    const count = counts.get(row.bookId) ?? 0;
    if (count >= MAX_PASSAGES_PER_BOOK) continue;
    counts.set(row.bookId, count + 1);
    selected.push({
      ordinal: selected.length + 1,
      passageId: row.passageId,
      bookId: row.bookId,
      bookTitle: row.bookTitle,
      snippet: excerpt(row.text, SESSION_EXCERPT_CHARS),
      module: moduleFor(candidate.role, selected.length + 1),
      role: candidate.role,
      transition: candidate.transition,
      seen: candidate.seen,
      source: sourceFor(row),
    });
    if (selected.length >= SESSION_LIMIT) break;
  }
  return { items: selected, passagesById };
}

type QuestionCompilation = {
  questions: PodQuestion[];
  correctChoiceIds: Map<string, string>;
};

type SourceStatement = {
  item: PodSessionItem;
  row: PassageRow;
  text: string;
};

const FACTUAL_SENTENCE_RE =
  /\b(is|are|was|were|has|have|means|refers|consists|contains|includes|requires|causes|became|began|ended|explains|shows|describes)\b|\b\d{2,}\b/i;

export function podSourceStatement(text: string): string | null {
  const clean = tidy(text);
  const sentences = clean.match(/[^.!?]+[.!?]+/g) ?? [];
  const eligible = sentences
    .map((sentence) =>
      sentence.trim().replace(/^\d+(?:\.\d+)*\s+(?:introduction|overview|background)\s+/i, ""),
    )
    .filter((sentence) => {
      const words = sentence.split(/\s+/).length;
      return (
        sentence.length >= 55 &&
        sentence.length <= 280 &&
        words >= 9 &&
        words <= 48 &&
        !NON_TEACHABLE_RE.test(sentence) &&
        !REFERENCE_LIST_RE.test(sentence) &&
        !/^(?:chapter|part|section)\s+[\p{L}\p{N}]+\b/iu.test(sentence) &&
        !/\bdoi\s*:\s*10\./i.test(sentence) &&
        !sentence.endsWith("?")
      );
    });
  if (eligible.length === 0) return null;
  return eligible.find((sentence) => FACTUAL_SENTENCE_RE.test(sentence)) ?? eligible[0];
}

function questionsFor(
  podId: string,
  items: PodSessionItem[],
  passagesById: Map<string, PassageRow>,
): QuestionCompilation {
  const candidates = items
    .map((item): SourceStatement | null => {
      const row = passagesById.get(item.passageId);
      const text = row ? podSourceStatement(item.snippet) : null;
      return row && text ? { item, row, text } : null;
    })
    .filter((value): value is SourceStatement => Boolean(value));

  const questions: PodQuestion[] = [];
  const correctChoiceIds = new Map<string, string>();
  for (const candidate of candidates) {
    const normalizedSourceStatement = candidate.text.toLocaleLowerCase();
    const distractors = candidates
      .filter(
        (other) =>
          other.item.passageId !== candidate.item.passageId &&
          other.item.bookId !== candidate.item.bookId,
      )
      .filter((other) => other.text.toLocaleLowerCase() !== normalizedSourceStatement)
      .filter(
        (other, index, all) =>
          all.findIndex(
            (value) => value.text.toLocaleLowerCase() === other.text.toLocaleLowerCase(),
          ) === index,
      )
      .slice(0, 2);
    if (distractors.length < 2) continue;
    const choices = [candidate, ...distractors];
    // Stable rotation avoids always placing the source statement first without
    // introducing request-time randomness that would invalidate attempts.
    const rotation =
      parseInt(stableId("r", podId, candidate.item.passageId).slice(-2), 16) % choices.length;
    const rotated = [...choices.slice(rotation), ...choices.slice(0, rotation)];
    const questionId = stableId("podq", podId, candidate.item.passageId, candidate.text);
    questions.push({
      id: questionId,
      kind: "source-recall",
      prompt: `Which statement is directly supported by ${candidate.item.bookTitle}?`,
      choices: rotated.map((choice) => ({
        id: stableId("choice", questionId, choice.item.passageId, choice.text),
        text: choice.text,
      })),
      afterOrdinal: candidate.item.ordinal,
      evidence: { ...sourceFor(candidate.row), excerpt: candidate.text },
      savedAnswer: null,
    });
    correctChoiceIds.set(
      questionId,
      stableId("choice", questionId, candidate.item.passageId, candidate.text),
    );
    if (questions.length >= 3) break;
  }
  return { questions, correctChoiceIds };
}

function savedAnswersFor(
  profileId: string | undefined,
  podId: string,
  questions: PodQuestion[],
): Map<string, PodSavedAnswer> {
  if (!profileId || questions.length === 0) return new Map();
  const questionIds = questions.map((question) => question.id);
  const rows = rawDb
    .prepare(
      `SELECT question_id AS questionId, selected_choice_id AS selectedChoiceId,
              is_correct AS isCorrect
         FROM pod_quiz_attempts
        WHERE profile_id = ? AND pod_id = ?
          AND question_id IN (${questionIds.map(() => "?").join(",")})
        ORDER BY is_correct DESC, created_at DESC, rowid DESC`,
    )
    .all(profileId, podId, ...questionIds) as Array<{
    questionId: string;
    selectedChoiceId: string;
    isCorrect: number;
  }>;
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const saved = new Map<string, PodSavedAnswer>();
  for (const row of rows) {
    if (saved.has(row.questionId)) continue;
    const question = questionsById.get(row.questionId);
    if (!question?.choices.some((choice) => choice.id === row.selectedChoiceId)) continue;
    const correct = Boolean(row.isCorrect);
    saved.set(row.questionId, {
      selectedChoiceId: row.selectedChoiceId,
      result: {
        correct,
        feedback: correct
          ? "That matches the source."
          : "Review the source passage, then try the question again.",
        evidence: question.evidence,
      },
    });
  }
  return saved;
}

function topicSource(id: string): PodSource {
  return isLearningGraphPodId(id) ? "learning-graph" : "concept-fallback";
}

type PodMetadata = { description: string | null };

function podMetadata(ids: string[]): Map<string, PodMetadata> {
  const result = new Map<string, PodMetadata>();
  const lgIds = ids.filter(isLearningGraphPodId);
  const csIds = ids.filter((id) => !isLearningGraphPodId(id));
  if (lgIds.length) {
    const rows = rawDb
      .prepare(
        `SELECT id, blurb
           FROM lg_themes WHERE id IN (${lgIds.map(() => "?").join(",")})`,
      )
      .all(...lgIds) as Array<{ id: string; blurb: string | null }>;
    for (const row of rows) {
      result.set(row.id, { description: row.blurb });
    }
  }
  if (csIds.length) {
    const rows = rawDb
      .prepare(
        `SELECT id, fleet_blurb AS blurb
           FROM cs_topics WHERE id IN (${csIds.map(() => "?").join(",")})`,
      )
      .all(...csIds) as Array<{ id: string; blurb: string | null }>;
    for (const row of rows) {
      result.set(row.id, { description: row.blurb });
    }
  }
  return result;
}

function readySummaries(rows: JourneyTopicRow[]): PodSummary[] {
  const candidates = rows.filter(
    (row) =>
      Boolean(row.label) &&
      row.bookCount >= MIN_SESSION_BOOKS &&
      isQualityPodTitle(row.label ?? ""),
  );
  const metadata = podMetadata(candidates.map((row) => row.id));
  return candidates.flatMap((row): PodSummary[] => {
    const meta = metadata.get(row.id);
    const compiled = compilePodSession(row.id, undefined, meta?.description ?? null, {
      noEnqueue: true,
    });
    if (!compiled) return [];
    const { session } = compiled;
    return [
      {
        id: row.id,
        title: session.title,
        description: meta?.description ?? null,
        passageCount: session.items.length,
        bookCount: new Set(session.items.map((item) => item.bookId)).size,
        questionCount: session.questions.length,
        source: session.source,
      },
    ];
  });
}

function normalizedPodTitle(title: string): string {
  return tidy(title)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function readyPodStrength(pod: PodSummary): number {
  return pod.bookCount * 100 + pod.passageCount * 10 + pod.questionCount;
}

function curateReadyPods(pods: PodSummary[]): PodSummary[] {
  const byTitle = new Map<string, PodSummary>();
  for (const pod of pods) {
    const key = normalizedPodTitle(pod.title);
    const current = byTitle.get(key);
    if (!current || readyPodStrength(pod) > readyPodStrength(current)) byTitle.set(key, pod);
  }
  return [...byTitle.values()].sort(
    (a, b) => readyPodStrength(b) - readyPodStrength(a) || a.title.localeCompare(b.title),
  );
}

type ReadyPodCatalog = {
  source: PodSource;
  signature: string;
  pods: PodSummary[];
};

let readyPodCatalogCache: ReadyPodCatalog | null = null;

function allJourneyTopicRows(source: PodSource): JourneyTopicRow[] {
  const rows: JourneyTopicRow[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (offset < total) {
    const result =
      source === "learning-graph"
        ? lgListJourneyTopics({ limit: 80, offset })
        : listConceptJourneyTopics({ limit: 80, offset });
    rows.push(...result.topics);
    total = result.total;
    if (result.topics.length === 0) break;
    offset += result.topics.length;
  }
  return rows;
}

function podCatalogSignature(source: PodSource): string {
  const dataVersion = rawDb.pragma("data_version", { simple: true }) as number;
  const stats =
    source === "learning-graph"
      ? (rawDb
          .prepare(
            `SELECT COUNT(*) AS rows,
                    COALESCE(SUM(nonfiction_books + concept_count + passage_count
                      + LENGTH(COALESCE(label, '')) + LENGTH(COALESCE(blurb, ''))), 0) AS shape
               FROM lg_themes`,
          )
          .get() as { rows: number; shape: number })
      : (rawDb
          .prepare(
            `SELECT COUNT(*) AS rows,
                    COALESCE(SUM(nonfiction_books + size
                      + LENGTH(COALESCE(fleet_label, ''))
                      + LENGTH(COALESCE(fleet_blurb, ''))), 0) AS shape
               FROM cs_topics`,
          )
          .get() as { rows: number; shape: number });
  const membershipCount = (
    source === "learning-graph"
      ? rawDb.prepare("SELECT COUNT(*) AS count FROM lg_spine_passages")
      : rawDb.prepare("SELECT COUNT(*) AS count FROM cs_passage_topics")
  ).get() as { count: number };
  return `${source}:${dataVersion}:${stats.rows}:${stats.shape}:${membershipCount.count}`;
}

function readyPodCatalog(): PodSummary[] {
  const source: PodSource = lgJourneysLive() ? "learning-graph" : "concept-fallback";
  const signature = podCatalogSignature(source);
  if (readyPodCatalogCache?.source === source && readyPodCatalogCache.signature === signature) {
    return readyPodCatalogCache.pods;
  }
  const pods = curateReadyPods(readySummaries(allJourneyTopicRows(source)));
  readyPodCatalogCache = { source, signature, pods };
  return pods;
}

export function listPods(opts: { limit?: number; offset?: number; ids?: string[] }): {
  pods: PodSummary[];
  total: number;
} {
  if (opts.ids?.length) {
    const result = lgJourneysLive()
      ? lgListJourneyTopics({ ids: opts.ids })
      : listConceptJourneyTopics({ ids: opts.ids });
    const pods = readySummaries(result.topics);
    return { pods, total: pods.length };
  }
  const catalog = readyPodCatalog();
  const limit = Math.min(80, Math.max(1, opts.limit ?? 60));
  const offset = Math.max(0, opts.offset ?? 0);
  return { pods: catalog.slice(offset, offset + limit), total: catalog.length };
}

export function searchPods(query: string): PodSummary[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const score = (pod: PodSummary) => {
    const title = pod.title.toLocaleLowerCase();
    if (title === needle) return 0;
    if (title.startsWith(needle)) return 1;
    if (title.includes(needle)) return 2;
    return 3;
  };
  return readyPodCatalog()
    .filter(
      (pod) =>
        pod.title.toLocaleLowerCase().includes(needle) ||
        pod.description?.toLocaleLowerCase().includes(needle),
    )
    .sort(
      (a, b) =>
        score(a) - score(b) ||
        b.bookCount - a.bookCount ||
        b.passageCount - a.passageCount ||
        a.title.localeCompare(b.title),
    )
    .slice(0, 20);
}

export function adjacentPods(podId: string): PodSummary[] {
  const rows = isLearningGraphPodId(podId) ? lgAdjacentThemes(podId) : conceptAdjacentTopics(podId);
  return curateReadyPods(readySummaries(rows));
}

type CompiledPodSession = {
  session: PodSession;
  correctChoiceIds: Map<string, string>;
};

function compilePodSession(
  podId: string,
  profileId?: string,
  knownDescription?: string | null,
  opts?: { noEnqueue?: boolean },
): CompiledPodSession | null {
  const curriculum = isLearningGraphPodId(podId)
    ? lgBuildCurriculum(podId, profileId, { noEnqueue: opts?.noEnqueue })
    : buildConceptCurriculum(podId, profileId);
  if (!curriculum) return null;
  const description =
    knownDescription === undefined
      ? (podMetadata([podId]).get(podId)?.description ?? null)
      : knownDescription;
  const { items, passagesById } = selectSessionItems(curriculum, description);
  if (items.length < MIN_SESSION_ITEMS) return null;
  if (new Set(items.map((item) => item.bookId)).size < MIN_SESSION_BOOKS) return null;
  const revision = stableId("rev", podId, ...items.map((item) => item.passageId));
  const questionCompilation = questionsFor(podId, items, passagesById);
  if (questionCompilation.questions.length === 0) return null;
  const savedAnswers = savedAnswersFor(profileId, podId, questionCompilation.questions);
  return {
    session: {
      id: stableId("session", podId, revision),
      podId,
      title: curriculum.title,
      revision,
      source: topicSource(podId),
      items,
      questions: questionCompilation.questions.map((question) => ({
        ...question,
        savedAnswer: savedAnswers.get(question.id) ?? null,
      })),
    },
    correctChoiceIds: questionCompilation.correctChoiceIds,
  };
}

export function getPodSession(podId: string, profileId?: string): PodSession | null {
  return compilePodSession(podId, profileId)?.session ?? null;
}

export function answerPodQuestion(opts: {
  podId: string;
  revision?: string;
  questionId: string;
  selectedChoiceId: string;
  attemptId?: string;
  profileId?: string;
}): PodAttemptResult | null {
  const compiled = compilePodSession(opts.podId, opts.profileId);
  if (opts.revision && compiled?.session.revision !== opts.revision) return null;
  const question = compiled?.session.questions.find((value) => value.id === opts.questionId);
  if (!question) return null;
  // Reject stale/fabricated IDs rather than recording them as a legitimate
  // wrong answer. The private key was compiled alongside these exact choices,
  // so grading cannot drift via a second unordered claim lookup.
  if (!question.choices.some((choice) => choice.id === opts.selectedChoiceId)) return null;
  const correctChoiceId = compiled?.correctChoiceIds.get(question.id);
  if (!correctChoiceId) return null;
  const correct = opts.selectedChoiceId === correctChoiceId;
  if (opts.profileId) {
    const attemptRowId = opts.attemptId
      ? stableId("attempt", opts.profileId, opts.podId, opts.attemptId)
      : randomUUID();
    rawDb
      .prepare(
        `INSERT OR IGNORE INTO pod_quiz_attempts
           (id, profile_id, pod_id, question_id, evidence_passage_id, selected_choice_id, is_correct)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        attemptRowId,
        opts.profileId,
        opts.podId,
        opts.questionId,
        question.evidence.passageId,
        opts.selectedChoiceId,
        correct ? 1 : 0,
      );
  }
  return {
    correct,
    feedback: correct
      ? "That matches the source."
      : "Review the source passage, then try the question again.",
    evidence: question.evidence,
  };
}
