/**
 * Idle Fleet compute fabric — queue semantics (wander-semantic-substrate-proposal.md §12).
 *
 * Pull-based work queue for charging/idle devices. Server-side this module owns:
 * enqueue (with content-addressed dedupe), lease (with lazy expiry reaping and
 * capability matching), heartbeat, complete (validation + artifact registration),
 * and graceful release. Workers are authenticated by device token at the route
 * layer; everything here takes a verified deviceId.
 *
 * Invariants:
 *  - At-least-once: a vanished worker's lease expires and the item re-queues.
 *  - Idempotent: enqueue dedupes on sha256(kind + stable payload); a completed
 *    item's result is returned instead of re-running the work.
 *  - Validated: results pass the kind's registered validator or the attempt fails.
 *  - Backpressure is physical: workers hold one lease at a time; the server
 *    never pushes.
 */
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { and, asc, desc, eq, lt, sql as dsql } from "drizzle-orm";
import { db, workItems, fabricDevices, fabricArtifacts } from "../db";
import type { WorkItem, FabricDevice } from "../db";

export const LEASE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;

// --- kind registry ---------------------------------------------------------------

export interface DeviceCapabilities {
  runtimes?: string[]; // e.g. ["onnx", "foundation-models", "mlx", "kokoro"]
  /**
   * Job kinds this worker has handlers for, with the CONTRACT VERSION each
   * handler implements. A worker never leases a kind it didn't declare, nor a
   * job whose contract is newer than its handler — so payload/result changes
   * are a server-side version bump, and stale builds simply stop matching
   * instead of burning attempts. Legacy forms accepted: string[] (versions
   * assumed 1) or absent (any kind — protocol-era workers).
   */
  kinds?: string[] | Record<string, number>;
  ramClass?: number; // GB, coarse
}

export interface WorkRequirements {
  runtimes?: string[]; // every listed runtime must be present on the worker
  /** Contract version of the kind at enqueue time (stamped by enqueueWork). */
  kindVersion?: number;
  minRamClass?: number;
  estMinutes?: number; // phone-targeted kinds must keep this ≤ 2
}

export interface KindDefinition {
  kind: string;
  project: string;
  /**
   * Contract version. Bump whenever the payload or result shape changes in a
   * way old handlers can't serve; workers declaring an older version stop
   * leasing these jobs until they update.
   */
  version?: number;
  /** Structural validation — the consistency guarantee regardless of which model produced the result. */
  validate: (payload: unknown, result: unknown) => { ok: true } | { ok: false; error: string };
  /**
   * Optional server-side effect after a validated completion — e.g.
   * reembed-book writes the returned vectors into the substrate. Runs inside
   * completeWork (awaited); a throw fails the attempt (the work re-queues).
   */
  apply?: (
    payload: unknown,
    result: unknown,
    ctx: { modelId: string; artifactPath?: string },
  ) => void | Promise<void>;
  /**
   * Called once when an item PERMANENTLY fails (burns out its attempts via
   * expired leases, rejected results, apply throws, or handler releases).
   * Fire-and-continue kinds use this to surface the failure where their
   * domain tracks state — e.g. extract-entities flips the book's analysis to
   * "error" so the sweep re-picks it instead of leaving it "running" forever.
   */
  onFailed?: (payload: unknown, error: string) => void;
}

const registry = new Map<string, KindDefinition>();

export function registerKind(def: KindDefinition): void {
  registry.set(def.kind, def);
}

export function getKind(kind: string): KindDefinition | undefined {
  return registry.get(kind);
}

/** Fire the kind's onFailed hook for a permanently failed item (best-effort). */
function notifyFailed(item: WorkItem, error: string): void {
  const def = registry.get(item.kind);
  if (!def?.onFailed) return;
  try {
    def.onFailed(JSON.parse(item.payload), error);
  } catch (e) {
    console.error(`[fabric] onFailed hook for ${item.kind} threw:`, e);
  }
}

// --- helpers ----------------------------------------------------------------------

/** JSON.stringify with recursively sorted keys, so payload hashing is stable. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

export function idempotencyKeyFor(kind: string, payload: unknown): string {
  return sha256(`${kind}\n${stableStringify(payload)}`);
}

export function artifactHashFor(kind: string, payload: unknown, modelId: string): string {
  return sha256(`${kind}|${idempotencyKeyFor(kind, payload)}|${modelId}`);
}

function matches(kind: string, requirements: WorkRequirements, caps: DeviceCapabilities): boolean {
  // A worker that declares its handler set never leases a kind it can't run —
  // and never a contract newer than its handler implements.
  if (caps.kinds) {
    const declared = Array.isArray(caps.kinds)
      ? caps.kinds.includes(kind)
        ? 1
        : undefined
      : caps.kinds[kind];
    if (declared === undefined) return false;
    if (declared < (requirements.kindVersion ?? 1)) return false;
  }
  for (const rt of requirements.runtimes ?? []) {
    if (!(caps.runtimes ?? []).includes(rt)) return false;
  }
  if (requirements.minRamClass && (caps.ramClass ?? 0) < requirements.minRamClass) return false;
  return true;
}

// --- devices ----------------------------------------------------------------------

export function enrollDevice(input: {
  name: string;
  platform: "macos" | "ios" | "ipados" | "server";
  capabilities?: DeviceCapabilities;
}): { device: FabricDevice; token: string } {
  const token = randomBytes(32).toString("hex");
  const id = randomUUID();
  db.insert(fabricDevices)
    .values({
      id,
      name: input.name,
      platform: input.platform,
      capabilities: JSON.stringify(input.capabilities ?? {}),
      tokenHash: sha256(token),
    })
    .run();
  const device = db.select().from(fabricDevices).where(eq(fabricDevices.id, id)).get()!;
  return { device, token };
}

export function deviceByToken(token: string): FabricDevice | undefined {
  return db
    .select()
    .from(fabricDevices)
    .where(eq(fabricDevices.tokenHash, sha256(token)))
    .get();
}

export function listDevices(): FabricDevice[] {
  return db.select().from(fabricDevices).all();
}

// --- enqueue ----------------------------------------------------------------------

export interface EnqueueResult {
  item: WorkItem;
  /** true when an existing queued/leased/done item with the same key was returned. */
  deduped: boolean;
}

export function enqueueWork(input: {
  project: string;
  kind: string;
  payload: unknown;
  requirements?: WorkRequirements;
  priority?: number;
  deadline?: Date;
}): EnqueueResult {
  if (!registry.has(input.kind)) {
    throw new Error(`Unknown work kind '${input.kind}' — register it before enqueuing`);
  }
  const def = registry.get(input.kind)!;
  const key = idempotencyKeyFor(input.kind, input.payload);
  // Compute once, reuse everywhere: any live or completed item with this key
  // stands in for the new request. Only a failed item is retried fresh.
  const existing = db
    .select()
    .from(workItems)
    .where(eq(workItems.idempotencyKey, key))
    .all()
    .find((w) => w.status !== "failed");
  if (existing) return { item: existing, deduped: true };

  const id = randomUUID();
  db.insert(workItems)
    .values({
      id,
      project: input.project,
      kind: input.kind,
      payload: JSON.stringify(input.payload ?? null),
      requirements: JSON.stringify({
        kindVersion: def.version ?? 1,
        ...(input.requirements ?? {}),
      }),
      priority: input.priority ?? 0,
      deadline: input.deadline,
      idempotencyKey: key,
    })
    .run();
  return { item: db.select().from(workItems).where(eq(workItems.id, id)).get()!, deduped: false };
}

// --- lease ------------------------------------------------------------------------

/** Re-queue (or fail out) items whose lease expired — called lazily from lease(). */
export function reapExpiredLeases(now = new Date()): number {
  const expired = db
    .select()
    .from(workItems)
    .where(and(eq(workItems.status, "leased"), lt(workItems.leaseUntil, now)))
    .all();
  for (const item of expired) {
    const failedOut = item.attempts >= MAX_ATTEMPTS;
    db.update(workItems)
      .set({
        status: failedOut ? "failed" : "queued",
        leaseOwner: null,
        leaseUntil: null,
        error: failedOut ? `lease expired after ${item.attempts} attempts` : item.error,
      })
      .where(eq(workItems.id, item.id))
      .run();
    if (failedOut) notifyFailed(item, `lease expired after ${item.attempts} attempts`);
  }
  return expired.length;
}

export function leaseWork(deviceId: string, caps: DeviceCapabilities): WorkItem | null {
  reapExpiredLeases();
  db.update(fabricDevices)
    .set({ lastSeen: new Date() })
    .where(eq(fabricDevices.id, deviceId))
    .run();

  // Retried items go to the back of the line (attempts ASC) so one poison job
  // can never head-of-line block the queue; then priority, then age.
  // SELECT only the matching columns — work_items payloads carry hundreds of
  // KB each (passage text), and this runs on every device poll; loading full
  // rows for the whole queue was tens of MB per lease call.
  const candidates = db
    .select({
      id: workItems.id,
      kind: workItems.kind,
      requirements: workItems.requirements,
      attempts: workItems.attempts,
    })
    .from(workItems)
    .where(eq(workItems.status, "queued"))
    .orderBy(asc(workItems.attempts), desc(workItems.priority), asc(workItems.createdAt))
    .all();

  for (const item of candidates) {
    const req = JSON.parse(item.requirements || "{}") as WorkRequirements;
    if (!matches(item.kind, req, caps)) continue;
    db.update(workItems)
      .set({
        status: "leased",
        leaseOwner: deviceId,
        leaseUntil: new Date(Date.now() + LEASE_TTL_MS),
        leasedAt: new Date(),
        attempts: item.attempts + 1,
      })
      .where(and(eq(workItems.id, item.id), eq(workItems.status, "queued")))
      .run();
    const leased = db.select().from(workItems).where(eq(workItems.id, item.id)).get()!;
    // Guard the race where another lease call took it between select and update.
    if (leased.status === "leased" && leased.leaseOwner === deviceId) return leased;
  }
  return null;
}

// NOTE: WorkItem rows have an `error` column, so the failure branch must be
// discriminated by a key that can't appear on a row (`code`), not by `error`.
function ownedActiveItem(
  id: string,
  deviceId: string,
): { item: WorkItem } | { error: string; code: number } {
  const item = db.select().from(workItems).where(eq(workItems.id, id)).get();
  if (!item) return { error: "Work item not found", code: 404 };
  if (item.status !== "leased" || item.leaseOwner !== deviceId) {
    return { error: "Item is not leased by this device", code: 409 };
  }
  return { item };
}

export function heartbeatWork(
  id: string,
  deviceId: string,
): { ok: true; leaseUntil: Date } | { ok: false; error: string; code: number } {
  const owned = ownedActiveItem(id, deviceId);
  if (!("item" in owned)) return { ok: false, ...owned };
  const leaseUntil = new Date(Date.now() + LEASE_TTL_MS);
  db.update(workItems).set({ leaseUntil }).where(eq(workItems.id, id)).run();
  return { ok: true, leaseUntil };
}

// --- complete / release -------------------------------------------------------------

/**
 * Item ids whose completion (validate + apply) is currently executing. A slow
 * apply can outlive the proxy's response timeout — the worker sees an error,
 * retries the POST, and without this guard the retry would queue a SECOND
 * apply of the same result (duplicate mentions etc.) because the item is
 * still "leased" until the first completion commits.
 */
const completionsInFlight = new Set<string>();

// --- deferred applies (user pause) --------------------------------------------------
// When the user pauses the queue to reclaim the box, fleet results keep
// arriving — and a monster book's apply can starve the CPU for 15+ minutes,
// defeating the pause. While paused, validated completions are recorded as
// done immediately and their apply is STASHED here; a drainer runs them
// (serialized) once the pause lifts. In-memory on purpose: if the box
// restarts before draining, the book sits at "running" until the 2h stale
// recovery flips it to error and the sweep re-analyzes — and applies are
// idempotent (scoped clear first), so a re-run is always safe.

interface DeferredApply {
  kind: string;
  payload: unknown;
  result: unknown;
  ctx: { modelId: string; artifactPath?: string };
}

const deferredApplies: DeferredApply[] = [];
let drainerStarted = false;

async function queuePaused(): Promise<boolean> {
  try {
    const { queuePauseState } = await import("../queue");
    return queuePauseState().paused;
  } catch {
    return false;
  }
}

function ensureDrainer(): void {
  if (drainerStarted) return;
  drainerStarted = true;
  setInterval(async () => {
    if (deferredApplies.length === 0 || (await queuePaused())) return;
    const next = deferredApplies.shift()!;
    const def = registry.get(next.kind);
    if (!def?.apply) return;
    try {
      await def.apply(next.payload, next.result, next.ctx);
      console.log(`[fabric] drained deferred ${next.kind} apply (${deferredApplies.length} left)`);
    } catch (e) {
      console.error(`[fabric] deferred ${next.kind} apply failed:`, e);
      try {
        def.onFailed?.(
          next.payload,
          `deferred apply failed: ${e instanceof Error ? e.message : e}`,
        );
      } catch {
        /* best-effort */
      }
    }
  }, 15_000);
}

export async function completeWork(input: {
  id: string;
  deviceId: string;
  result: unknown;
  modelId: string;
  mime?: string;
  /** Set when the worker uploaded a blob first; result should reference it. */
  artifactHash?: string;
}): Promise<{ ok: true; item: WorkItem } | { ok: false; error: string; code: number }> {
  if (completionsInFlight.has(input.id)) {
    return { ok: false, error: "completion already in progress", code: 409 };
  }
  completionsInFlight.add(input.id);
  try {
    return await completeWorkInner(input);
  } finally {
    completionsInFlight.delete(input.id);
  }
}

async function completeWorkInner(input: {
  id: string;
  deviceId: string;
  result: unknown;
  modelId: string;
  mime?: string;
  artifactHash?: string;
}): Promise<{ ok: true; item: WorkItem } | { ok: false; error: string; code: number }> {
  const owned = ownedActiveItem(input.id, input.deviceId);
  if (!("item" in owned)) return { ok: false, ...owned };
  const { item } = owned;

  const def = registry.get(item.kind);
  const payload = JSON.parse(item.payload);
  const verdict = def
    ? def.validate(payload, input.result)
    : ({ ok: false, error: `no validator registered for kind '${item.kind}'` } as const);

  if (!verdict.ok) {
    // A bad result is just a failed attempt: re-queue (or fail out) so another
    // worker — e.g. the laptops' pinned model after an AFM refusal — picks it up.
    const failedOut = item.attempts >= MAX_ATTEMPTS;
    db.update(workItems)
      .set({
        status: failedOut ? "failed" : "queued",
        leaseOwner: null,
        leaseUntil: null,
        error: verdict.error,
      })
      .where(eq(workItems.id, item.id))
      .run();
    if (failedOut) notifyFailed(item, verdict.error);
    return { ok: false, error: verdict.error, code: 422 };
  }

  // Server-side application of the validated result (kind-specific effect).
  // During a user pause the apply is deferred (see deferredApplies above) —
  // the item still completes so the fleet keeps flowing.
  if (def?.apply && (await queuePaused())) {
    ensureDrainer();
    deferredApplies.push({
      kind: item.kind,
      payload,
      result: input.result,
      ctx: {
        modelId: input.modelId,
        artifactPath: input.artifactHash ? blobPathFor(input.artifactHash) : undefined,
      },
    });
    console.log(
      `[fabric] queue paused — deferred ${item.kind} apply (${deferredApplies.length} queued)`,
    );
  } else if (def?.apply) {
    try {
      await def.apply(payload, input.result, {
        modelId: input.modelId,
        artifactPath: input.artifactHash ? blobPathFor(input.artifactHash) : undefined,
      });
    } catch (e) {
      const failedOut = item.attempts >= MAX_ATTEMPTS;
      const error = `apply failed: ${e instanceof Error ? e.message : e}`;
      db.update(workItems)
        .set({
          status: failedOut ? "failed" : "queued",
          leaseOwner: null,
          leaseUntil: null,
          error,
        })
        .where(eq(workItems.id, item.id))
        .run();
      if (failedOut) notifyFailed(item, error);
      return { ok: false, error, code: 422 };
    }
  }

  const resultJson = JSON.stringify(input.result ?? null);
  const hash = input.artifactHash ?? artifactHashFor(item.kind, payload, input.modelId);
  if (!db.select().from(fabricArtifacts).where(eq(fabricArtifacts.hash, hash)).get()) {
    db.insert(fabricArtifacts)
      .values({
        hash,
        kind: item.kind,
        modelId: input.modelId,
        mime: input.mime ?? "application/json",
        bytes: Buffer.byteLength(resultJson),
        path: input.artifactHash ? blobPathFor(hash) : null, // null = inline result
      })
      .run();
  }
  db.update(workItems)
    .set({
      status: "done",
      result: resultJson,
      artifactHash: hash,
      completedAt: new Date(),
      completedBy: input.deviceId,
      leaseOwner: null,
      leaseUntil: null,
      error: null,
    })
    .where(eq(workItems.id, item.id))
    .run();
  const device = db.select().from(fabricDevices).where(eq(fabricDevices.id, input.deviceId)).get();
  if (device) {
    db.update(fabricDevices)
      .set({ jobsDone: device.jobsDone + 1, lastSeen: new Date() })
      .where(eq(fabricDevices.id, input.deviceId))
      .run();
  }
  return { ok: true, item: db.select().from(workItems).where(eq(workItems.id, input.id)).get()! };
}

/**
 * Await a work item's completion by polling (the queue is DB-backed; at
 * household scale a 5s poll is plenty). Returns the parsed result on done,
 * null on timeout/failed/abort — callers fall back to doing the work locally.
 */
export async function waitForWorkResult(
  itemId: string,
  opts: { timeoutMs: number; signal?: AbortSignal; leaseWithinMs?: number },
): Promise<unknown | null> {
  const started = Date.now();
  for (;;) {
    if (opts.signal?.aborted) return null;
    const row = db.select().from(workItems).where(eq(workItems.id, itemId)).get();
    if (!row) return null;
    if (row.status === "done") return row.result ? JSON.parse(row.result) : null;
    if (row.status === "failed") return null;
    const elapsed = Date.now() - started;
    // Nobody leased it in time → the fleet is asleep; don't hold the pipeline.
    if (
      opts.leaseWithinMs &&
      row.status === "queued" &&
      row.attempts === 0 &&
      elapsed > opts.leaseWithinMs
    ) {
      return null;
    }
    if (elapsed > opts.timeoutMs) return null;
    await new Promise((r) => setTimeout(r, 5000));
  }
}

/** Whether any enrolled device with the given runtime checked in recently. */
export function runtimeOnFleet(runtime: string, withinMs = 10 * 60 * 1000): boolean {
  const rows = db.select().from(fabricDevices).all();
  const cutoff = Date.now() - withinMs;
  return rows.some((d) => {
    if (!d.lastSeen || +d.lastSeen < cutoff) return false;
    try {
      const caps = JSON.parse(d.capabilities || "{}") as DeviceCapabilities;
      return (caps.runtimes ?? []).includes(runtime);
    } catch {
      return false;
    }
  });
}

export function releaseWork(
  id: string,
  deviceId: string,
  reason: string,
  /**
   * true ONLY for eligibility loss (unplugged, thermal) — refunds the attempt.
   * Handler errors must NOT refund: a job whose handler always throws (e.g. an
   * on-device-model guardrail refusal) has to burn attempts and fail out, or
   * it head-of-line blocks the queue forever.
   */
  refund = false,
): { ok: true } | { ok: false; error: string; code: number } {
  const owned = ownedActiveItem(id, deviceId);
  if (!("item" in owned)) return { ok: false, ...owned };
  const { item } = owned;
  const attempts = refund ? Math.max(0, item.attempts - 1) : item.attempts;
  const failedOut = !refund && attempts >= MAX_ATTEMPTS;
  db.update(workItems)
    .set({
      status: failedOut ? "failed" : "queued",
      leaseOwner: null,
      leaseUntil: null,
      attempts,
      error: `released: ${reason}`,
    })
    .where(eq(workItems.id, id))
    .run();
  if (failedOut) notifyFailed(item, `released: ${reason}`);
  return { ok: true };
}

// --- artifact blobs -----------------------------------------------------------------

export function blobPathFor(hash: string): string {
  return `fabric/${hash.slice(0, 2)}/${hash}`;
}

/**
 * Re-queue failed work items so the fleet attempts them again. Resets attempts
 * to 0 and clears any stale lease, so they lease like fresh work (no head-of-line
 * blocking). Optionally scoped to one kind. Returns how many were re-queued.
 */
export function requeueFailed(kind?: string): number {
  const res = db
    .update(workItems)
    .set({ status: "queued", attempts: 0, leaseOwner: null, leaseUntil: null, leasedAt: null })
    .where(
      kind
        ? and(eq(workItems.status, "failed"), eq(workItems.kind, kind))
        : eq(workItems.status, "failed"),
    )
    .run();
  return res.changes;
}

// --- observability ------------------------------------------------------------------

export function queueStatus(): {
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
  devices: Array<Pick<FabricDevice, "id" | "name" | "platform" | "lastSeen" | "jobsDone">>;
} {
  // GROUP BY aggregates — loading every row (with multi-hundred-KB payloads)
  // for counts cost MBs per admin-portal poll.
  const byStatus: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  for (const r of db
    .select({ status: workItems.status, n: dsql<number>`COUNT(*)` })
    .from(workItems)
    .groupBy(workItems.status)
    .all()) {
    byStatus[r.status] = r.n;
  }
  for (const r of db
    .select({ kind: workItems.kind, n: dsql<number>`COUNT(*)` })
    .from(workItems)
    .where(dsql`${workItems.status} IN ('queued','leased')`)
    .groupBy(workItems.kind)
    .all()) {
    byKind[r.kind] = r.n;
  }
  return {
    byStatus,
    byKind,
    devices: listDevices().map(({ id, name, platform, lastSeen, jobsDone }) => ({
      id,
      name,
      platform,
      lastSeen,
      jobsDone,
    })),
  };
}
