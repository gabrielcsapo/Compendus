/**
 * Entity extraction via GLiNER — a lightweight encoder NER model.
 *
 * Replaces the 3B generative model for the entity pass: GLiNER does ONE forward
 * pass per passage (like the embeddings), so extracting a whole book takes
 * seconds instead of hours and never pegs the CPU / locks up the shared host the
 * way an autoregressive LLM does. It classifies into our closed label set
 * directly and returns character spans (great for provenance).
 *
 * Tokenizer/config ship in the repo (models/); the ~180MB ONNX model downloads
 * once into the data volume (too big for git).
 */
import { resolve } from "path";
import { existsSync, mkdirSync } from "fs";
import { spawn } from "child_process";
import { ENTITY_TYPES, type EntityType } from "../db/schema";

const MODELS_DIR = resolve(process.cwd(), "models");
const GLINER_TOKENIZER = "onnx-community/gliner_small-v2";
const MODELS_DATA_DIR = resolve(process.cwd(), "data", "models");
const MODEL_PATH = resolve(MODELS_DATA_DIR, "gliner_small-v2_quantized.onnx");
const MODEL_URL =
  process.env.GLINER_MODEL_URL ||
  "https://huggingface.co/onnx-community/gliner_small-v2/resolve/main/onnx/model_quantized.onnx";

const THRESHOLD = parseFloat(process.env.GLINER_THRESHOLD || "0.5");

/** Person/place/organization should be proper nouns; bare common nouns there are noise. */
const PROPER_TYPES = new Set<string>(["person", "place", "organization"]);

/** Generic nouns GLiNER tags as entities in almost any book — pure noise to drop. */
const STOPWORDS = new Set<string>([
  "system",
  "systems",
  "world",
  "people",
  "person",
  "thing",
  "things",
  "way",
  "ways",
  "time",
  "times",
  "place",
  "places",
  "part",
  "parts",
  "number",
  "numbers",
  "group",
  "groups",
  "company",
  "companies",
  "government",
  "student",
  "students",
  "resource",
  "resources",
  "book",
  "behavior",
  "example",
  "examples",
  "year",
  "years",
  "day",
  "days",
  "case",
  "cases",
  "point",
  "points",
  "problem",
  "problems",
  "idea",
  "ideas",
  "fact",
  "facts",
  "result",
  "results",
  "process",
  "state",
  "university",
  "country",
  "city",
  "man",
  "woman",
  "child",
  "children",
  "life",
  "area",
  "kind",
  "type",
  "form",
  "level",
  "amount",
  "rule",
  "rules",
  "member",
  "members",
  "set",
  "word",
  "words",
  "name",
  "names",
]);

/**
 * Clause verbs. GLiNER sometimes returns a subject+verb fragment ("Kleinsorge
 * said", "Father Kleinsorge went") as a span — never a real entity name. If any
 * token is one of these, the span is a sentence fragment, not an entity.
 */
const VERB_TOKENS = new Set<string>([
  "said",
  "says",
  "say",
  "told",
  "tells",
  "asked",
  "asks",
  "replied",
  "replies",
  "went",
  "goes",
  "gone",
  "came",
  "comes",
  "looked",
  "looks",
  "thought",
  "thinks",
  "knew",
  "knows",
  "saw",
  "sees",
  "felt",
  "feels",
  "took",
  "takes",
  "made",
  "makes",
  "gave",
  "gives",
  "found",
  "finds",
  "called",
  "calls",
  "seemed",
  "seems",
  "wanted",
  "wants",
  "began",
  "begins",
  "walked",
  "walks",
  "ran",
  "runs",
  "stood",
  "stands",
  "sat",
  "sits",
  "turned",
  "turns",
  "heard",
  "hears",
  "left",
  "leaves",
  "kept",
  "keeps",
  "held",
  "holds",
  "became",
  "becomes",
  "wrote",
  "writes",
  "decided",
  "noticed",
  "realized",
  "remembered",
  "wondered",
]);

/** Honorifics that mark a *person* — a concept/theme span starting with one is a
 *  misclassified person, not an abstract idea. */
const HONORIFIC_TOKENS = new Set<string>([
  "mr",
  "mrs",
  "ms",
  "miss",
  "dr",
  "prof",
  "professor",
  "sir",
  "lord",
  "lady",
  "dame",
  "father",
  "fr",
  "rev",
  "reverend",
  "st",
  "saint",
  "mother",
  "sister",
  "brother",
  "captain",
  "capt",
  "colonel",
  "col",
  "general",
  "major",
  "lieutenant",
  "lt",
  "sergeant",
  "sgt",
  "president",
  "king",
  "queen",
  "emperor",
  "empress",
  "pope",
  "mister",
  "madam",
  "madame",
]);

/** Span types that should be abstract ideas, where a titled-person span is noise. */
const ABSTRACT_TYPES = new Set<string>(["concept", "theme"]);

/**
 * Whether a GLiNER span is noise rather than a real entity:
 *  - contains a clause verb (it's a sentence fragment), or
 *  - is typed as an abstract idea but begins with a personal honorific (a
 *    misclassified person leaking into the concept space).
 */
export function isNoiseSpan(name: string, type: string): boolean {
  const tokens = name
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[.,;:'"]+$/g, ""));
  if (tokens.some((t) => VERB_TOKENS.has(t))) return true;
  if (ABSTRACT_TYPES.has(type) && HONORIFIC_TOKENS.has(tokens[0])) return true;
  return false;
}

export interface GlinerEntity {
  name: string;
  type: EntityType;
  surfaceText: string;
  charStart: number;
  charEnd: number;
  score: number;
}

interface RawSpan {
  spanText: string;
  start: number;
  end: number;
  label: string;
  score: number;
}
interface GlinerModel {
  inference(args: {
    texts: string[];
    entities: string[];
    threshold?: number;
    flatNer?: boolean;
  }): Promise<RawSpan[][]>;
}

async function ensureModel(onLog?: (line: string) => void): Promise<void> {
  if (existsSync(MODEL_PATH)) return;
  mkdirSync(MODELS_DATA_DIR, { recursive: true });
  onLog?.("Downloading GLiNER model (~180MB, first run only)…");
  await new Promise<void>((res, rej) => {
    const p = spawn("curl", ["-L", "--fail", "-o", MODEL_PATH, MODEL_URL], { stdio: "pipe" });
    p.on("close", (code) =>
      code === 0 ? res() : rej(new Error(`GLiNER model download failed (curl exit ${code})`)),
    );
    p.on("error", (e) => rej(new Error(`Failed to start curl: ${e.message}`)));
  });
  if (!existsSync(MODEL_PATH)) throw new Error("GLiNER model download completed but file missing");
}

let modelPromise: Promise<GlinerModel> | null = null;

async function getModel(onLog?: (line: string) => void): Promise<GlinerModel> {
  if (!modelPromise) {
    modelPromise = (async () => {
      await ensureModel(onLog);
      // Tokenizer loads from the shipped local files — never fetch from HF.
      const xenova = await import("@xenova/transformers");
      xenova.env.allowRemoteModels = false;
      xenova.env.localModelPath = MODELS_DIR;
      // gliner/node creates its ORT session with NO options, so onnxruntime
      // spawns a thread pool sized to the HOST's cores — on the shared box
      // that oversubscribes the container (observed 280%+ CPU), starves the
      // HTTP server, and crowds sibling apps. The library doesn't expose
      // session options, so wrap InferenceSession.create to inject the same
      // proven-safe threading we use for the embedding session. Tunable via
      // GLINER_INTRA_OP_THREADS (default 2: ~half the box, server stays alive).
      // pnpm's strict layout hides gliner's onnxruntime-node from app code;
      // resolve it THROUGH gliner so we patch the exact module instance the
      // library will import (CJS exports object is shared with ESM import).
      const { createRequire } = await import("node:module");
      const requireFromHere = createRequire(import.meta.url);
      const requireFromGliner = createRequire(requireFromHere.resolve("gliner/node"));
      const ort = requireFromGliner("onnxruntime-node") as typeof import("onnxruntime-common");
      const sessionFactory = ort.InferenceSession as unknown as {
        create: (path: unknown, opts?: Record<string, unknown>) => Promise<unknown>;
        __compendusPinned?: boolean;
      };
      if (!sessionFactory.__compendusPinned) {
        const origCreate = sessionFactory.create.bind(ort.InferenceSession);
        sessionFactory.create = (path: unknown, opts?: Record<string, unknown>) =>
          origCreate(path, {
            // Default 1: the deploy container has a 2-core cgroup quota, and
            // 2 inference threads + the event loop exhaust it — CFS throttling
            // then freezes ALL threads (the "box unreachable" blackouts).
            // Raise via env when the container gets more cores.
            intraOpNumThreads: parseInt(process.env.GLINER_INTRA_OP_THREADS || "1", 10),
            interOpNumThreads: 1,
            executionMode: "sequential",
            ...opts,
          });
        sessionFactory.__compendusPinned = true;
      }
      const { Gliner } = await import("gliner/node");
      const model = new Gliner({
        tokenizerPath: GLINER_TOKENIZER,
        onnxSettings: { modelPath: MODEL_PATH },
        transformersSettings: { allowLocalModels: true },
        maxWidth: 12,
        modelType: "span-level",
      } as never);
      await (model as { initialize(): Promise<void> }).initialize();
      return model as unknown as GlinerModel;
    })();
    modelPromise.catch(() => {
      modelPromise = null;
    });
  }
  return modelPromise;
}

const LABELS = [...ENTITY_TYPES];
const VALID = new Set<string>(ENTITY_TYPES);

/** Whether GLiNER is ready (model present or downloadable). Loads lazily. */
export async function ensureGlinerReady(onLog?: (line: string) => void): Promise<void> {
  await getModel(onLog);
}

/**
 * Extract typed entities from a batch of passages in one forward pass. Returns
 * one entity array per input text, with character offsets within that passage.
 */
export async function extractEntitiesBatch(texts: string[]): Promise<GlinerEntity[][]> {
  if (texts.length === 0) return [];
  const model = await getModel();
  const results = await model.inference({ texts, entities: LABELS, threshold: THRESHOLD });
  return results.map((spans) => {
    const out: GlinerEntity[] = [];
    const seen = new Set<string>();
    for (const s of spans) {
      const name = s.spanText.trim();
      const type = s.label as EntityType;
      if (name.length < 3 || name.length > 120 || !VALID.has(type)) continue;
      const lower = name.toLowerCase();
      if (STOPWORDS.has(lower)) continue;
      if (isNoiseSpan(name, type)) continue;
      // person/place/organization must look like proper nouns (have a capital).
      if (PROPER_TYPES.has(type) && !/\p{Lu}/u.test(name)) continue;
      const key = `${type}:${lower}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        name,
        type,
        surfaceText: s.spanText,
        charStart: s.start,
        charEnd: s.end,
        score: s.score,
      });
    }
    return out;
  });
}
