/**
 * End-to-end verification of the substrate + wander v2 + learning + curriculum
 * + fabric flow, across applications: the API server (Hono app), the fleet
 * worker (spawned as a real child process), and the substrate data layer —
 * against a real corpus.
 *
 * Usage:
 *   COMPENDUS_DATA_DIR=/tmp/e2e-data pnpm tsx scripts/e2e-substrate.ts
 *
 * Expects the data dir to hold an analyzed DB (run scripts/rebuild-substrate.ts
 * first if the substrate tables are empty — though this script will do it).
 * Exits non-zero on any failure.
 */
import { spawn } from "node:child_process";
import { serve } from "@hono/node-server";

const PORT = 3011;
const BASE = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: unknown, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const { rawDb } = await import("../app/lib/db");
const { substrateReady, rebuildStructure } = await import("../app/lib/knowledge/substrate");
const { app } = await import("../server/index");

if (!substrateReady()) {
  console.log("[e2e] substrate empty — rebuilding first…");
  await rebuildStructure((m) => console.log(`  ${m}`));
}

const profileId = (
  rawDb.prepare("SELECT id FROM profiles WHERE is_admin = 1 LIMIT 1").get() as { id: string }
)?.id;
if (!profileId) {
  console.error("No admin profile in DB");
  process.exit(1);
}

const server = serve({ fetch: app.fetch, port: PORT });
await new Promise((r) => setTimeout(r, 500));

const H = { "X-Profile-Id": profileId, "Content-Type": "application/json" };
const get = async (path: string) => (await fetch(`${BASE}${path}`, { headers: H })).json();
const post = async (path: string, body?: unknown, headers: Record<string, string> = H) =>
  (
    await fetch(`${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body ?? {}) })
  ).json();

// ---------------------------------------------------------------- wander v2
console.log("\n[1] Wander v2");
const start = await get("/api/wander2/start?mode=random");
check("random start returns a stop", start?.stop?.text?.length > 50);
check("random start avoids citation noise", !/(vol\.|Ibid|ISBN)/.test(start?.stop?.text ?? "Ibid"));
check("start has grounded steps", (start?.stop?.steps?.length ?? 0) >= 2);
const sameIdea = (start?.stop?.steps ?? []).filter((s: { kind: string }) => s.kind === "same_idea");
check(
  "same_idea steps exist and cross books",
  sameIdea.length >= 1 && sameIdea.every((s: { bookId: string }) => s.bookId !== start.stop.bookId),
  JSON.stringify(sameIdea.map((s: { bookId: string }) => s.bookId)),
);

const stepTarget = start.stop.steps[0];
const second = await get(
  `/api/wander2/stop/${stepTarget.passageId}?visited=${start.stop.passageId}`,
);
check("stepping to a stop works", second?.stop?.passageId === stepTarget.passageId);
check(
  "visited passages never reoffered",
  (second?.stop?.steps ?? []).every(
    (s: { passageId: string }) => s.passageId !== start.stop.passageId,
  ),
);

const seeded = await get("/api/wander2/start?mode=query&q=composting+kitchen+waste");
check(
  "query-seeded start lands on-topic",
  /compost|garden|soil|scrap/i.test(seeded?.stop?.text ?? ""),
  (seeded?.stop?.text ?? "").slice(0, 80),
);
const titanic = await get("/api/wander2/start?mode=query&q=the+titanic+sinking+lifeboats");
check(
  "second seed lands in the right book",
  /Night to Remember/i.test(titanic?.stop?.bookTitle ?? ""),
  titanic?.stop?.bookTitle,
);

const anyBook = (
  rawDb.prepare("SELECT DISTINCT book_id AS id FROM passages LIMIT 1").get() as { id: string }
).id;
const fromBook = await get(`/api/wander2/start?mode=book&bookId=${anyBook}`);
check("book-seeded start works", fromBook?.stop?.bookId === anyBook);

// ---------------------------------------------------------------- topics + coverage
console.log("\n[2] Topics, coverage, learning");
const topicsResp = await get("/api/topics");
check(
  "topics list non-empty",
  (topicsResp?.topics?.length ?? 0) >= 5,
  String(topicsResp?.topics?.length),
);
const multiBook = (topicsResp?.topics ?? []).filter((t: { bookCount: number }) => t.bookCount >= 2);
check("multi-book topics exist", multiBook.length >= 3, String(multiBook.length));
const topic = multiBook[0] ?? topicsResp.topics[0];
check(
  "coverage tracked per profile",
  topic?.coverage && topic.coverage.total > 0 && topic.coverage.seen >= 0,
);

const seenBefore = (
  rawDb.prepare("SELECT COUNT(*) AS n FROM passage_seen WHERE profile_id = ?").get(profileId) as {
    n: number;
  }
).n;
check("wander stops recorded as coverage", seenBefore >= 3, String(seenBefore));

const detail = await get(`/api/topics/${topic.id}`);
check("topic detail returns core passages", (detail?.topic?.core?.length ?? 0) >= 3);

// ---------------------------------------------------------------- curriculum
console.log("\n[3] Curriculum (Tier A)");
const cur = await get(`/api/topics/${topic.id}/curriculum`);
const items = cur?.curriculum?.items ?? [];
check("curriculum builds", items.length >= 5, String(items.length));
check(
  "ordinals sequential",
  items.every((it: { ordinal: number }, i: number) => it.ordinal === i + 1),
);
check(
  "every item has transition + module + role",
  items.every(
    (it: { transition: string; module: string; role: string }) =>
      it.transition && it.module && it.role,
  ),
);
const bookSwitches = items.filter(
  (it: { bookId: string }, i: number) => i > 0 && it.bookId !== items[i - 1].bookId,
).length;
check("study path alternates books", bookSwitches >= 1, String(bookSwitches));
check(
  "items carry seen flags",
  items.some((it: { seen: boolean }) => typeof it.seen === "boolean"),
);

// ---------------------------------------------------------------- perspectives + frontier
console.log("\n[4] Perspectives + frontier");
const richEntity = rawDb
  .prepare(
    `SELECT entity_id AS id, COUNT(DISTINCT passage_id) AS n FROM canonical_mentions
     GROUP BY entity_id HAVING n >= 6 ORDER BY n DESC LIMIT 1`,
  )
  .get() as { id: string } | undefined;
if (richEntity) {
  const persp = await get(`/api/graph/entities/${richEntity.id}/perspectives`);
  check("perspectives returns a contrast pair", persp?.perspectives?.length === 2);
  check(
    "perspective passages differ",
    persp?.perspectives?.[0]?.passageId !== persp?.perspectives?.[1]?.passageId,
  );
} else {
  check("perspectives (no entity with ≥6 mentions — corpus artifact, skipped)", true);
}

rawDb
  .prepare(
    `INSERT OR REPLACE INTO user_book_state (id, profile_id, book_id, reading_progress, updated_at)
     VALUES ('e2e-ubs', ?, ?, 0.5, unixepoch())`,
  )
  .run(profileId, anyBook);
const frontier = await get("/api/frontier");
check(
  "frontier ranks unread books",
  (frontier?.frontier?.length ?? 0) >= 1,
  JSON.stringify(frontier?.frontier?.slice(0, 2)),
);
check(
  "frontier excludes started books",
  (frontier?.frontier ?? []).every((b: { bookId: string }) => b.bookId !== anyBook),
);

// ---------------------------------------------------------------- trails + sessions
console.log("\n[5] Trails + session logging");
const path = [start.stop.passageId, stepTarget.passageId, seeded.stop.passageId];
const saved = await post("/api/trails", { title: "E2E trail", path });
check("trail saves", saved?.success && saved?.id);
const trailsList = await get("/api/trails");
check(
  "trails list includes it",
  (trailsList?.trails ?? []).some((t: { id: string }) => t.id === saved.id),
);
const trail = await get(`/api/trails/${saved.id}`);
check("trail replays with stops", trail?.trail?.stops?.length === path.length);

await post("/api/wander/sessions", {
  startedAt: Date.now() - 60_000,
  ideasVisited: path.length,
  path,
  stepsTaken: ["same_idea", "leave"],
});
const sess = rawDb
  .prepare(
    "SELECT path_json AS p, steps_taken_json AS s FROM wander_sessions ORDER BY started_at DESC LIMIT 1",
  )
  .get() as { p: string | null; s: string | null };
check("session logs path + step kinds", !!sess?.p && JSON.parse(sess.p).length === 3 && !!sess?.s);

// ---------------------------------------------------------------- fabric: reembed via real worker
console.log("\n[6] Fabric reembed via fleet worker (child process)");
const enrolled = await post("/api/fabric/devices", {
  name: "e2e-fleet",
  platform: "macos",
  capabilities: { runtimes: ["echo", "onnx-embed"], ramClass: 16 },
});
check("device enrolls", enrolled?.success && enrolled?.token);

const smallBook = rawDb
  .prepare(
    "SELECT book_id AS id, COUNT(*) AS n FROM passages GROUP BY book_id ORDER BY n ASC LIMIT 1",
  )
  .get() as { id: string; n: number };
// Mark current vectors stale so the worker's apply is observable.
rawDb
  .prepare(
    `UPDATE embeddings SET model = 'stale/old' WHERE kind = 'passage'
     AND ref_id IN (SELECT id FROM passages WHERE book_id = ?)`,
  )
  .run(smallBook.id);

const enq = await post("/api/fabric/reembed", { bookId: smallBook.id });
check(
  "reembed enqueues",
  enq?.success && enq?.enqueued?.[0]?.passages === smallBook.n,
  JSON.stringify(enq?.enqueued),
);

const workerExit = await new Promise<number>((resolve) => {
  // node_modules/.bin/tsx directly: `pnpm tsx` re-validates the lockfile and
  // dies when the shell's pnpm differs from packageManager's.
  const child = spawn(
    "node_modules/.bin/tsx",
    ["scripts/fleet-worker.ts", "--url", BASE, "--once", "--ignore-eligibility"],
    {
      env: { ...process.env, FABRIC_TOKEN: enrolled.token },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  child.on("exit", (code) => resolve(code ?? 1));
});
check("fleet worker exits cleanly", workerExit === 0, String(workerExit));

// Code mobility: a kernel kind round-trips through the generic js-kernel host.
const { kernelHashFor } = await import("../app/lib/fabric/kernels");
const kernelEnq = await post(
  "/api/fabric/items",
  {
    kind: "kernel-wordstats",
    payload: {
      kernelHash: kernelHashFor("wordstats"),
      texts: ["the quick brown fox", "hello hello world"],
    },
  },
  H,
);
check("kernel job enqueues", kernelEnq?.success === true);
const kernelExit = await new Promise<number>((resolve) => {
  const child = spawn(
    "node_modules/.bin/tsx",
    ["scripts/fleet-worker.ts", "--url", BASE, "--once", "--ignore-eligibility"],
    {
      env: { ...process.env, FABRIC_TOKEN: enrolled.token },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  child.on("exit", (code) => resolve(code ?? 1));
});
check("kernel host exits cleanly", kernelExit === 0, String(kernelExit));
const kernelItem = rawDb
  .prepare(
    "SELECT result FROM work_items WHERE kind = 'kernel-wordstats' ORDER BY created_at DESC LIMIT 1",
  )
  .get() as { result: string | null } | undefined;
const kernelStats = kernelItem?.result ? JSON.parse(kernelItem.result) : null;
check(
  "kernel executed remotely with correct output",
  kernelStats?.stats?.[0]?.words === 4 && kernelStats?.stats?.[1]?.unique === 2,
  JSON.stringify(kernelStats)?.slice(0, 80),
);

// Naming jobs (foundation-models) legitimately remain queued for FM-capable
// devices; the encoder worker's own queue must be drained.
const remainingReembed = (
  rawDb
    .prepare(
      "SELECT COUNT(*) AS n FROM work_items WHERE kind = 'reembed-book' AND status != 'done'",
    )
    .get() as { n: number }
).n;
const status = await get("/api/fabric/status");
check(
  "reembed queue drained to done",
  remainingReembed === 0 && (status?.byStatus?.done ?? 0) >= 1,
  JSON.stringify(status?.byStatus),
);
const refreshed = (
  rawDb
    .prepare(
      `SELECT COUNT(*) AS n FROM embeddings WHERE kind = 'passage' AND model != 'stale/old'
     AND ref_id IN (SELECT id FROM passages WHERE book_id = ?)`,
    )
    .get(smallBook.id) as { n: number }
).n;
check(
  "worker vectors applied to substrate",
  refreshed === smallBook.n,
  `${refreshed}/${smallBook.n}`,
);

const afterReembed = await get(`/api/wander2/start?mode=book&bookId=${smallBook.id}`);
check("wander still works on reembedded book", (afterReembed?.stop?.steps?.length ?? 0) >= 1);

// ------------------------------------------------- C2 + S5 over the live queue
console.log("\n[7] Curriculum Tier B + audio trail (simulated device worker over HTTP)");
const smartDevice = await post("/api/fabric/devices", {
  name: "e2e-iphone",
  platform: "ios",
  capabilities: { runtimes: ["foundation-models", "kokoro"], ramClass: 8 },
});
const smartH = {
  "X-Fabric-Token": smartDevice.token as string,
  "Content-Type": "application/json",
};

// C2: enhance a curriculum, lease the scaffold job, post a validator-passing result.
const enhance = await post(`/api/topics/${topic.id}/curriculum/enhance`);
check(
  "scaffold jobs enqueue per module",
  (enhance?.enqueued?.length ?? 0) >= 1,
  JSON.stringify(enhance?.enqueued?.length),
);
// First FM lease may return an auto-enqueued naming job; find the scaffold.
let sJob = null;
for (let i = 0; i < 60; i++) {
  const lease = await post(
    "/api/fabric/lease",
    { capabilities: { runtimes: ["foundation-models"] } },
    smartH,
  );
  const job = lease?.job;
  if (!job) break;
  if (job.kind === "curriculum-scaffold") {
    sJob = job;
    break;
  }
  await post(
    `/api/fabric/work/${job.id}/result`,
    {
      result: { label: `E2E Pre ${i}`, blurb: "Synthetic shelf card from the e2e harness." },
      modelId: "device/e2e",
    },
    smartH,
  );
}
check("device leases scaffold job", sJob?.kind === "curriculum-scaffold");
if (sJob) {
  const badResult = await post(
    `/api/fabric/work/${sJob.id}/result`,
    { result: { title: "x", transitions: [] }, modelId: "device/e2e" },
    smartH,
  );
  check("junk scaffold rejected by validator", badResult?.success === false);
  // The queue also carries auto-enqueued realm/topic naming jobs (same
  // runtime requirement); drain with valid synthetic results until the
  // re-queued scaffold job comes back around.
  let scaffoldJob = null;
  for (let i = 0; i < 60 && !scaffoldJob; i++) {
    const lease = await post(
      "/api/fabric/lease",
      { capabilities: { runtimes: ["foundation-models"] } },
      smartH,
    );
    const job = lease?.job;
    if (!job) break;
    if (job.kind === "curriculum-scaffold") {
      scaffoldJob = job;
    } else if (job.kind === "realm-label" || job.kind === "topic-label") {
      await post(
        `/api/fabric/work/${job.id}/result`,
        {
          result: {
            label: `E2E Named ${i}`,
            blurb: "A synthetic shelf card written by the e2e harness.",
          },
          modelId: "device/e2e",
        },
        smartH,
      );
    } else {
      await post(`/api/fabric/work/${job.id}/release`, { reason: "e2e: unexpected kind" }, smartH);
    }
  }
  check("re-leased the scaffold job", !!scaffoldJob);
  const transitions = (scaffoldJob.payload.items as Array<{ ordinal: number }>).map((i) => ({
    ordinal: i.ordinal,
    text: `A device-authored bridge into passage ${i.ordinal} of this theme.`,
  }));
  const goodResult = await post(
    `/api/fabric/work/${scaffoldJob.id}/result`,
    { result: { title: "A Device-Named Study Path", transitions }, modelId: "device/e2e" },
    smartH,
  );
  check("valid scaffold accepted + applied", goodResult?.success === true);
  const cur2 = await get(`/api/topics/${topic.id}/curriculum`);
  check(
    "curriculum shows device scaffolding",
    cur2?.curriculum?.builder === "device" &&
      cur2?.curriculum?.items?.some((i: { transition: string }) =>
        i.transition.includes("device-authored"),
      ),
    cur2?.curriculum?.builder,
  );
}

// S5: render the saved trail — upload a WAV artifact blob, post the result, stream it back.
const render = await post(`/api/trails/${saved.id}/render`);
check("trail render enqueues", render?.success === true);
const renderLease = await post(
  "/api/fabric/lease",
  { capabilities: { runtimes: ["kokoro"] } },
  smartH,
);
check("device leases render job", renderLease?.job?.kind === "tts-render-trail");
if (renderLease?.job) {
  const sampleCount = 24000; // 1s of silence — plausible WAV
  const pcm = Buffer.alloc(44 + sampleCount * 2); // header zeroed; fine for transport test
  pcm.write("RIFF", 0, "ascii");
  const upload = await fetch(`${BASE}/api/fabric/work/${renderLease.job.id}/artifact`, {
    method: "POST",
    headers: { "X-Fabric-Token": smartDevice.token as string, "Content-Type": "audio/wav" },
    body: pcm,
  }).then((r) => r.json());
  check("artifact uploads content-addressed", /^[0-9a-f]{64}$/.test(upload?.artifactHash ?? ""));
  const renderResult = await post(
    `/api/fabric/work/${renderLease.job.id}/result`,
    {
      result: { artifactHash: upload.artifactHash, durationSec: 1, sampleCount },
      modelId: "kokoro/e2e",
      mime: "audio/wav",
      artifactHash: upload.artifactHash,
    },
    smartH,
  );
  check("render result accepted + pinned to trail", renderResult?.success === true);
  const audio = await fetch(`${BASE}/api/trails/${saved.id}/audio`, { headers: H });
  check(
    "trail audio streams back",
    audio.status === 200 && audio.headers.get("content-type") === "audio/wav",
    String(audio.status),
  );
}

// ---------------------------------------------------------------- summary
console.log(`\nE2E: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.error("Failures:");
  for (const f of failures) console.error(`  - ${f}`);
}
server.close();
process.exit(failed ? 1 : 0);
