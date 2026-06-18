/**
 * Trivial fabric worker — F1's protocol prover. No models, no eligibility gates:
 * it leases, handles the `echo` kind, and posts results, exercising the full
 * lease/heartbeat/result/release loop against a running server.
 *
 * Real workers (macOS menubar agent, iOS BGProcessingTask) implement this same
 * loop with eligibility gating (charging/AC + idle + thermal) and real handlers.
 *
 * Usage:
 *   FABRIC_TOKEN=<token> pnpm tsx scripts/fabric-worker.ts [--url http://localhost:3000] [--once]
 *
 * Enroll first (admin profile):
 *   curl -X POST <url>/api/fabric/devices -H 'X-Profile-Id: <adminProfileId>' \
 *     -H 'Content-Type: application/json' \
 *     -d '{"name":"trivial-worker","platform":"server","capabilities":{"runtimes":["echo"]}}'
 */

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const URL_BASE = arg("url", "http://localhost:3000");
const TOKEN = process.env.FABRIC_TOKEN || "";
const ONCE = process.argv.includes("--once");
const IDLE_SLEEP_MS = 5_000;

if (!TOKEN) {
  console.error("FABRIC_TOKEN env var required (returned once at enrollment)");
  process.exit(1);
}

const CAPABILITIES = { runtimes: ["echo"], ramClass: 8 };
const MODEL_ID = "trivial-worker/none";

type Job = { id: string; kind: string; payload: Record<string, unknown> };

// Handlers for the kinds this worker can run. Real workers register real model
// calls here; the contract is identical.
const handlers: Record<string, (payload: Record<string, unknown>) => Promise<unknown>> = {
  echo: async (payload) => ({ echoed: String(payload.text).toUpperCase() }),
};

async function api(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${URL_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Fabric-Token": TOKEN },
    body: JSON.stringify(body ?? {}),
  });
  return (await res.json()) as Record<string, unknown>;
}

async function runOnce(): Promise<boolean> {
  const leased = await api("/api/fabric/lease", { capabilities: CAPABILITIES });
  const job = leased.job as Job | null;
  if (!job) return false;

  console.log(`[worker] leased ${job.kind} ${job.id}`);
  const handler = handlers[job.kind];
  if (!handler) {
    await api(`/api/fabric/work/${job.id}/release`, { reason: `no handler for ${job.kind}` });
    return true;
  }
  try {
    const result = await handler(job.payload);
    const out = await api(`/api/fabric/work/${job.id}/result`, { result, modelId: MODEL_ID });
    console.log(`[worker] ${out.success ? "completed" : `rejected: ${out.error}`} ${job.id}`);
  } catch (err) {
    await api(`/api/fabric/work/${job.id}/release`, { reason: (err as Error).message });
    console.error(`[worker] released ${job.id}: ${(err as Error).message}`);
  }
  return true;
}

console.log(`[worker] fabric worker against ${URL_BASE} (${ONCE ? "single pass" : "looping"})`);
for (;;) {
  const didWork = await runOnce();
  if (ONCE && !didWork) break;
  if (!didWork) await new Promise((r) => setTimeout(r, IDLE_SLEEP_MS));
}
console.log("[worker] queue drained, exiting (--once)");
