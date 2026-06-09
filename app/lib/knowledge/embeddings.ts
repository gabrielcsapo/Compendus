/**
 * Passage / text embeddings for semantic neighbors and entity resolution.
 *
 * Uses all-MiniLM-L6-v2 via @huggingface/transformers (ONNX, CPU). Vectors are
 * L2-normalized, so cosine similarity is a plain dot product. For a personal
 * library (a few thousand passages) brute-force search is instant and avoids a
 * native sqlite-vec dependency; swap in an index later only if it ever matters.
 */
import { resolve } from "path";

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DIM = 384;

type Extractor = (
  text: string | string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

let extractorPromise: Promise<Extractor> | null = null;

async function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      // Model is shipped in the repo (models/) and loaded from disk — never
      // fetched from HuggingFace at runtime. The deploy container has no need
      // for outbound network access to embed.
      env.allowRemoteModels = false;
      env.localModelPath = resolve(process.cwd(), "models");
      // Pin onnxruntime to a single intra-op thread. Its default thread pool
      // deadlocks under container cgroup CPU limits (embedding froze mid-run on
      // the deploy box while running fine on the host). Sequential execution is
      // plenty fast for MiniLM and is deadlock-proof; this is scoped to the
      // embedding session only.
      const pipe = await pipeline("feature-extraction", EMBEDDING_MODEL, {
        dtype: "q8",
        session_options: {
          intraOpNumThreads: 1,
          interOpNumThreads: 1,
          executionMode: "sequential",
        },
      });
      return pipe as unknown as Extractor;
    })();
  }
  return extractorPromise;
}

/** Embed a single string into a normalized 384-d vector. */
export async function embed(text: string): Promise<Float32Array> {
  const extractor = await getExtractor();
  const out = await extractor(text, { pooling: "mean", normalize: true });
  return Float32Array.from(out.data.subarray(0, EMBEDDING_DIM));
}

/** Embed many strings in one forward pass; returns one vector per input. */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const out = await extractor(texts, { pooling: "mean", normalize: true });
  const dim = out.dims[out.dims.length - 1];
  const result: Float32Array[] = [];
  for (let i = 0; i < texts.length; i++) {
    result.push(Float32Array.from(out.data.subarray(i * dim, (i + 1) * dim)));
  }
  return result;
}

// --- storage helpers (Float32 <-> SQLite BLOB) ---------------------------------

export function vectorToBuffer(v: Float32Array): Buffer {
  const buf = Buffer.allocUnsafe(v.length * 4);
  for (let i = 0; i < v.length; i++) buf.writeFloatLE(v[i], i * 4);
  return buf;
}

export function bufferToVector(b: Buffer): Float32Array {
  const v = new Float32Array(b.length / 4);
  for (let i = 0; i < v.length; i++) v[i] = b.readFloatLE(i * 4);
  return v;
}

// --- similarity ----------------------------------------------------------------

/** Cosine similarity. Inputs from embed() are normalized, so this is a dot product. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}
