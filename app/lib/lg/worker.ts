/**
 * Spawn helper for the lg graph worker (runConceptWorker pattern): CPU-heavy
 * passes run in a worker thread with their own DB connection and a heap cap;
 * inline fallback (blocking — dev/test only) when the dist bundle is missing.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const WORKER_PATH = resolve(process.cwd(), "dist/worker/lg-graph-worker.mjs");

export async function runLgWorker(
  cmd: "knn-candidates" | "form-themes",
  payload: Record<string, unknown> = {},
  onProgress?: (info: Record<string, unknown>) => void,
): Promise<Record<string, unknown>> {
  if (!existsSync(WORKER_PATH)) {
    // Inline fallback: correct but runs on the calling thread (blocks the
    // event loop for the duration) — acceptable in dev/tests only.
    if (cmd === "form-themes") {
      const { formThemes } = await import("./themes");
      return formThemes((line) => onProgress?.({ line })) as unknown as Record<string, unknown>;
    }
    const { inlineKnnCandidates } = await import("./inline-knn");
    return inlineKnnCandidates(
      Number(payload.threshold ?? 0.85),
      Number(payload.maxPairs ?? 20_000),
    ) as unknown as Record<string, unknown>;
  }

  const { Worker } = await import("node:worker_threads");
  return new Promise((resolvePromise, rejectPromise) => {
    const worker = new Worker(WORKER_PATH, {
      resourceLimits: { maxOldGenerationSizeMb: 2048 },
    });
    const fail = (err: Error) => {
      worker.terminate().catch(() => {});
      rejectPromise(err);
    };
    worker.on("message", (msg: Record<string, unknown>) => {
      if (msg.type === "progress") onProgress?.(msg);
      else if (msg.type === "done") {
        worker.terminate().catch(() => {});
        resolvePromise(msg);
      } else if (msg.type === "error") {
        fail(new Error(String(msg.error)));
      }
    });
    worker.on("error", fail);
    worker.postMessage({ cmd, ...payload });
  });
}
