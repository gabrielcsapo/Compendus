/**
 * Worker-thread entry for the concept backfill AND topic rebuild.
 *
 * better-sqlite3 is synchronous, so running either on the main thread blocks
 * the HTTP server in bursts (low CPU, dead UI — the single busy thread is
 * pinned-then-blocked on disk I/O, not the machine). Here they run on their
 * own thread with their own DB connection; WAL + busy_timeout make the
 * concurrent writes safe while the main thread keeps serving requests.
 */
import { parentPort } from "node:worker_threads";
import { ingestAllBooks } from "./ingest";
import { rebuildTopics } from "./graph";

const errStr = (e: unknown) => (e instanceof Error ? e.message : String(e));

parentPort?.on("message", (msg: { cmd: string }) => {
  if (msg?.cmd === "backfill") {
    ingestAllBooks((p) => parentPort?.postMessage({ type: "progress", ...p }))
      .then((res) => parentPort?.postMessage({ type: "done", ...res }))
      .catch((err) => parentPort?.postMessage({ type: "error", error: errStr(err) }));
  } else if (msg?.cmd === "topics") {
    try {
      const res = rebuildTopics((line) => parentPort?.postMessage({ type: "progress", line }));
      parentPort?.postMessage({ type: "done", ...res });
    } catch (err) {
      parentPort?.postMessage({ type: "error", error: errStr(err) });
    }
  }
});
