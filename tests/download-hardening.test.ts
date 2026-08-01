import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { resolveContained, streamFileResponse } from "../server/lib/file-serving";
import { resolveDownloadArtifact } from "../server/lib/download-artifacts";
import { requireExplicitProfile } from "../server/middleware/profile";
import { app as serverApp } from "../server/index";
import { db, books, profiles } from "../app/lib/db";
import { resolveStoragePath } from "../app/lib/storage";

const scratch = mkdtempSync(join(tmpdir(), "compendus-download-test-"));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("range-safe artifact streaming", () => {
  const path = join(scratch, "bytes.bin");
  const app = new Hono();
  beforeAll(() => {
    writeFileSync(path, Buffer.from("0123456789"));
    app.get("/file", (c) => streamFileResponse(c, path, { etag: '"stable"' }));
  });

  it("serves an open-ended resume range through EOF", async () => {
    const response = await app.request("/file", { headers: { Range: "bytes=4-" } });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 4-9/10");
    expect(await response.text()).toBe("456789");
  });

  it("serves RFC suffix ranges", async () => {
    const response = await app.request("/file", { headers: { Range: "bytes=-3" } });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("789");
  });

  it("rejects malformed or multiple ranges", async () => {
    expect((await app.request("/file", { headers: { Range: "bytes=0-1,4-5" } })).status).toBe(416);
  });

  it("ignores a range when If-Range no longer matches", async () => {
    const response = await app.request("/file", {
      headers: { Range: "bytes=4-", "If-Range": '"old"' },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("0123456789");
  });
});

describe("asset path containment", () => {
  it("allows children and rejects traversal", () => {
    const root = resolve(scratch, "root");
    expect(resolveContained(root, "nested/book.epub")).toBe(resolve(root, "nested/book.epub"));
    expect(resolveContained(root, "../secret")).toBeNull();
    expect(resolveContained(root, "/etc/passwd")).toBeNull();
  });
});

describe("download authorization", () => {
  const app = new Hono();
  app.use("/file", async (c, next) => {
    // Simulate profileMiddleware's single-profile compatibility fallback.
    // Download routes must still require a credential supplied by the caller.
    c.set("profileId", "only-profile");
    c.set("profileName", "Only Profile");
    c.set("isAdmin", true);
    await next();
  });
  app.use("/file", requireExplicitProfile);
  app.get("/file", (c) => c.text("protected bytes"));

  it("rejects a single-profile fallback without an explicit credential", async () => {
    expect((await app.request("/file")).status).toBe(401);
  });

  it("allows an explicitly authenticated profile", async () => {
    const response = await app.request("/file", {
      headers: { "X-Profile-Id": "only-profile" },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("protected bytes");
  });

  it("rejects a mismatched credential even when fallback resolved a profile", async () => {
    const response = await app.request("/file", {
      headers: { "X-Profile-Id": "not-the-resolved-profile" },
    });
    expect(response.status).toBe(401);
  });
});

describe("server authorization boundary", () => {
  it("keeps profile discovery public but protects selected-profile data", async () => {
    expect((await serverApp.request("/api/profiles")).status).toBe(200);
    expect((await serverApp.request("/api/profiles/me")).status).toBe(401);
    expect((await serverApp.request("/api/books?limit=1")).status).toBe(401);
    expect((await serverApp.request("/api/collections")).status).toBe(401);
  });

  it("allows protected API data only with an explicit valid profile", async () => {
    const profile = db.select().from(profiles).get();
    expect(profile).toBeDefined();
    const response = await serverApp.request("/api/books?limit=1", {
      headers: { "X-Profile-Id": profile!.id },
    });
    expect(response.status).toBe(200);
  });

  it("rejects an invalid explicit profile instead of using compatibility fallback", async () => {
    const response = await serverApp.request("/api/books?limit=1", {
      headers: { "X-Profile-Id": "00000000-0000-0000-0000-000000000000" },
    });
    expect(response.status).toBe(401);
  });

  it("rejects unauthenticated admin and upload routes before handlers run", async () => {
    expect((await serverApp.request("/api/admin/backfill-graph", { method: "POST" })).status).toBe(
      401,
    );
    expect((await serverApp.request("/api/upload", { method: "POST" })).status).toBe(401);
  });
});

describe("download artifact contract", () => {
  it("returns the exact source byte length and SHA-256", async () => {
    const id = `artifact-${Date.now()}`;
    const bytes = Buffer.from("%PDF-1.7\nverified fixture\n");
    const relative = `data/books/${id}.pdf`;
    const absolute = resolveStoragePath(relative);
    writeFileSync(absolute, bytes);
    db.insert(books)
      .values({
        id,
        filePath: relative,
        fileName: `${id}.pdf`,
        fileSize: bytes.length,
        fileHash: createHash("sha256").update(bytes).digest("hex"),
        mimeType: "application/pdf",
        title: "Artifact",
      })
      .run();
    try {
      const artifact = await resolveDownloadArtifact(id);
      expect(artifact.byteLength).toBe(bytes.length);
      expect(artifact.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(artifact.peakDiskBytes).toBeGreaterThan(bytes.length);

      const replacement = Buffer.from("%PDF-1.7\na different immutable revision\n");
      writeFileSync(absolute, replacement);
      const revised = await resolveDownloadArtifact(id);
      expect(revised.path).not.toBe(artifact.path);
      expect(revised.sha256).toBe(createHash("sha256").update(replacement).digest("hex"));
      expect(readFileSync(artifact.path)).toEqual(bytes);

      const profile = db.select().from(profiles).get();
      expect(profile).toBeDefined();
      const historical = await serverApp.request(
        `/api/downloads/${id}/file?artifact=${artifact.sha256}`,
        {
          headers: {
            "X-Profile-Id": profile!.id,
            Range: "bytes=0-4",
          },
        },
      );
      expect(historical.status).toBe(206);
      expect(historical.headers.get("content-range")).toBe(`bytes 0-4/${bytes.length}`);
      expect(Buffer.from(await historical.arrayBuffer())).toEqual(bytes.subarray(0, 5));
    } finally {
      db.delete(books).where(eq(books.id, id)).run();
      rmSync(absolute, { force: true });
      rmSync(resolveStoragePath(`data/resource-cache/${id}`), { recursive: true, force: true });
    }
  });
});
