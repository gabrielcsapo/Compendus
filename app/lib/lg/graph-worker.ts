/**
 * lg graph worker — the CPU-heavy learning-graph passes, off the web thread
 * (concept-ingest-worker pattern). Commands:
 *
 *   {cmd:"knn-candidates", threshold, maxPairs} → {type:"done", pairs, truncated}
 *   {cmd:"form-themes"}                         → {type:"done", ...FormThemesResult}
 */
import { parentPort } from "node:worker_threads";
import { inlineKnnCandidates } from "./inline-knn";
import { formThemes } from "./themes";

interface KnnMsg {
  cmd: "knn-candidates";
  threshold: number;
  maxPairs: number;
}
interface ThemesMsg {
  cmd: "form-themes";
}

parentPort?.on("message", (msg: KnnMsg | ThemesMsg) => {
  try {
    if (msg.cmd === "knn-candidates") {
      const out = inlineKnnCandidates(msg.threshold, msg.maxPairs, (done, total, pairs) =>
        parentPort?.postMessage({ type: "progress", done, total, pairs }),
      );
      parentPort?.postMessage({ type: "done", ...out });
    } else if (msg.cmd === "form-themes") {
      const out = formThemes((line) => parentPort?.postMessage({ type: "progress", line }));
      parentPort?.postMessage({ type: "done", ...out });
    } else {
      parentPort?.postMessage({ type: "error", error: "unknown cmd" });
    }
  } catch (e) {
    parentPort?.postMessage({ type: "error", error: e instanceof Error ? e.message : String(e) });
  }
});
