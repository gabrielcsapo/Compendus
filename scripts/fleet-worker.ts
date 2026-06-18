/**
 * Server-class fabric worker harness — NOT the laptop worker.
 *
 * The real F2/F3 worker is built into the Compendus app itself
 * (Compendus/Compendus/Services/FleetWorkerService.swift): the Mac Catalyst
 * build polls while on AC power, and iOS runs the same loop in a
 * BGProcessingTask during charging windows. Devices enroll from Settings →
 * Idle Fleet.
 *
 * This script remains for two jobs:
 *   1. E2E verification (scripts/e2e-substrate.ts spawns it as a real worker
 *      process against a live queue), and
 *   2. an optional server-colocated worker for encoder-only kinds — today
 *      `reembed-book`, since the Node side has the ONNX embedding runtime in
 *      repo while the app does not (yet). Encoder inference is the safe lane
 *      on the shared host; this is NOT the guarded F4 LLM worker.
 *
 * Usage:
 *   FABRIC_TOKEN=<token> pnpm tsx scripts/fleet-worker.ts \
 *     [--url http://localhost:3000] [--once] [--ignore-eligibility]
 */
import { execSync } from "node:child_process";
import { embedBatch, EMBEDDING_MODEL } from "../app/lib/knowledge/embeddings";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const URL_BASE = arg("url", "http://localhost:3000");
const TOKEN = process.env.FABRIC_TOKEN || "";
const ONCE = process.argv.includes("--once");
const IGNORE_ELIGIBILITY = process.argv.includes("--ignore-eligibility");
const IDLE_SLEEP_MS = 15_000;
const MODEL_ID = EMBEDDING_MODEL; // the pinned local model — recorded on every artifact

if (!TOKEN) {
  console.error("FABRIC_TOKEN env var required (returned once at enrollment)");
  process.exit(1);
}

// The local LLM the judge uses. Ollama serves it at OLLAMA_URL; the model name
// is recorded as the artifact's modelId so a model swap is auditable.
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/+$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:3b-instruct";

const ALL_KINDS: Record<string, number> = {
  echo: 1,
  "reembed-book": 2,
  "extract-entities": 3,
  "kernel-wordstats": 1,
  "convert-pdf-ccd": 1,
  "convert-pdf-epub": 1,
  "judge-tension": 1,
  "classify-book": 1,
  "name-topic": 1,
};
// WORKER_ONLY_KINDS (comma-separated) restricts what this worker advertises, so
// you can drain a specific queue first (e.g. judge before classify) since the
// box leases by priority then age and both default to priority 0.
const onlyKinds = (process.env.WORKER_ONLY_KINDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const CAPABILITIES = {
  // "llm" is the generic local-LLM runtime (Ollama here, Apple Foundation Models
  // on iOS) — classify-book/judge-tension require it so any device with a capable
  // on-device model can take them. "ollama-judge" kept for back-compat.
  runtimes: ["echo", "onnx-embed", "gliner", "js-kernel", "ollama-judge", "llm"],
  // kind → implemented contract version (must match the handlers below).
  kinds: onlyKinds.length
    ? Object.fromEntries(onlyKinds.filter((k) => k in ALL_KINDS).map((k) => [k, ALL_KINDS[k]]))
    : ALL_KINDS,
  ramClass: 16,
};

/** Physical backpressure: the plug is the throttle. */
function eligible(): boolean {
  if (IGNORE_ELIGIBILITY) return true;
  if (process.platform !== "darwin") return true; // server-class worker
  try {
    const batt = execSync("pmset -g batt", { encoding: "utf8" });
    return batt.includes("AC Power");
  } catch {
    return true; // desktops without a battery
  }
}

function quantize(vec: Float32Array): { bytes: Buffer; scale: number } {
  let max = 1e-9;
  for (let i = 0; i < vec.length; i++) max = Math.max(max, Math.abs(vec[i]));
  const scale = max / 127;
  const bytes = Buffer.allocUnsafe(vec.length);
  for (let i = 0; i < vec.length; i++) bytes.writeInt8(Math.round(vec[i] / scale), i);
  return { bytes, scale };
}

interface Job {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
}

async function api(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${URL_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Fabric-Token": TOKEN },
    body: JSON.stringify(body ?? {}),
  });
  return (await res.json()) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// judge-tension (Reckoning adjudication) — local LLM via Ollama.
//
// The box mines candidate cross-book passage pairs that share a subject; this
// handler asks a local model to decide their relationship ABOUT that subject
// and to QUOTE verbatim spans that carry it. The server validator (kinds.ts)
// rejects any non-neutral verdict whose spans aren't real substrings of the
// passages, so the model is never trusted to assert a free-standing fact — it
// may only point at the owner's text. We do the same grounding check here and
// repair (retry / snap-to-source) before posting, downgrading to neutral as a
// last resort so a deserved POST never bounces off the validator.
// ---------------------------------------------------------------------------

interface JudgeRaw {
  verdict?: string;
  tension?: string;
  stanceQuestion?: string;
  spanA?: string;
  spanB?: string;
}

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
// to judge and faster to process on CPU.
const JUDGE_TEXT_CHARS = 800;
const clip = (s: string) => (s.length > JUDGE_TEXT_CHARS ? s.slice(0, JUDGE_TEXT_CHARS) : s);

// STAGE 1 — verdict only. A/B testing showed that bundling the verbatim-span
// requirement into this step pushes the small model toward false positives (once
// told to find quotable spans, it finds them and rationalizes a relationship).
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

/** Call the local Ollama chat endpoint with forced-JSON output, temperature 0. */
async function ollamaJudge(user: string): Promise<JudgeRaw> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: "json", // force the model to emit a single JSON object
        options: { temperature: 0 },
        messages: [
          { role: "system", content: JUDGE_SYSTEM },
          { role: "user", content: user },
        ],
      }),
    });
  } catch (e) {
    // Unreachable Ollama → throw a clear error so runOnce releases the lease
    // (the job goes back to the queue) instead of crashing the worker.
    throw new Error(
      `Ollama unreachable at ${OLLAMA_URL} (${(e as Error).message}). Is \`ollama serve\` running?`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ollama ${OLLAMA_URL} returned ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  const content = data?.message?.content ?? "";
  return parseJudgeJson(content);
}

/** Parse the model's JSON robustly: tolerate code fences and surrounding prose. */
function parseJudgeJson(raw: string): JudgeRaw {
  let text = (raw ?? "").trim();
  // Strip ```json … ``` (or bare ```) fences if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  try {
    return JSON.parse(text) as JudgeRaw;
  } catch {
    // Fall back to the first balanced-looking {...} blob.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as JudgeRaw;
      } catch {
        /* fall through */
      }
    }
    throw new Error(`Ollama did not return parseable JSON: ${text.slice(0, 160)}`);
  }
}

// ---------------------------------------------------------------------------
// classify-book — fiction/nonfiction labelling via the same local Ollama model.
//
// The box hands us a book's title, author, and a short text sample; the model
// returns exactly one of "fiction" / "nonfiction" with a confidence and a one-
// line reason. Same fetch shape and JSON parsing as the judge.
// ---------------------------------------------------------------------------

interface ClassifyRaw {
  category?: string;
  confidence?: number;
  reason?: string;
}

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

/** Call the local Ollama chat endpoint to label a book, forced-JSON, temperature 0. */
async function ollamaClassify(user: string): Promise<ClassifyRaw> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: "json", // force the model to emit a single JSON object
        options: { temperature: 0 },
        messages: [
          { role: "system", content: CLASSIFY_SYSTEM },
          { role: "user", content: user },
        ],
      }),
    });
  } catch (e) {
    // Unreachable Ollama → throw a clear error so runOnce releases the lease
    // (the job goes back to the queue) instead of crashing the worker.
    throw new Error(
      `Ollama unreachable at ${OLLAMA_URL} (${(e as Error).message}). Is \`ollama serve\` running?`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ollama ${OLLAMA_URL} returned ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  const content = data?.message?.content ?? "";
  return parseJudgeJson(content) as ClassifyRaw;
}

// ---------------------------------------------------------------------------
// name-topic — name a library "journey" (a theme that runs across several
// nonfiction books) via the same local Ollama model.
//
// The box hands us the journey's distinctive concepts plus a few sample
// excerpts; the model returns a short Title Case label and a one-sentence
// blurb. Same fetch shape and JSON parsing as the judge/classifier, but with a
// little temperature warmth since this is a naming (not a classification) task.
// ---------------------------------------------------------------------------

interface NameTopicRaw {
  label?: string;
  blurb?: string;
}

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

/** Call the local Ollama chat endpoint to name a topic, forced-JSON, a little warmth. */
async function ollamaNameTopic(user: string): Promise<NameTopicRaw> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: "json", // force the model to emit a single JSON object
        options: { temperature: 0.3 }, // a little warmth for naming
        messages: [
          { role: "system", content: NAME_TOPIC_SYSTEM },
          { role: "user", content: user },
        ],
      }),
    });
  } catch (e) {
    // Unreachable Ollama → throw a clear error so runOnce releases the lease
    // (the job goes back to the queue) instead of crashing the worker.
    throw new Error(
      `Ollama unreachable at ${OLLAMA_URL} (${(e as Error).message}). Is \`ollama serve\` running?`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ollama ${OLLAMA_URL} returned ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  const content = data?.message?.content ?? "";
  return parseJudgeJson(content) as NameTopicRaw;
}

const normForGround = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** Mirror of the server validator's grounding check (kinds.ts spanGrounded). */
function spanGrounded(span: string, text: string): boolean {
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
function snapToSource(span: string, text: string): string {
  const wanted = new Set(normForGround(span).split(" ").filter(Boolean));
  if (wanted.size === 0) return "";
  // Candidate windows: sentences, plus 12-word sliding windows for long prose.
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

const handlers: Record<string, (job: Job) => Promise<unknown>> = {
  echo: async (job) => ({ echoed: String(job.payload.text).toUpperCase() }),

  "judge-tension": async (job) => {
    const pairId = String(job.payload.pairId);
    const subject = String(job.payload.subject ?? "");
    const textA = String(job.payload.textA ?? "");
    const textB = String(job.payload.textB ?? "");

    // STAGE 1 — verdict only (no spans). Focused prompt + clipped text so the
    // small model judges the RELATIONSHIP cleanly (A/B showed span-hunting in
    // this step causes false positives).
    const v = await ollamaJudge(buildVerdictUser({ subject, textA, textB }));
    let verdict = String(v.verdict ?? "neutral").toLowerCase();
    if (!["agree", "contradict", "qualify", "neutral"].includes(verdict)) verdict = "neutral";
    let tension = String(v.tension ?? "");
    let stanceQuestion = String(v.stanceQuestion ?? "");

    let spanA = "";
    let spanB = "";

    // STAGE 2 — grounding. Only for a real relationship: ask for verbatim spans
    // that carry it, then repair/snap, downgrading to neutral if it can't ground.
    if (verdict !== "neutral" && tension.trim().length >= 8) {
      let sp = await ollamaJudge(buildSpanUser({ subject, verdict, tension, textA, textB }));
      spanA = String(sp.spanA ?? "");
      spanB = String(sp.spanB ?? "");
      // Repair step 1: retry once asking for exact copies.
      if (!spanGrounded(spanA, textA) || !spanGrounded(spanB, textB)) {
        console.log(`  [judge] ${pairId} spans ungrounded — retrying verbatim copy`);
        sp = await ollamaJudge(
          buildSpanUser({ subject, verdict, tension, textA, textB, emphasizeVerbatim: true }),
        );
        spanA = String(sp.spanA ?? spanA);
        spanB = String(sp.spanB ?? spanB);
      }
    }

    // Always validate a non-neutral verdict can be grounded (covers the
    // tension-too-short case where stage 2 was skipped).
    if (verdict !== "neutral") {
      // GROUNDING REPAIR step 2: snap each still-ungrounded span to the most
      // similar verbatim window in its source passage.
      if (!spanGrounded(spanA, textA)) spanA = snapToSource(spanA, textA) || spanA;
      if (!spanGrounded(spanB, textB)) spanB = snapToSource(spanB, textB) || spanB;

      // GROUNDING REPAIR step 3 (last resort): if it still can't be grounded,
      // downgrade to neutral so the server validator never rejects the result
      // (a neutral verdict needs no spans).
      if (!spanGrounded(spanA, textA) || !spanGrounded(spanB, textB) || tension.trim().length < 8) {
        console.log(`  [judge] ${pairId} ungrounded after repair — downgrading to neutral`);
        verdict = "neutral";
      }
    }

    if (verdict === "neutral") {
      spanA = "";
      spanB = "";
      tension = "";
      stanceQuestion = "";
    }

    console.log(`  [judge] ${pairId} → ${verdict}`);
    // __modelId records the actual Ollama model on the artifact (the global
    // MODEL_ID is the embedding model, wrong for an LLM judge).
    return {
      __result: { verdict, tension, stanceQuestion, spanA, spanB },
      __modelId: OLLAMA_MODEL,
    };
  },

  "classify-book": async (job) => {
    const title = String(job.payload.title ?? "");
    const author = String(job.payload.author ?? "");
    const sample = String(job.payload.sample ?? "");

    const parsed = await ollamaClassify(buildClassifyUser({ title, author, sample }));
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

    console.log(`  [classify] ${title.slice(0, 40)} → ${category} (${confidence})`);
    return { __result: { category, confidence, reason }, __modelId: OLLAMA_MODEL };
  },

  "name-topic": async (job) => {
    const concepts = Array.isArray(job.payload.concepts) ? job.payload.concepts.map(String) : [];
    const samples = Array.isArray(job.payload.samples) ? job.payload.samples.map(String) : [];

    const parsed = await ollamaNameTopic(buildNameTopicUser({ concepts, samples }));
    let label = String(parsed.label ?? "")
      .trim()
      .replace(/^["'#]+|["'.]+$/g, "")
      .trim();
    // clamp to the server validator's bounds (3-60 chars, <=7 words)
    if (label.split(/\s+/).length > 7) label = label.split(/\s+/).slice(0, 7).join(" ");
    const blurb = String(parsed.blurb ?? "")
      .trim()
      .slice(0, 200);

    console.log(`  [name-topic] → ${label}`);
    return { __result: { label, blurb }, __modelId: OLLAMA_MODEL };
  },

  "reembed-book": async (job) => {
    // v2: ids only — fetch texts by reference (same protocol as extraction).
    const wantedIds = job.payload.passageIds as string[];
    const pres = await fetch(`${URL_BASE}/api/fabric/passages/${job.payload.bookId}`, {
      headers: { "X-Fabric-Token": TOKEN },
    });
    if (!pres.ok) throw new Error(`passage fetch failed: ${pres.status}`);
    const pjson = (await pres.json()) as { passages: Array<{ id: string; text: string }> };
    const byId = new Map(pjson.passages.map((p) => [p.id, p]));
    if (wantedIds.some((id) => !byId.has(id))) {
      throw new Error("stale job: payload passage ids no longer exist");
    }
    const passages = wantedIds.map((id) => byId.get(id)!);
    const BATCH = 16;
    let dim = 0;
    const quantized: Buffer[] = [];
    const scales: number[] = [];
    for (let i = 0; i < passages.length; i += BATCH) {
      const vecs = await embedBatch(passages.slice(i, i + BATCH).map((p) => p.text));
      for (const v of vecs) {
        dim = v.length;
        const q = quantize(v);
        quantized.push(q.bytes);
        scales.push(q.scale);
      }
      // Long job: keep the lease alive (best-effort — a heartbeat that fails
      // because the box is mid-restart must not kill an hour of inference).
      if (i > 0 && i % (BATCH * 8) === 0) {
        await api(`/api/fabric/work/${job.id}/heartbeat`, {}).catch(() => {});
        console.log(`  [reembed] ${i}/${passages.length}`);
      }
    }
    return {
      count: passages.length,
      dim,
      vectorsB64: Buffer.concat(quantized).toString("base64"),
      scales,
    };
  },

  "extract-entities": async (job) => {
    const { extractEntitiesBatch, ensureGlinerReady } =
      await import("../app/lib/knowledge/gliner-extract");
    await ensureGlinerReady();
    // v3: payload carries ids only — fetch texts by reference and verify the
    // id set still matches (a re-analysis mints new ids → this job is stale).
    const wantedIds = job.payload.passageIds as string[];
    const pres = await fetch(`${URL_BASE}/api/fabric/passages/${job.payload.bookId}`, {
      headers: { "X-Fabric-Token": TOKEN },
    });
    if (!pres.ok) throw new Error(`passage fetch failed: ${pres.status}`);
    const pjson = (await pres.json()) as { passages: Array<{ id: string; text: string }> };
    const byId = new Map(pjson.passages.map((p) => [p.id, p]));
    if (wantedIds.some((id) => !byId.has(id))) {
      throw new Error("stale job: payload passage ids no longer exist");
    }
    const passages = wantedIds.map((id) => byId.get(id)!);
    const BATCH = 8;
    const entities: unknown[][] = [];
    for (let i = 0; i < passages.length; i += BATCH) {
      const batch = await extractEntitiesBatch(passages.slice(i, i + BATCH).map((p) => p.text));
      for (const list of batch) {
        entities.push(
          list.map((e) => ({
            name: e.name,
            type: e.type,
            score: e.score,
            surfaceText: e.surfaceText,
            charStart: e.charStart,
            charEnd: e.charEnd,
          })),
        );
      }
      if (i > 0 && i % (BATCH * 16) === 0) {
        // Best-effort: the box restarting mid-extraction must not waste the run.
        await api(`/api/fabric/work/${job.id}/heartbeat`, {}).catch(() => {});
        console.log(`  [extract] ${i}/${passages.length}`);
      }
    }
    return { entities };
  },
};

/**
 * Generic js-kernel host: fetch the bundle by content hash (verify before
 * executing — household trust still checks integrity), cache it, import it,
 * run its default export. Any kind whose payload carries kernelHash is
 * servable here with zero new handler code.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";

async function runKernel(job: Job): Promise<unknown> {
  const hash = String(job.payload.kernelHash);
  const cacheDir = joinPath(tmpdir(), "compendus-kernels");
  mkdirSync(cacheDir, { recursive: true });
  const cached = joinPath(cacheDir, `${hash}.mjs`);
  if (!existsSync(cached)) {
    const res = await fetch(`${URL_BASE}/api/fabric/kernels/${hash}`, {
      headers: { "X-Fabric-Token": TOKEN },
    });
    if (!res.ok) throw new Error(`kernel fetch failed: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== hash) throw new Error("kernel hash mismatch — refusing to execute");
    writeFileSync(cached, bytes);
  }
  const mod = await import(cached);
  // Large inputs ride as references, not inline payload: download with the
  // device token and inject bytes for the (pure) kernel.
  if (typeof job.payload.fileRef === "string") {
    const fres = await fetch(`${URL_BASE}${job.payload.fileRef}`, {
      headers: { "X-Fabric-Token": TOKEN },
    });
    if (!fres.ok) throw new Error(`file fetch failed: ${fres.status}`);
    job.payload.__bytes = await fres.arrayBuffer();
  }
  // Long kernels (a 400-page PDF→EPUB runs minutes) must outlive the 10-min
  // lease TTL: heartbeat while the kernel computes or the item re-queues
  // mid-conversion and the result POST 409s, wasting the whole run.
  const beat = setInterval(() => {
    api(`/api/fabric/work/${job.id}/heartbeat`, {}).catch(() => {});
  }, 120_000);
  let out: {
    artifactJson?: string;
    artifactBytes?: Uint8Array;
    mime?: string;
    result?: Record<string, unknown>;
  };
  try {
    out = (await mod.default(job.payload)) as typeof out;
  } finally {
    clearInterval(beat);
  }
  // Kernels with big outputs return artifactJson (text) or artifactBytes
  // (binary, e.g. an EPUB — RAW bytes, never base64: the kernel return is an
  // in-process value, and base64 of a GB-scale artifact exceeds V8's max
  // string length); the host uploads the blob and completes with the hash.
  const body: string | Buffer | null =
    out && typeof out.artifactJson === "string"
      ? out.artifactJson
      : out && out.artifactBytes instanceof Uint8Array
        ? Buffer.from(
            out.artifactBytes.buffer,
            out.artifactBytes.byteOffset,
            out.artifactBytes.byteLength,
          )
        : null;
  if (body !== null) {
    const up = await fetch(`${URL_BASE}/api/fabric/work/${job.id}/artifact`, {
      method: "POST",
      headers: {
        "X-Fabric-Token": TOKEN,
        "Content-Type":
          out.mime ?? (typeof body === "string" ? "application/json" : "application/octet-stream"),
      },
      // Node's fetch accepts Buffer bodies; the DOM lib types don't know that.
      body: body as BodyInit,
    });
    const uj = (await up.json()) as { artifactHash?: string };
    if (!uj.artifactHash) throw new Error("artifact upload failed");
    return {
      __result: { ...out.result, artifactHash: uj.artifactHash },
      __artifactHash: uj.artifactHash,
    };
  }
  return out;
}

async function runOnce(): Promise<boolean> {
  const leased = await api("/api/fabric/lease", { capabilities: CAPABILITIES });
  const job = leased.job as Job | null;
  if (!job) return false;

  console.log(`[fleet] leased ${job.kind} ${job.id}`);
  const handler = job.payload?.kernelHash ? runKernel : handlers[job.kind];
  if (!handler) {
    await api(`/api/fabric/work/${job.id}/release`, { reason: `no handler for ${job.kind}` });
    return true;
  }
  try {
    const t0 = Date.now();
    const raw = (await handler(job)) as Record<string, unknown> | null;
    const wrapped = raw && typeof raw === "object" && "__result" in raw;
    const result = wrapped ? (raw as { __result: unknown }).__result : raw;
    const artifactHash = wrapped ? (raw as { __artifactHash?: string }).__artifactHash : undefined;
    // A handler may pin its own modelId (e.g. the Ollama judge records the LLM
    // name, not the pinned embedding model); fall back to the global default.
    const modelId = (wrapped && (raw as { __modelId?: string }).__modelId) || MODEL_ID;
    // The result is already computed — a transient box hiccup (CPU-starved
    // event loop → proxy serves an HTML error page) must not waste the run.
    // Retry the POST with backoff before surrendering the lease.
    let out: Record<string, unknown> | null = null;
    for (let attempt = 0, delays = [10_000, 30_000, 60_000]; ; attempt++) {
      try {
        out = await api(`/api/fabric/work/${job.id}/result`, {
          result,
          modelId,
          ...(artifactHash ? { artifactHash, mime: "application/json" } : {}),
        });
        break;
      } catch (postErr) {
        if (attempt >= delays.length) throw postErr;
        console.warn(
          `[fleet] result POST failed (${(postErr as Error).message}) — retry in ${delays[attempt] / 1000}s`,
        );
        await new Promise((r) => setTimeout(r, delays[attempt]));
      }
    }
    console.log(
      `[fleet] ${out.success ? "completed" : `rejected: ${out.error}`} ${job.id} in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
  } catch (err) {
    await api(`/api/fabric/work/${job.id}/release`, { reason: (err as Error).message }).catch(
      () => {},
    );
    console.error(`[fleet] released ${job.id}: ${(err as Error).message}`);
  }
  return true;
}

console.log(
  `[fleet] worker against ${URL_BASE} (model: ${MODEL_ID}; eligibility ${IGNORE_ELIGIBILITY ? "IGNORED" : "AC-power gated"})`,
);
for (;;) {
  if (!eligible()) {
    if (ONCE) break;
    console.log("[fleet] not on AC power — sleeping");
    await new Promise((r) => setTimeout(r, IDLE_SLEEP_MS * 4));
    continue;
  }
  let didWork = false;
  try {
    didWork = await runOnce();
  } catch (e) {
    // Server restarts mid-deploy return HTML/5xx; a long-lived worker rides
    // it out instead of dying on a JSON parse.
    console.warn(`[fleet] cycle failed (${e instanceof Error ? e.message : e}) — backing off 30s`);
    if (!ONCE) await new Promise((r) => setTimeout(r, 30_000));
  }
  if (ONCE && !didWork) break;
  if (!didWork) await new Promise((r) => setTimeout(r, IDLE_SLEEP_MS));
}
console.log("[fleet] done (--once)");
