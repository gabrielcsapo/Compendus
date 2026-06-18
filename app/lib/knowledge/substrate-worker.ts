/**
 * Worker-thread entry for substrate structure rebuilds.
 *
 * rebuildStructure is minutes of synchronous brute-force math (O(N²) kNN over
 * every passage vector) — on the main thread it blocks the event loop and the
 * whole HTTP server goes dark for the duration (the recurring "box
 * unreachable" blackouts during bulk analysis). Running it here keeps the
 * server responsive; SQLite WAL + busy_timeout make the concurrent writes
 * safe, and the rebuild's own writes are a short transaction at the end of
 * the long compute.
 */
import { parentPort } from "node:worker_threads";
import { rebuildStructure } from "./substrate";

parentPort?.on("message", (msg: { cmd: string }) => {
  if (msg?.cmd !== "rebuild") return;
  rebuildStructure((line) => parentPort?.postMessage({ type: "progress", line }))
    .then((stats) => parentPort?.postMessage({ type: "done", stats }))
    .catch((err) =>
      parentPort?.postMessage({
        type: "error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
});
