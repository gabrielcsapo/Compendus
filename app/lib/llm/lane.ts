/**
 * The LLM lane — one serial in-process queue for long-running LLM batch passes
 * (classification, tension judging, topic naming, learning-graph ingestion).
 *
 * Why its own lane instead of background_jobs: Ollama is its own resource with
 * its own container, and a multi-hour grind must never block reader-facing
 * convert/ccd jobs. Chaining every pass on ONE promise chain also guarantees a
 * single in-flight Ollama request stream, which is how a one-GPU/one-model
 * server wants to be fed.
 *
 * Passes are fire-and-continue: the HTTP trigger returns immediately and the
 * caller polls a /status endpoint. State is in-memory only — a restart forgets
 * progress, which is fine because every pass is resumable (its selection SQL
 * skips rows that already have results).
 */

export interface PassStatus {
  running: boolean;
  /** Waiting behind another pass on the lane (queued but not yet started). */
  pending: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  processed: number;
  total: number;
  /** Free-form progress note (e.g. the item currently being worked). */
  note: string | null;
  result: unknown;
  error: string | null;
}

const emptyStatus = (): PassStatus => ({
  running: false,
  pending: false,
  startedAt: null,
  finishedAt: null,
  processed: 0,
  total: 0,
  note: null,
  result: null,
  error: null,
});

// One chain for ALL passes — never awaited by HTTP handlers, never rejected
// (each link swallows its own error into its status object).
let laneChain: Promise<unknown> = Promise.resolve();
const statusByName = new Map<string, PassStatus>();

/** Hand control back to the event loop between items (house rule for passes). */
export const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

/**
 * Queue a pass onto the lane. Refuses if a pass with the same name is already
 * running or waiting. `fn` receives the live status object: bump `processed`,
 * set `note`, and `await tick()` between items.
 */
export function startPass(
  name: string,
  fn: (status: PassStatus) => Promise<unknown>,
): { started: boolean; reason?: string } {
  const existing = statusByName.get(name);
  if (existing && (existing.running || existing.pending)) {
    return { started: false, reason: `${name} already ${existing.running ? "running" : "queued"}` };
  }
  const status = emptyStatus();
  status.pending = true;
  statusByName.set(name, status);

  laneChain = laneChain.then(async () => {
    status.pending = false;
    status.running = true;
    status.startedAt = Date.now();
    try {
      status.result = await fn(status);
    } catch (e) {
      status.error = e instanceof Error ? e.message : String(e);
    } finally {
      status.running = false;
      status.finishedAt = Date.now();
    }
  });
  return { started: true };
}

/** Current status of a named pass (empty status if it never ran). */
export function passStatus(name: string): PassStatus {
  return statusByName.get(name) ?? emptyStatus();
}
