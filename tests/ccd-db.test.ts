/**
 * DB-backed flows over an isolated temp data root (COMPENDUS_DATA_DIR, set in
 * tests/setup.ts). Covers the web READER flow (book + CCD → renderable content),
 * the ccdStatus readiness gating, and the recent hardening fixes: generateCcd
 * persistence, deleteBook artifact cleanup, and reference-based orphan detection.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";

const EPUB = (n: string) => resolve(import.meta.dirname, "..", "server/__fixtures__/epub", n);

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any, books: any, eq: any;
let storeCcdBundle: any, resolveStoragePath: any;
let getContent: any, generateCcd: any, deleteBook: any, adminDataStats: any, adminListFiles: any;
let buildBundleFromEpub: any, CCD_VERSION: string, ccdStatusOf: any;

beforeAll(async () => {
  ({ db, books } = await import("../app/lib/db"));
  ({ eq } = await import("drizzle-orm"));
  const storage = await import("../app/lib/storage");
  storeCcdBundle = storage.storeCcdBundle;
  resolveStoragePath = storage.resolveStoragePath;
  ({ getContent } = await import("../app/lib/reader/content-store"));
  ({ generateCcd } = await import("../app/lib/processing/ccd"));
  ({ deleteBook, adminDataStats, adminListFiles } = await import("../app/actions/books"));
  ({ buildBundleFromEpub } = await import("../app/lib/content-ast/bundle"));
  ({ CCD_VERSION } = await import("../app/lib/content-ast/types"));
  ({ ccdStatusOf } = await import("../app/lib/book-types"));
});

afterAll(async () => {
  // Tear down the worker pool (generateCcd may have spawned it) so vitest exits.
  try {
    (await import("../app/lib/processing/worker-pool")).getWorkerPool().shutdown();
  } catch {
    /* not started */
  }
});

function seedBook(id: string, opts: Record<string, unknown> = {}) {
  const ext = (opts.ext as string) ?? "epub";
  db.insert(books)
    .values({
      id,
      filePath: `data/books/${id}.${ext}`,
      fileName: `${id}.${ext}`,
      fileSize: (opts.fileSize as number) ?? 100,
      fileHash: id,
      mimeType: "application/epub+zip",
      title: (opts.title as string) ?? `Book ${id}`,
      ccdPath: (opts.ccdPath as string) ?? null,
      ccdVersion: (opts.ccdVersion as string) ?? null,
      ccdError: (opts.ccdError as string) ?? null,
      convertedEpubPath: (opts.convertedEpubPath as string) ?? null,
      coverPath: (opts.coverPath as string) ?? null,
    })
    .run();
  return db.select().from(books).where(eq(books.id, id)).get();
}

function writeDataFile(rel: string, content: Buffer | string) {
  const abs = resolveStoragePath(rel);
  mkdirSync(resolve(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

describe("reader flow: getContent over a book + its CCD bundle", () => {
  it("ready book → renderable TextContent with the right chapters", async () => {
    const id = "rdr-ready";
    const bundle = await buildBundleFromEpub(EPUB("childrens-media-query.epub"), id, "epub");
    const ccdPath = storeCcdBundle(id, JSON.stringify(bundle));
    seedBook(id, { ccdPath, ccdVersion: CCD_VERSION });

    const content = await getContent(id);
    expect(content).not.toBeNull();
    expect(content.type).toBe("text");
    expect(content.chapters.length).toBe(bundle.chapters.length);
    expect(content.chapters.some((c: any) => c.html.trim().length > 0)).toBe(true);
  });

  it("processing book (no CCD yet) → getContent null, status 'processing'", async () => {
    const id = "rdr-processing";
    const book = seedBook(id);
    expect(await getContent(id)).toBeNull();
    expect(ccdStatusOf(book)).toBe("processing");
  });

  it("failed book (ccdError set) → getContent null, status 'failed'", async () => {
    const id = "rdr-failed";
    const book = seedBook(id, { ccdError: "Corrupted zip" });
    expect(await getContent(id)).toBeNull();
    expect(ccdStatusOf(book)).toBe("failed");
  });
});

describe("generateCcd persistence", () => {
  it("success: writes ccd_path + current version, clears error, and the book becomes readable", async () => {
    const id = "gen-ok";
    writeDataFile(`data/books/${id}.epub`, readFileSync(EPUB("childrens-media-query.epub")));
    const book = seedBook(id);
    const result = await generateCcd(book);
    expect(result).not.toBeNull();
    const row = db.select().from(books).where(eq(books.id, id)).get();
    expect(row.ccdPath).toBeTruthy();
    expect(row.ccdVersion).toBe(CCD_VERSION);
    expect(row.ccdError).toBeNull();
    expect(await getContent(id)).not.toBeNull();
  });

  it("failure: a corrupt file records ccd_error (so the book shows 'failed', not stuck)", async () => {
    const id = "gen-bad";
    writeDataFile(`data/books/${id}.epub`, Buffer.from("this is not a zip / epub"));
    const book = seedBook(id);
    await expect(generateCcd(book)).rejects.toBeTruthy();
    const row = db.select().from(books).where(eq(books.id, id)).get();
    expect(row.ccdError).toBeTruthy();
    expect(row.ccdPath).toBeNull();
    expect(ccdStatusOf(row)).toBe("failed");
  });
});

describe("deleteBook removes ALL artifacts (no leaks)", () => {
  it("source + cover + converted EPUB + CCD bundle + resource cache are all deleted", async () => {
    const id = "del-1";
    const source = writeDataFile(`data/books/${id}.epub`, "src");
    const cover = writeDataFile(`data/covers/${id}.jpg`, "cover");
    const converted = writeDataFile(`data/books/${id}-converted.epub`, "conv");
    const ccd = resolveStoragePath(storeCcdBundle(id, JSON.stringify({ chapters: [] })));
    const cacheFile = writeDataFile(`data/resource-cache/${id}/ccd-pack.zip`, "pack");
    seedBook(id, {
      coverPath: `data/covers/${id}.jpg`,
      convertedEpubPath: `data/books/${id}-converted.epub`,
      ccdPath: `data/books/${id}.ccd.json.gz`,
    });

    for (const p of [source, cover, converted, ccd, cacheFile]) expect(existsSync(p)).toBe(true);
    expect(await deleteBook(id)).toBe(true);
    for (const p of [source, cover, converted, ccd, cacheFile]) expect(existsSync(p)).toBe(false);
    expect(db.select().from(books).where(eq(books.id, id)).get()).toBeUndefined();
  });
});

describe("admin orphan detection is reference-based", () => {
  it("CCD bundles/converted EPUBs of live books are NOT orphaned; unreferenced files ARE", async () => {
    // Live reflowable book: source + CCD bundle both on disk + referenced.
    const a = "adm-live";
    writeDataFile(`data/books/${a}.epub`, "src-a");
    const ccdRel = storeCcdBundle(a, JSON.stringify({ chapters: [] })); // writes <a>.ccd.json.gz
    seedBook(a, { ccdPath: ccdRel, ccdVersion: CCD_VERSION });

    // Live mobi book: source (.mobi) + a converted .epub — both referenced.
    const b = "adm-mobi";
    writeDataFile(`data/books/${b}.mobi`, "src-b");
    writeDataFile(`data/books/${b}-converted.epub`, "conv-b");
    seedBook(b, { ext: "mobi", convertedEpubPath: `data/books/${b}-converted.epub` });

    // A genuinely orphaned file: on disk, referenced by no book (e.g. leaked by a
    // past delete). Includes a leaked CCD bundle to prove those surface now.
    writeDataFile(`data/books/orphan-junk.epub`, "junk");
    writeDataFile(`data/books/orphan-leaked.ccd.json.gz`, "leaked-bundle");

    const orphans = await adminListFiles({ category: "orphaned", page: 1, pageSize: 200 });
    const matchedFiles = await adminListFiles({ category: "matched", page: 1, pageSize: 200 });
    const orphanNames = orphans.items.map((f: any) => f.name);
    const matchedNames = matchedFiles.items.map((f: any) => f.name);

    // The live book's CCD bundle + converted epub are referenced → NOT orphaned.
    expect(orphanNames).not.toContain(`${a}.ccd.json.gz`);
    expect(orphanNames).not.toContain(`${b}-converted.epub`);
    // The unreferenced files ARE orphaned (incl. a leaked CCD bundle from a past delete).
    expect(orphanNames).toContain("orphan-junk.epub");
    expect(orphanNames).toContain("orphan-leaked.ccd.json.gz");
    // Matched = book SOURCE files: the .mobi source is matched, but its converted
    // .epub is NOT double-counted (it's a referenced derived artifact), and the CCD
    // bundle is never a "book file".
    expect(matchedNames).toContain(`${a}.epub`);
    expect(matchedNames).toContain(`${b}.mobi`);
    expect(matchedNames).not.toContain(`${b}-converted.epub`);
    expect(matchedNames).not.toContain(`${a}.ccd.json.gz`);
  });
});
