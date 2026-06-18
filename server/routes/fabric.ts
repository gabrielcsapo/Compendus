/**
 * Idle Fleet compute fabric routes (wander-semantic-substrate-proposal.md §12.3).
 *
 * Worker endpoints authenticate with a device bearer token (X-Fabric-Token) —
 * NOT a profile — because workers are headless background processes. Device
 * enrollment and queue administration are admin-only profile routes.
 */
import {
  existsSync,
  readFileSync,
  createReadStream,
  createWriteStream,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { rawDb } from "../../app/lib/db";
import { fleetAnalytics } from "../../app/lib/fabric/analytics";
import { resolveStoragePath } from "../../app/lib/storage";
import type { FabricDevice } from "../../app/lib/db";
import {
  enrollDevice,
  deviceByToken,
  enqueueWork,
  leaseWork,
  heartbeatWork,
  completeWork,
  releaseWork,
  queueStatus,
  blobPathFor,
  getKind,
} from "../../app/lib/fabric";
import "../../app/lib/fabric/kinds"; // populate the kind registry
import { requireAdmin } from "../middleware/profile";

const DATA_ROOT = process.env.COMPENDUS_DATA_DIR || resolve(process.cwd(), "data");

type FabricEnv = { Variables: { fabricDevice: FabricDevice } };
const app = new Hono<FabricEnv>();

// --- admin: enrollment + observability --------------------------------------------

app.use("/api/fabric/devices", requireAdmin);
app.use("/api/fabric/status", requireAdmin);
app.use("/api/fabric/items", requireAdmin);
app.use("/api/fabric/reembed", requireAdmin);

/** POST /api/fabric/devices — enroll a worker; the token is returned exactly once. */
app.post("/api/fabric/devices", async (c) => {
  const body = await c.req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const platform = body?.platform;
  if (!name || !["macos", "ios", "ipados", "server", "web"].includes(platform)) {
    return c.json(
      { success: false, error: "name and platform ('macos'|'ios'|'ipados'|'server') required" },
      400,
    );
  }
  const { device, token } = enrollDevice({ name, platform, capabilities: body?.capabilities });
  return c.json({ success: true, deviceId: device.id, token });
});

/** GET /api/fabric/status — queue depth + enrolled devices. */
app.get("/api/fabric/status", (c) => c.json({ success: true, ...queueStatus() }));

/**
 * GET /api/fabric/analytics — the fleet's ledger: per-device and per-kind
 * throughput, processing times, failure rates, artifact volume, and a 24h
 * hourly timeline. Attribution uses completed_by (permanent), so "what did
 * the phone do overnight" has a real answer.
 */
app.get("/api/fabric/analytics", (c) => {
  const analytics = fleetAnalytics(parseInt(c.req.query("hours") || "168", 10));
  return c.json({ success: true, ...analytics });
});

/** POST /api/fabric/items — enqueue work (server code usually calls enqueueWork directly). */
app.post("/api/fabric/items", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.kind || !getKind(body.kind)) {
    return c.json({ success: false, error: "unknown or missing kind" }, 400);
  }
  const { item, deduped } = enqueueWork({
    project: body.project ?? "compendus",
    kind: body.kind,
    payload: body.payload,
    requirements: body.requirements,
    priority: body.priority,
    deadline: body.deadline ? new Date(body.deadline) : undefined,
  });
  return c.json({ success: true, item, deduped });
});

/**
 * POST /api/fabric/reembed {bookId} | {all:true} [, model] — enqueue
 * reembed-book jobs (the model-migration path: a docked laptop re-embeds the
 * corpus overnight; server-side apply swaps vectors into the substrate).
 */
app.post("/api/fabric/reembed", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const model = typeof body?.model === "string" ? body.model : "Xenova/all-MiniLM-L6-v2";
  const bookIds: string[] = body?.all
    ? (rawDb.prepare("SELECT DISTINCT book_id AS id FROM passages").all() as { id: string }[]).map(
        (r) => r.id,
      )
    : typeof body?.bookId === "string"
      ? [body.bookId]
      : [];
  if (bookIds.length === 0)
    return c.json({ success: false, error: "bookId or all:true required" }, 400);

  const items: Array<{ bookId: string; itemId: string; deduped: boolean; passages: number }> = [];
  for (const bookId of bookIds) {
    // v2 payloads carry ids only; workers fetch texts via /api/fabric/passages.
    const ids = (
      rawDb.prepare("SELECT id FROM passages WHERE book_id = ? ORDER BY ordinal").all(bookId) as {
        id: string;
      }[]
    ).map((r) => r.id);
    if (ids.length === 0) continue;
    const { item, deduped } = enqueueWork({
      project: "compendus",
      kind: "reembed-book",
      payload: { bookId, model, passageIds: ids },
      requirements: { runtimes: ["onnx-embed"] },
    });
    items.push({ bookId, itemId: item.id, deduped, passages: ids.length });
  }
  return c.json({ success: true, enqueued: items });
});

// --- worker auth -------------------------------------------------------------------

app.use("/api/fabric/lease", deviceAuth());
app.use("/api/fabric/work/*", deviceAuth());

function deviceAuth() {
  return async (
    c: Parameters<Parameters<(typeof app)["use"]>[1]>[0],
    next: () => Promise<void>,
  ) => {
    const token = c.req.header("X-Fabric-Token");
    const device = token ? deviceByToken(token) : undefined;
    if (!device) return c.json({ success: false, error: "Invalid or missing device token" }, 401);
    c.set("fabricDevice", device);
    return next();
  };
}

// --- worker endpoints ----------------------------------------------------------------

/** POST /api/fabric/lease {capabilities} → {job|null}. One lease per call; pull-based. */
app.post("/api/fabric/lease", async (c) => {
  const device = c.get("fabricDevice");
  const body = await c.req.json().catch(() => ({}));
  // Self-healing device names: enrollment-era names stick otherwise (the Mac
  // enrolled as Catalyst's default "iPad" before the hostname fix).
  if (typeof body?.deviceName === "string" && body.deviceName.trim()) {
    rawDb
      .prepare("UPDATE fabric_devices SET name = ? WHERE id = ? AND name != ?")
      .run(body.deviceName.trim(), device.id, body.deviceName.trim());
  }
  const caps = body?.capabilities ?? JSON.parse(device.capabilities || "{}");
  const item = leaseWork(device.id, caps);
  if (!item) return c.json({ success: true, job: null });
  return c.json({
    success: true,
    job: {
      id: item.id,
      kind: item.kind,
      payload: JSON.parse(item.payload),
      requirements: JSON.parse(item.requirements || "{}"),
      leaseUntil: item.leaseUntil,
    },
  });
});

/** POST /api/fabric/work/:id/heartbeat — extend the lease for long jobs. */
app.post("/api/fabric/work/:id/heartbeat", (c) => {
  const out = heartbeatWork(c.req.param("id"), c.get("fabricDevice").id);
  if (!out.ok) return c.json({ success: false, error: out.error }, out.code as 404);
  return c.json({ success: true, leaseUntil: out.leaseUntil });
});

/**
 * POST /api/fabric/work/:id/artifact — upload a large binary result (audio,
 * transcripts) as a content-addressed blob; the JSON result then references it.
 */
app.post("/api/fabric/work/:id/artifact", async (c) => {
  // STREAM to disk, hashing incrementally — a fleet-converted EPUB can be a
  // gigabyte and buffering it (arrayBuffer) would OOM the 2-core container,
  // the exact failure mode the fleet offload exists to remove.
  const body = c.req.raw.body;
  if (!body) return c.json({ success: false, error: "Empty artifact body" }, 400);
  const hasher = createHash("sha256");
  const tmp = resolve(DATA_ROOT, `fabric/.upload-${randomUUID()}`);
  mkdirSync(dirname(tmp), { recursive: true });
  const out = createWriteStream(tmp);
  let total = 0;
  try {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hasher.update(value);
      total += value.length;
      if (!out.write(value)) await new Promise((r) => out.once("drain", r));
    }
    await new Promise<void>((r, j) => out.end((e?: Error) => (e ? j(e) : r())));
    if (total === 0) {
      rmSync(tmp, { force: true });
      return c.json({ success: false, error: "Empty artifact body" }, 400);
    }
    const hash = hasher.digest("hex");
    const abs = resolve(DATA_ROOT, blobPathFor(hash));
    mkdirSync(dirname(abs), { recursive: true });
    if (existsSync(abs) && statSync(abs).size === total) {
      rmSync(tmp, { force: true }); // already content-addressed — dedupe
    } else {
      renameSync(tmp, abs);
    }
    return c.json({ success: true, artifactHash: hash, bytes: total });
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
});

/**
 * GET /api/fabric/files/:bookId — fleet workers download a book's source file
 * (40MB PDFs don't belong inline in work-item payloads).
 */
app.get("/api/fabric/files/:bookId", (c) => {
  const row = rawDb
    .prepare("SELECT file_path AS p FROM books WHERE id = ?")
    .get(c.req.param("bookId")) as { p: string } | undefined;
  if (!row) return c.json({ success: false, error: "book not found" }, 404);
  const abs = resolveStoragePath(row.p);
  if (!existsSync(abs)) return c.json({ success: false, error: "file missing" }, 404);
  // STREAM — readFileSync of a 40MB+ PDF inside a request handler blocked the
  // whole event loop and held the file in RAM for the duration of the send.
  const size = statSync(abs).size;
  return new Response(Readable.toWeb(createReadStream(abs)) as ReadableStream, {
    headers: { "Content-Type": "application/octet-stream", "Content-Length": String(size) },
  });
});

/**
 * GET /api/fabric/passages/:bookId — passage id+text for extraction workers.
 * extract-entities v3 payloads carry ids only; workers fetch the texts here
 * and verify the id sets match (a re-analysis mints new ids → job is stale).
 */
app.get("/api/fabric/passages/:bookId", (c) => {
  const rows = rawDb
    .prepare("SELECT id, text FROM passages WHERE book_id = ? ORDER BY ordinal")
    .all(c.req.param("bookId")) as Array<{ id: string; text: string }>;
  if (rows.length === 0) return c.json({ success: false, error: "no passages" }, 404);
  return c.json({ success: true, passages: rows });
});

/**
 * GET /api/fabric/kernels/:hash — fetch a kernel bundle by content hash.
 * Hosts verify the hash locally before executing (household trust + integrity).
 */
app.get("/api/fabric/kernels/:hash", (c) => {
  const hash = c.req.param("hash");
  if (!/^[0-9a-f]{64}$/.test(hash)) return c.json({ success: false, error: "bad hash" }, 400);
  const row = rawDb
    .prepare("SELECT path FROM fabric_artifacts WHERE hash = ? AND kind = 'js-kernel'")
    .get(hash) as { path: string | null } | undefined;
  if (!row?.path || !existsSync(row.path)) {
    return c.json({ success: false, error: "kernel not found" }, 404);
  }
  return new Response(readFileSync(row.path), {
    headers: { "Content-Type": "text/javascript", "Cache-Control": "immutable, max-age=31536000" },
  });
});

/** POST /api/fabric/work/:id/result {result, modelId, mime?, artifactHash?} — validated completion. */
app.post("/api/fabric/work/:id/result", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.modelId !== "string") {
    return c.json(
      { success: false, error: "modelId required (pinned model name or OS version)" },
      400,
    );
  }
  const out = await completeWork({
    id: c.req.param("id"),
    deviceId: c.get("fabricDevice").id,
    result: body.result,
    modelId: body.modelId,
    mime: body.mime,
    artifactHash: body.artifactHash,
  });
  if (!out.ok) return c.json({ success: false, error: out.error }, out.code as 422);
  return c.json({ success: true, item: out.item });
});

/** POST /api/fabric/work/:id/release {reason} — graceful surrender (unplugged, thermal). */
app.post("/api/fabric/work/:id/release", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const out = releaseWork(
    c.req.param("id"),
    c.get("fabricDevice").id,
    typeof body?.reason === "string" ? body.reason : "unspecified",
    body?.refund === true,
  );
  if (!out.ok) return c.json({ success: false, error: out.error }, out.code as 409);
  return c.json({ success: true });
});

export { app as fabricRoutes };
