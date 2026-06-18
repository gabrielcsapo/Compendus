/**
 * Idle Fleet fabric queue semantics over an isolated temp DB (COMPENDUS_DATA_DIR
 * set in tests/setup.ts). Proves the F1 protocol invariants: idempotent enqueue,
 * capability-matched leasing, lazy lease-expiry reaping, validated completion
 * with artifact registration, graceful release, and attempts-cap failure.
 */
import { describe, it, expect, beforeAll } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */
let fabric: any;
let db: any, workItems: any, fabricArtifacts: any, eq: any;
let deviceId: string;

const CAPS = { runtimes: ["echo"], ramClass: 8 };

beforeAll(async () => {
  fabric = await import("../app/lib/fabric");
  await import("../app/lib/fabric/kinds");
  ({ db, workItems, fabricArtifacts } = await import("../app/lib/db"));
  ({ eq } = await import("drizzle-orm"));
  const { device } = fabric.enrollDevice({
    name: "test-laptop",
    platform: "macos",
    capabilities: CAPS,
  });
  deviceId = device.id;
});

describe("enqueue", () => {
  it("dedupes on idempotency key and rejects unknown kinds", () => {
    const a = fabric.enqueueWork({ project: "t", kind: "echo", payload: { text: "hi" } });
    const b = fabric.enqueueWork({ project: "t", kind: "echo", payload: { text: "hi" } });
    expect(a.deduped).toBe(false);
    expect(b.deduped).toBe(true);
    expect(b.item.id).toBe(a.item.id);
    // Key order in the payload must not matter (stable stringify).
    const c = fabric.enqueueWork({
      project: "t",
      kind: "echo",
      payload: { b: 1, text: "hi" },
    });
    const d = fabric.enqueueWork({
      project: "t",
      kind: "echo",
      payload: { text: "hi", b: 1 },
    });
    expect(d.item.id).toBe(c.item.id);
    expect(() => fabric.enqueueWork({ project: "t", kind: "nope", payload: {} })).toThrow(
      /Unknown work kind/,
    );
  });
});

/** Lease until the target item is held, validly completing every other echo item. */
async function leaseTarget(targetId: string) {
  for (;;) {
    const leased = fabric.leaseWork(deviceId, CAPS);
    if (!leased) return null;
    if (leased.id === targetId) return leased;
    await fabric.completeWork({
      id: leased.id,
      deviceId,
      result: { echoed: JSON.parse(leased.payload).text.toUpperCase() },
      modelId: "drain/0",
    });
  }
}

/** Complete every leasable echo item so the next test starts from an empty queue. */
async function drainQueue() {
  for (;;) {
    const leased = fabric.leaseWork(deviceId, CAPS);
    if (!leased) break;
    await fabric.completeWork({
      id: leased.id,
      deviceId,
      result: { echoed: JSON.parse(leased.payload).text.toUpperCase() },
      modelId: "drain/0",
    });
  }
}

describe("lease", () => {
  it("matches capabilities and respects priority order", async () => {
    await drainQueue();
    const low = fabric.enqueueWork({ project: "t", kind: "echo", payload: { text: "low" } });
    const high = fabric.enqueueWork({
      project: "t",
      kind: "echo",
      payload: { text: "high" },
      priority: 10,
    });
    const leased = fabric.leaseWork(deviceId, CAPS);
    expect(leased.id).toBe(high.item.id);
    // Requirements the device can't meet are skipped.
    fabric.enqueueWork({
      project: "t",
      kind: "echo",
      payload: { text: "gpu-only" },
      requirements: { runtimes: ["mlx"] },
    });
    const next = fabric.leaseWork(deviceId, CAPS);
    expect(JSON.parse(next.payload).text).not.toBe("gpu-only");
    expect(next.id).toBe(low.item.id);
    // Nothing leasable left for these capabilities (gpu-only remains queued).
    expect(fabric.leaseWork(deviceId, CAPS)?.id).toBeUndefined();
    // release leases for later tests
    fabric.releaseWork(leased.id, deviceId, "test cleanup");
    fabric.releaseWork(next.id, deviceId, "test cleanup");
  });

  it("reaps expired leases back to queued", () => {
    fabric.enqueueWork({ project: "t", kind: "echo", payload: { text: "reapme" } });
    const item = fabric.leaseWork(deviceId, CAPS);
    expect(item).toBeTruthy();
    db.update(workItems)
      .set({ leaseUntil: new Date(Date.now() - 1000) })
      .where(eq(workItems.id, item.id))
      .run();
    expect(fabric.reapExpiredLeases()).toBeGreaterThanOrEqual(1);
    const row = db.select().from(workItems).where(eq(workItems.id, item.id)).get();
    expect(row.status).toBe("queued");
    expect(row.leaseOwner).toBeNull();
  });
});

describe("complete", () => {
  it("validates results, stores them, and registers a content-addressed artifact", async () => {
    const { item } = fabric.enqueueWork({ project: "t", kind: "echo", payload: { text: "abc" } });
    let leased = fabric.leaseWork(deviceId, CAPS);
    while (leased && leased.id !== item.id) {
      await fabric.completeWork({
        id: leased.id,
        deviceId,
        result: { echoed: JSON.parse(leased.payload).text.toUpperCase() },
        modelId: "test/0",
      });
      leased = fabric.leaseWork(deviceId, CAPS);
    }
    expect(leased.id).toBe(item.id);

    // Wrong result → validation failure → re-queued with error recorded.
    const bad = await fabric.completeWork({
      id: item.id,
      deviceId,
      result: { echoed: "wrong" },
      modelId: "test/0",
    });
    expect(bad.ok).toBe(false);
    let row = db.select().from(workItems).where(eq(workItems.id, item.id)).get();
    expect(row.status).toBe("queued");
    expect(row.error).toMatch(/uppercased/);

    // Correct result → done + artifact row keyed by (kind, payload, model).
    const again = await leaseTarget(item.id);
    expect(again.id).toBe(item.id);
    const good = await fabric.completeWork({
      id: item.id,
      deviceId,
      result: { echoed: "ABC" },
      modelId: "test/0",
    });
    expect(good.ok).toBe(true);
    row = db.select().from(workItems).where(eq(workItems.id, item.id)).get();
    expect(row.status).toBe("done");
    expect(JSON.parse(row.result).echoed).toBe("ABC");
    const art = db
      .select()
      .from(fabricArtifacts)
      .where(eq(fabricArtifacts.hash, row.artifactHash))
      .get();
    expect(art.modelId).toBe("test/0");
    expect(art.path).toBeNull(); // inline result

    // Re-enqueueing the same payload returns the completed item — compute once.
    const re = fabric.enqueueWork({ project: "t", kind: "echo", payload: { text: "abc" } });
    expect(re.deduped).toBe(true);
    expect(re.item.status).toBe("done");
  });

  it("fails an item permanently after MAX_ATTEMPTS bad results", async () => {
    const { item } = fabric.enqueueWork({ project: "t", kind: "echo", payload: { text: "doom" } });
    for (let i = 0; i < fabric.MAX_ATTEMPTS; i++) {
      const leased = await leaseTarget(item.id);
      expect(leased.id).toBe(item.id);
      await fabric.completeWork({
        id: item.id,
        deviceId,
        result: { echoed: "nope" },
        modelId: "t/0",
      });
    }
    const row = db.select().from(workItems).where(eq(workItems.id, item.id)).get();
    expect(row.status).toBe("failed");
    // A failed item does NOT satisfy dedupe — a fresh enqueue retries the work.
    const re = fabric.enqueueWork({ project: "t", kind: "echo", payload: { text: "doom" } });
    expect(re.deduped).toBe(false);
    expect(re.item.id).not.toBe(item.id);
    await fabric.completeWork({
      id: (await leaseTarget(re.item.id)).id,
      deviceId,
      result: { echoed: "DOOM" },
      modelId: "t/0",
    });
  });
});

describe("release + heartbeat", () => {
  it("eligibility release refunds the attempt; handler-error release does not", () => {
    const { item } = fabric.enqueueWork({ project: "t", kind: "echo", payload: { text: "zz" } });
    let leased = fabric.leaseWork(deviceId, CAPS);
    expect(leased.id).toBe(item.id);
    expect(leased.attempts).toBe(1);
    // Eligibility loss (refund: true) → attempt refunded.
    expect(fabric.releaseWork(item.id, deviceId, "unplugged", true).ok).toBe(true);
    let row = db.select().from(workItems).where(eq(workItems.id, item.id)).get();
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(0);
    // Handler error (default) → attempt stands.
    leased = fabric.leaseWork(deviceId, CAPS);
    expect(fabric.releaseWork(item.id, deviceId, "model refused", false).ok).toBe(true);
    row = db.select().from(workItems).where(eq(workItems.id, item.id)).get();
    expect(row.attempts).toBe(1);
  });

  it("a poison job drifts behind fresh work and fails out after MAX_ATTEMPTS", async () => {
    await drainQueue();
    const poison = fabric.enqueueWork({ project: "t", kind: "echo", payload: { text: "poison" } });
    // Burn one attempt on the poison job.
    const first = await leaseTarget(poison.item.id);
    expect(first.id).toBe(poison.item.id);
    fabric.releaseWork(poison.item.id, deviceId, "model refused");
    // Fresh work now leases BEFORE the once-attempted poison job.
    const fresh = fabric.enqueueWork({ project: "t", kind: "echo", payload: { text: "fresh" } });
    const second = fabric.leaseWork(deviceId, CAPS);
    expect(second.id).toBe(fresh.item.id);
    await fabric.completeWork({
      id: fresh.item.id,
      deviceId,
      result: { echoed: "FRESH" },
      modelId: "drain/0",
    });
    // Keep failing the poison job: it must fail out, not loop forever.
    for (let i = 0; i < fabric.MAX_ATTEMPTS; i++) {
      const next = fabric.leaseWork(deviceId, CAPS);
      if (!next) break;
      fabric.releaseWork(next.id, deviceId, "model refused");
    }
    const row = db.select().from(workItems).where(eq(workItems.id, poison.item.id)).get();
    expect(row.status).toBe("failed");
  });

  it("heartbeat extends the lease; non-owners are rejected", () => {
    fabric.enqueueWork({ project: "t", kind: "echo", payload: { text: "heartbeat-me" } });
    const leased = fabric.leaseWork(deviceId, CAPS);
    expect(leased).toBeTruthy();
    const before = +leased.leaseUntil;
    const hb = fabric.heartbeatWork(leased.id, deviceId);
    expect(hb.ok).toBe(true);
    expect(+hb.leaseUntil).toBeGreaterThanOrEqual(before);
    const stranger = fabric.heartbeatWork(leased.id, "not-a-device");
    expect(stranger.ok).toBe(false);
    expect(stranger.code).toBe(409);
    fabric.releaseWork(leased.id, deviceId, "test cleanup");
  });
});

describe("observability", () => {
  it("reports queue depth and device contributions", () => {
    const s = fabric.queueStatus();
    expect(s.devices.find((d: any) => d.id === deviceId).jobsDone).toBeGreaterThanOrEqual(1);
    expect(s.byStatus.done).toBeGreaterThanOrEqual(1);
  });
});

describe("kind contract versioning", () => {
  it("stale handlers stop matching after a contract bump", async () => {
    fabric.registerKind({
      kind: "versioned-test",
      project: "t",
      version: 2,
      validate: () => ({ ok: true }),
    });
    const { item } = fabric.enqueueWork({
      project: "t",
      kind: "versioned-test",
      payload: { x: 1 },
    });
    expect(JSON.parse(item.requirements).kindVersion).toBe(2);
    // Worker implementing v1 never sees it…
    expect(fabric.leaseWork(deviceId, { kinds: { "versioned-test": 1 } })).toBeNull();
    // …legacy array declaration (assumed v1) doesn't either…
    expect(fabric.leaseWork(deviceId, { kinds: ["versioned-test"] })).toBeNull();
    // …a v2 worker does.
    const leased = fabric.leaseWork(deviceId, { kinds: { "versioned-test": 2 } });
    expect(leased.id).toBe(item.id);
    await fabric.completeWork({ id: item.id, deviceId, result: {}, modelId: "t/2" });
  });
});
