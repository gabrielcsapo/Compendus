/**
 * YAKE! unsupervised keyphrase extraction (Campos et al., 2018) — pure JS, no
 * model, no native runtime. It scores candidate n-grams from statistical
 * features of a single document (casing, position, frequency, dispersion,
 * sentence spread), so it runs in milliseconds and can never deadlock the way the
 * ONNX runtime has on the shared host.
 *
 * Why we want it: GLiNER is strong on named entities (person/place/org) but weak
 * on the abstract `concept`/`theme` material that makes the Living Library worth
 * wandering — its stopword list in gliner-extract.ts exists precisely because it
 * over-tags generic nouns. YAKE surfaces the *distinctive* multi-word concepts of
 * a book ("natural selection", "social contract") that GLiNER misses, which then
 * enter the graph as grounded `concept` entities.
 *
 * Lower score = more important (YAKE convention).
 */

/** Compact English stopword set — enough for candidate boundary trimming. */
const STOPWORDS = new Set<string>(
  (
    "a an the and or but if then else when at by for with about against between into through during " +
    "before after above below to from up down in out on off over under again further once here there " +
    "all any both each few more most other some such no nor not only own same so than too very can will " +
    "just of as is are was were be been being have has had do does did this that these those it its it's " +
    "he she they we you i him her them his their our your my me us who whom which what whose how why where " +
    "would could should may might must shall am also upon among within without while because since though " +
    "however therefore thus hence whereas per via etc"
  ).split(/\s+/),
);

const MAX_NGRAM = 3;
const WORD_RE = /[A-Za-z][A-Za-z'-]+/g;

interface Token {
  raw: string; // original casing
  term: string; // lowercased
  sentence: number; // sentence index it belongs to
  startOfSentence: boolean;
  isStop: boolean;
  valid: boolean; // alphabetic, length>=3, usable in a candidate
}

interface TermStat {
  tf: number;
  tfUpper: number; // acronym / all-caps occurrences
  tfCap: number; // capitalized mid-sentence occurrences
  sentences: Set<number>;
  positions: number[]; // sentence indices of occurrences
  left: Map<string, number>;
  right: Map<string, number>;
  score: number;
}

export interface Keyphrase {
  /** Display form (original casing of the first occurrence). */
  phrase: string;
  /** Lowercased canonical form. */
  normalized: string;
  /** YAKE score — lower is more important. */
  score: number;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  // Split into sentences on terminal punctuation or newlines.
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  sentences.forEach((sentence, si) => {
    let m: RegExpExecArray | null;
    WORD_RE.lastIndex = 0;
    let first = true;
    while ((m = WORD_RE.exec(sentence)) !== null) {
      const raw = m[0];
      const term = raw.toLowerCase();
      tokens.push({
        raw,
        term,
        sentence: si,
        startOfSentence: first,
        isStop: STOPWORDS.has(term),
        valid: term.length >= 3 && !/^[-']|[-']$/.test(term),
      });
      first = false;
    }
  });
  return tokens;
}

function buildStats(tokens: Token[], sentenceCount: number): Map<string, TermStat> {
  const stats = new Map<string, TermStat>();
  const get = (t: string): TermStat => {
    let s = stats.get(t);
    if (!s) {
      s = {
        tf: 0,
        tfUpper: 0,
        tfCap: 0,
        sentences: new Set(),
        positions: [],
        left: new Map(),
        right: new Map(),
        score: 0,
      };
      stats.set(t, s);
    }
    return s;
  };

  tokens.forEach((tok, i) => {
    const s = get(tok.term);
    s.tf++;
    s.sentences.add(tok.sentence);
    s.positions.push(tok.sentence);
    if (tok.raw.length > 1 && tok.raw === tok.raw.toUpperCase()) s.tfUpper++;
    else if (!tok.startOfSentence && /^[A-Z]/.test(tok.raw)) s.tfCap++;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    if (prev && prev.sentence === tok.sentence)
      s.left.set(prev.term, (s.left.get(prev.term) ?? 0) + 1);
    if (next && next.sentence === tok.sentence)
      s.right.set(next.term, (s.right.get(next.term) ?? 0) + 1);
  });

  // Aggregate frequency moments over non-stopword terms (the candidate space).
  const tfs = [...stats.entries()].filter(([t]) => !STOPWORDS.has(t)).map(([, s]) => s.tf);
  const meanTf = tfs.reduce((a, b) => a + b, 0) / Math.max(1, tfs.length);
  const variance = tfs.reduce((a, b) => a + (b - meanTf) ** 2, 0) / Math.max(1, tfs.length);
  const stdTf = Math.sqrt(variance);
  const maxTf = tfs.length ? Math.max(...tfs) : 1;

  for (const s of stats.values()) {
    const casing = Math.max(s.tfUpper, s.tfCap) / (1 + Math.log(1 + s.tf));
    const median = medianOf(s.positions);
    const position = Math.log(Math.log(3 + median));
    const frequency = s.tf / (meanTf + stdTf || 1);
    const sumLeft = [...s.left.values()].reduce((a, b) => a + b, 0);
    const sumRight = [...s.right.values()].reduce((a, b) => a + b, 0);
    const dl = s.left.size / Math.max(1, sumLeft);
    const dr = s.right.size / Math.max(1, sumRight);
    const relatedness = 1 + (dl + dr) * (s.tf / maxTf);
    const sentence = s.sentences.size / Math.max(1, sentenceCount);
    // YAKE term weight: lower = more important.
    s.score =
      (relatedness * position) / (casing + frequency / relatedness + sentence / relatedness);
  }
  return stats;
}

function medianOf(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Jaccard overlap of two phrases' word sets — for near-duplicate suppression. */
function jaccard(a: string, b: string): number {
  const sa = new Set(a.split(" "));
  const sb = new Set(b.split(" "));
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/**
 * Extract the top-K keyphrases from a document. Candidates are 1–3-gram windows
 * of contiguous in-sentence tokens that don't begin or end with a stopword.
 */
export function extractKeyphrases(text: string, topK = 40): Keyphrase[] {
  const tokens = tokenize(text);
  if (tokens.length < 5) return [];
  const sentenceCount = (tokens[tokens.length - 1]?.sentence ?? 0) + 1;
  const stats = buildStats(tokens, sentenceCount);

  // Generate candidates with their term sequences, keyed by normalized phrase.
  const candidates = new Map<string, { terms: string[]; tf: number; display: string }>();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].sentence !== tokens[i].sentence) continue;
    for (let n = 1; n <= MAX_NGRAM && i + n <= tokens.length; n++) {
      const window = tokens.slice(i, i + n);
      // Stay within one sentence and only over valid tokens.
      if (window.some((t, k) => k > 0 && t.sentence !== window[0].sentence)) break;
      if (window.some((t) => !t.valid)) continue;
      // Candidates must not begin or end with a stopword.
      if (window[0].isStop || window[n - 1].isStop) continue;
      const normalized = window.map((t) => t.term).join(" ");
      const existing = candidates.get(normalized);
      if (existing) existing.tf++;
      else
        candidates.set(normalized, {
          terms: window.map((t) => t.term),
          tf: 1,
          display: window.map((t) => t.raw).join(" "),
        });
    }
  }

  const scored: Keyphrase[] = [];
  for (const [normalized, c] of candidates) {
    if (c.tf < 1) continue;
    let prod = 1;
    let sum = 0;
    for (const t of c.terms) {
      const s = stats.get(t)?.score ?? 1;
      prod *= s;
      sum += s;
    }
    // YAKE candidate score: lower = better.
    const score = prod / (c.tf * (1 + sum));
    scored.push({ phrase: c.display.trim(), normalized, score });
  }

  scored.sort((a, b) => a.score - b.score);

  // Greedy de-duplication: drop a phrase too similar to one already kept.
  const kept: Keyphrase[] = [];
  for (const cand of scored) {
    if (kept.some((k) => jaccard(k.normalized, cand.normalized) >= 0.8)) continue;
    kept.push(cand);
    if (kept.length >= topK) break;
  }
  return kept;
}
