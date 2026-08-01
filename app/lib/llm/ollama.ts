/**
 * Server-side LLM client — the inference lane's single integration point.
 *
 * Every LLM task the fleet devices used to lease (classify-book, judge-tension,
 * name-topic, and the lg_* learning-graph passes) calls these functions
 * directly. Prompts, JSON-forcing, grounding, and repair chains were lifted
 * from the retired fleet worker so behavior (and the recorded model_id audit
 * trail) carries over unchanged.
 *
 * Two wire protocols, switched by LLM_API:
 *   - "ollama" (default): Ollama's /api/chat with format:"json" — the Beelink
 *     host's native Ollama, reached via the docker bridge.
 *   - "openai": any OpenAI-compatible /v1/chat/completions server — e.g. AMD's
 *     Lemonade for XDNA2 NPU/hybrid inference. LLM_URL/LLM_MODEL override the
 *     OLLAMA_* fallbacks so both backends can be configured side by side.
 */

const LLM_API = (process.env.LLM_API || "ollama").toLowerCase();
const LLM_URL = (process.env.LLM_URL || process.env.OLLAMA_URL || "http://localhost:11434").replace(
  /\/+$/,
  "",
);
const LLM_API_KEY = process.env.LLM_API_KEY;
export const OLLAMA_MODEL =
  process.env.LLM_MODEL || process.env.OLLAMA_MODEL || "qwen2.5:7b-instruct";

export interface OllamaChatResult {
  content: string;
  /** The model that actually served the call — recorded as model_id on rows. */
  modelId: string;
  /** Generation token count/duration, when the backend reports them (benchmarking). */
  evalCount?: number;
  evalDurationNs?: number;
  promptEvalCount?: number;
}

/**
 * Lemonade unloads idle models to make room for other inference lanes. Its
 * OpenAI/Ollama routes report that as a 500 "no model loaded" response. Load
 * the configured model through Lemonade's management API and retry exactly
 * once; unrelated 500s pass through untouched.
 */
export async function fetchWithLemonadeModelRecovery(
  endpoint: string,
  init: RequestInit,
  model: string,
  fetchImpl: typeof fetch = fetch,
  baseUrl: string = LLM_URL,
): Promise<Response> {
  let response = await fetchImpl(endpoint, init);
  if (response.status !== 500) return response;
  const detail = await response
    .clone()
    .text()
    .catch(() => "");
  if (!/no model loaded/i.test(detail)) return response;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (LLM_API_KEY) headers.Authorization = `Bearer ${LLM_API_KEY}`;
  const load = await fetchImpl(`${baseUrl}/api/v1/load`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model_name: model }),
  });
  if (!load.ok) {
    throw new Error(
      `Lemonade model reload failed ${load.status}: ${(await load.text()).slice(0, 200)}`,
    );
  }
  response = await fetchImpl(endpoint, init);
  return response;
}

/**
 * One chat turn with forced-JSON output. Throws a clear error when the backend
 * is unreachable or non-OK so callers can leave the item untouched and move on
 * (every batch pass is resumable).
 */
export async function ollamaChatJson(
  system: string,
  user: string,
  opts?: { temperature?: number; model?: string },
): Promise<OllamaChatResult> {
  const model = opts?.model || OLLAMA_MODEL;
  const openai = LLM_API === "openai";
  const endpoint = openai ? `${LLM_URL}/v1/chat/completions` : `${LLM_URL}/api/chat`;
  // Qwen3-family models burn ~10× the tokens "thinking" before the JSON —
  // useless for schema-constrained extraction and brutal for batch latency.
  // The /no_think soft switch is Qwen3's documented chat-template toggle and
  // works regardless of which server (Ollama, Lemonade) is in front.
  const noThink = /qwen3/i.test(model) && process.env.LLM_THINKING !== "1";
  const messages = [
    { role: "system", content: system },
    { role: "user", content: noThink ? `${user}\n/no_think` : user },
  ];
  const body = openai
    ? {
        model,
        stream: false,
        temperature: opts?.temperature ?? 0,
        // Widely (not universally) supported; harmless where ignored — the
        // prompts demand strict JSON and parseModelJson tolerates stragglers.
        response_format: { type: "json_object" },
        messages,
      }
    : {
        model,
        stream: false,
        format: "json", // force the model to emit a single JSON object
        options: { temperature: opts?.temperature ?? 0 },
        messages,
      };

  const t0 = process.hrtime.bigint();
  let res: Response;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (LLM_API_KEY) headers.Authorization = `Bearer ${LLM_API_KEY}`;
    res = await fetchWithLemonadeModelRecovery(
      endpoint,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
      model,
    );
  } catch (e) {
    throw new Error(
      `LLM backend unreachable at ${endpoint} (${(e as Error).message}). Is the ${openai ? "server" : "ollama service"} running?`,
    );
  }
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`LLM backend ${endpoint} returned ${res.status}: ${errBody.slice(0, 200)}`);
  }

  if (openai) {
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { completion_tokens?: number; prompt_tokens?: number };
    };
    return {
      content: data?.choices?.[0]?.message?.content ?? "",
      modelId: model,
      evalCount: data?.usage?.completion_tokens,
      // OpenAI-style responses carry no timing — wall-clock is the honest
      // approximation for the benchmark's tok/s.
      evalDurationNs: Number(process.hrtime.bigint() - t0),
      promptEvalCount: data?.usage?.prompt_tokens,
    };
  }
  const data = (await res.json()) as {
    message?: { content?: string };
    eval_count?: number;
    eval_duration?: number;
    prompt_eval_count?: number;
  };
  return {
    content: data?.message?.content ?? "",
    modelId: model,
    evalCount: data?.eval_count,
    evalDurationNs: data?.eval_duration,
    promptEvalCount: data?.prompt_eval_count,
  };
}

/** Parse the model's JSON robustly: tolerate reasoning blocks, code fences,
 *  and surrounding prose. */
export function parseModelJson<T>(raw: string): T {
  let text = (raw ?? "").trim();
  // Reasoning models (Qwen3 et al.) prefix a <think>…</think> block; drop it
  // (and any unterminated opener) before hunting for the JSON payload.
  text = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^<think>[\s\S]*/i, "")
    .trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  try {
    return JSON.parse(text) as T;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as T;
      } catch {
        /* fall through */
      }
    }
    throw new Error(`model did not return parseable JSON: ${text.slice(0, 160)}`);
  }
}

export const normForGround = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** Loose verbatim-substring check tolerant of whitespace/quote normalization. */
export function spanGrounded(span: string, text: string): boolean {
  const s = normForGround(span ?? "");
  return s.length >= 8 && normForGround(text).includes(s);
}

/**
 * Snap an ungrounded span to the most similar verbatim window in the source.
 * Scores each sentence (and a few sliding word-windows) by shared-token
 * overlap with the model's span and returns the best literal substring, or ""
 * if nothing meaningfully overlaps. Returns the ORIGINAL casing/characters
 * from `text` so the result is a true verbatim quote.
 */
export function snapToSource(span: string, text: string): string {
  const wanted = new Set(normForGround(span).split(" ").filter(Boolean));
  if (wanted.size === 0) return "";
  const sentences = text.split(/(?<=[.!?])\s+/);
  const words = text.split(/\s+/);
  const windows: string[] = [...sentences];
  for (let i = 0; i + 8 <= words.length; i += 4) {
    windows.push(words.slice(i, i + 16).join(" "));
  }
  let best = "";
  let bestScore = 0;
  for (const w of windows) {
    const trimmed = w.trim();
    const wc = trimmed.split(/\s+/).length;
    if (wc < 6 || wc > 40) continue;
    const have = new Set(normForGround(trimmed).split(" ").filter(Boolean));
    let overlap = 0;
    for (const t of wanted) if (have.has(t)) overlap++;
    const score = overlap / wanted.size;
    if (score > bestScore) {
      bestScore = score;
      best = trimmed;
    }
  }
  // Require a real majority overlap before trusting the snap.
  return bestScore >= 0.6 && spanGrounded(best, text) ? best : "";
}

// ---------------------------------------------------------------------------
// judge-tension (Reckoning adjudication)
//
// Decides how two cross-book passages relate ON ONE shared idea, quoting
// VERBATIM spans that carry the relationship. The model is never trusted to
// assert a free-standing fact — it may only point at the owner's text. Any
// verdict that can't be grounded after the repair chain (retry, snap-to-source)
// downgrades to neutral, so ungrounded spans never land in the DB.
// ---------------------------------------------------------------------------

const JUDGE_SYSTEM =
  "You are a careful librarian deciding how two NONFICTION book passages relate ON ONE shared idea — " +
  "as if placing two books in conversation for a curious reader. You judge ONLY the relationship between " +
  "the two passages about that idea; you never introduce outside facts and never paraphrase a passage as " +
  "your own claim. Most pairs have NO real relationship; default to neutral. A real relationship is one " +
  "where BOTH passages make a substantive claim about the SAME idea in the SAME sense — they may corroborate " +
  "it (agree), refine or condition it (qualify), or genuinely conflict (contradict); agree and qualify are " +
  "just as valuable as contradict. CRITICAL: if the shared word is used in DIFFERENT SENSES in the two " +
  "passages (e.g. 'change' as social reform vs 'change' as modifying code; 'signal' as an omen vs a software " +
  "signal), that is NOT a relationship — return neutral. Never force a relationship onto a coincidental word " +
  "overlap. Respond with strict JSON only.";

// Longer passages give the model more coincidental overlap to rationalize a
// relationship from. A focused window of the most relevant prose is both cleaner
// to judge and faster to process.
const JUDGE_TEXT_CHARS = 800;
const clip = (s: string) => (s.length > JUDGE_TEXT_CHARS ? s.slice(0, JUDGE_TEXT_CHARS) : s);

// STAGE 1 — verdict only. A/B testing showed that bundling the verbatim-span
// requirement into this step pushes small models toward false positives (once
// told to find quotable spans, they find them and rationalize a relationship).
// So we decide the relationship FIRST, with the polysemy guard front and centre,
// and extract spans separately (stage 2) only when there is a relationship.
function buildVerdictUser(p: { subject: string; textA: string; textB: string }): string {
  return [
    `SHARED SUBJECT: ${p.subject}`,
    "",
    "Passage A:",
    `"""${clip(p.textA)}"""`,
    "",
    "Passage B:",
    `"""${clip(p.textB)}"""`,
    "",
    "Decide the relationship of the two passages ABOUT THE SHARED SUBJECT. Pick exactly one verdict:",
    "- contradict: they make incompatible claims about the subject (different numbers, dates, causes, or assertions that cannot both be true).",
    "- qualify: one passage narrows, conditions, or refines what the other says about the subject.",
    "- agree: they independently assert the same specific thing about the subject.",
    "- neutral: both mention the subject but make no real, specific claim that relates them. WHEN UNSURE, CHOOSE NEUTRAL.",
    "",
    "If the shared word is used in DIFFERENT SENSES in the two passages, choose neutral — a coincidental word match is not a relationship.",
    "Do NOT invent facts. Use ONLY what the passages literally say.",
    "",
    'Output STRICT JSON ONLY: {"verdict","tension","stanceQuestion"}.',
    '- "tension": ONE sentence (>= 8 chars) naming the relationship (or "" for neutral).',
    '- "stanceQuestion": ONE sentence question the reader could take a position on (or "" for neutral).',
  ].join("\n");
}

// STAGE 2 — grounding. Given a decided relationship, copy the verbatim span from
// each passage that carries it. Isolated from the verdict so the span hunt can't
// bias the judgment.
function buildSpanUser(p: {
  subject: string;
  verdict: string;
  tension: string;
  textA: string;
  textB: string;
  emphasizeVerbatim?: boolean;
}): string {
  return [
    `SHARED SUBJECT: ${p.subject}`,
    `These two passages ${p.verdict.toUpperCase()} about it: ${p.tension}`,
    "",
    "Passage A:",
    `"""${clip(p.textA)}"""`,
    "",
    "Passage B:",
    `"""${clip(p.textB)}"""`,
    "",
    "Copy the span (8-30 words) from EACH passage that carries this relationship.",
    p.emphasizeVerbatim
      ? "IMPORTANT: your previous spans were not exact quotes. Copy them VERBATIM — character for character, no paraphrase, no added or removed words."
      : "Copy VERBATIM — exact characters, no edits.",
    "",
    'Output STRICT JSON ONLY: {"spanA","spanB"}.',
  ].join("\n");
}

export interface TensionJudgment {
  verdict: "agree" | "contradict" | "qualify" | "neutral";
  tension: string;
  stanceQuestion: string;
  spanA: string;
  spanB: string;
  modelId: string;
}

/**
 * Two-stage judge: verdict first, then verbatim spans, with the grounding
 * repair chain (retry-verbatim → snap-to-source → downgrade-to-neutral). The
 * final spanGrounded gate guarantees a non-neutral result always quotes real
 * substrings of both passages.
 */
export async function judgeTension(p: {
  subject: string;
  textA: string;
  textB: string;
  model?: string;
}): Promise<TensionJudgment> {
  const { subject, textA, textB, model } = p;
  const chat = async (user: string) =>
    parseModelJson<{
      verdict?: string;
      tension?: string;
      stanceQuestion?: string;
      spanA?: string;
      spanB?: string;
    }>((await ollamaChatJson(JUDGE_SYSTEM, user, { model })).content);

  const v = await chat(buildVerdictUser({ subject, textA, textB }));
  let verdict = String(v.verdict ?? "neutral").toLowerCase();
  if (!["agree", "contradict", "qualify", "neutral"].includes(verdict)) verdict = "neutral";
  let tension = String(v.tension ?? "");
  let stanceQuestion = String(v.stanceQuestion ?? "");

  let spanA = "";
  let spanB = "";

  if (verdict !== "neutral" && tension.trim().length >= 8) {
    let sp = await chat(buildSpanUser({ subject, verdict, tension, textA, textB }));
    spanA = String(sp.spanA ?? "");
    spanB = String(sp.spanB ?? "");
    // Repair step 1: retry once asking for exact copies.
    if (!spanGrounded(spanA, textA) || !spanGrounded(spanB, textB)) {
      sp = await chat(
        buildSpanUser({ subject, verdict, tension, textA, textB, emphasizeVerbatim: true }),
      );
      spanA = String(sp.spanA ?? spanA);
      spanB = String(sp.spanB ?? spanB);
    }
  }

  if (verdict !== "neutral") {
    // Repair step 2: snap each still-ungrounded span to the most similar
    // verbatim window in its source passage.
    if (!spanGrounded(spanA, textA)) spanA = snapToSource(spanA, textA) || spanA;
    if (!spanGrounded(spanB, textB)) spanB = snapToSource(spanB, textB) || spanB;
    // Repair step 3 (last resort): still ungrounded → neutral. A neutral
    // verdict needs no spans, so nothing unverifiable is ever persisted.
    if (!spanGrounded(spanA, textA) || !spanGrounded(spanB, textB) || tension.trim().length < 8) {
      verdict = "neutral";
    }
  }

  if (verdict === "neutral") {
    spanA = "";
    spanB = "";
    tension = "";
    stanceQuestion = "";
  }

  return {
    verdict: verdict as TensionJudgment["verdict"],
    tension,
    stanceQuestion,
    spanA,
    spanB,
    modelId: model || OLLAMA_MODEL,
  };
}

// ---------------------------------------------------------------------------
// classify-book — fiction/nonfiction labelling.
// ---------------------------------------------------------------------------

const CLASSIFY_SYSTEM =
  'You are a librarian classifying a book as exactly "fiction" or "nonfiction" from its ' +
  "title, author, and a short text sample. " +
  "fiction = novels, short stories, and other narrative invented stories in ANY genre " +
  "(fantasy, sci-fi, romance, LitRPG, children's chapter books, comics). " +
  "nonfiction = factual or expository works (history, science, biography/memoir, how-to, " +
  "reference, philosophy, religion, self-help, textbooks). " +
  "Respond with strict JSON only.";

function buildClassifyUser(p: { title: string; author: string; sample: string }): string {
  return [
    `TITLE: ${p.title}`,
    `AUTHOR: ${p.author}`,
    "",
    "SAMPLE:",
    `"""${p.sample}"""`,
    "",
    'Classify this book as exactly "fiction" or "nonfiction".',
    "The SAMPLE may be empty — in that case judge from the title and author alone.",
    "",
    'Output STRICT JSON ONLY, exactly these keys: {"category","confidence","reason"}.',
    '- "category": exactly "fiction" or "nonfiction".',
    '- "confidence": a number between 0 and 1.',
    '- "reason": ONE short sentence (<= 160 characters) explaining the call.',
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export interface BookClassification {
  category: "fiction" | "nonfiction";
  confidence: number;
  reason: string;
  modelId: string;
}

export async function classifyBook(p: {
  title: string;
  author: string;
  sample: string;
  model?: string;
}): Promise<BookClassification> {
  const { content, modelId } = await ollamaChatJson(CLASSIFY_SYSTEM, buildClassifyUser(p), {
    model: p.model,
  });
  const parsed = parseModelJson<{ category?: string; confidence?: number; reason?: string }>(
    content,
  );
  let category = String(parsed.category ?? "")
    .toLowerCase()
    .trim();
  if (category !== "fiction" && category !== "nonfiction") {
    // coerce common variants, else default to nonfiction with low confidence
    if (category.includes("fiction") && !category.includes("non")) category = "fiction";
    else if (category.includes("non")) category = "nonfiction";
    else category = "nonfiction";
  }
  let confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) confidence = 0.5;
  const reason = String(parsed.reason ?? "").slice(0, 200);
  return { category: category as "fiction" | "nonfiction", confidence, reason, modelId };
}

// ---------------------------------------------------------------------------
// name-topic — name a library "journey" (a theme across several nonfiction
// books) like a thoughtful bookstore names a shelf. A little temperature since
// this is a naming task, not a classification.
// ---------------------------------------------------------------------------

const NAME_TOPIC_SYSTEM =
  "You name a section of a personal library — a theme that runs across several nonfiction books — " +
  "the way a thoughtful bookstore names a shelf: short, specific, evocative, grounded ONLY in the " +
  "given material. Never invent a topic not supported by the concepts/excerpts. " +
  "Respond with strict JSON only.";

function buildNameTopicUser(p: { concepts: string[]; samples: string[] }): string {
  return [
    `CONCEPTS: ${p.concepts.join(", ")}`,
    "",
    "SAMPLE EXCERPTS:",
    ...p.samples.slice(0, 3).map((s) => `"""${s}"""`),
    "",
    "Name the theme that runs across this material.",
    "",
    'Output STRICT JSON ONLY, exactly these keys: {"label","blurb"}.',
    '- "label": a 2-6 word Title Case name (no quotes, no trailing punctuation).',
    '- "blurb": ONE sentence (< 160 characters) describing what a reader explores along this theme.',
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export interface TopicName {
  label: string;
  blurb: string;
  modelId: string;
}

export async function nameTopic(p: {
  concepts: string[];
  samples: string[];
  model?: string;
}): Promise<TopicName> {
  const { content, modelId } = await ollamaChatJson(NAME_TOPIC_SYSTEM, buildNameTopicUser(p), {
    temperature: 0.3,
    model: p.model,
  });
  const parsed = parseModelJson<{ label?: string; blurb?: string }>(content);
  let label = String(parsed.label ?? "")
    .trim()
    .replace(/^["'#]+|["'.]+$/g, "")
    .trim();
  // Clamp to shelf-card bounds (3-60 chars enforced by callers; <=7 words here).
  if (label.split(/\s+/).length > 7) label = label.split(/\s+/).slice(0, 7).join(" ");
  const blurb = String(parsed.blurb ?? "")
    .trim()
    .slice(0, 200);
  return { label, blurb, modelId };
}
