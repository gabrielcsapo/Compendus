/**
 * Seeds the e2e database + storage into an isolated COMPENDUS_DATA_DIR.
 *
 * IMPORTANT: callers MUST set process.env.COMPENDUS_DATA_DIR BEFORE importing
 * this module's dependencies — db/storage open their root at import time. We
 * therefore dynamic-import everything inside `seed()`, after the env is set.
 */
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ADMIN_PROFILE, BOOKS, ADMIN_FILLER_COUNT, E2E_DATA_DIR } from "./constants.js";

const EPUB_FIXTURE = resolve(
  import.meta.dirname,
  "..",
  "..",
  "server/__fixtures__/epub/moby-dick.epub",
);

export async function seed(dataDir: string = E2E_DATA_DIR): Promise<void> {
  // Fresh root every run so the suite is deterministic.
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  process.env.COMPENDUS_DATA_DIR = dataDir;

  // Dynamic imports — these open the DB/storage at the now-correct data root.
  const { db, books, profiles } = await import("../../app/lib/db/index.js");
  const { storeCcdBundle, resolveStoragePath } = await import("../../app/lib/storage/index.js");
  const { buildBundleFromEpub } = await import("../../app/lib/content-ast/bundle.js");
  const { CCD_VERSION } = await import("../../app/lib/content-ast/types.js");

  // One admin profile → RSC actions resolve it via the compendus-profile cookie,
  // and a single profile also auto-selects in the Hono API middleware.
  db.insert(profiles)
    .values({ id: ADMIN_PROFILE.id, name: ADMIN_PROFILE.name, isAdmin: true })
    .run();

  const writeFile = (rel: string, content: Buffer | string) => {
    const abs = resolveStoragePath(rel);
    mkdirSync(resolve(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  };

  type SeedBook = {
    id: string;
    title: string;
    author?: string;
    ext?: string;
    ccdPath?: string | null;
    ccdVersion?: string | null;
    ccdError?: string | null;
    /** Write a source file to data/books/<id>.<ext> (so it counts as a "matched" admin file). */
    withSource?: boolean;
  };

  const insertBook = (b: SeedBook) => {
    const ext = b.ext ?? "epub";
    if (b.withSource !== false) writeFile(`data/books/${b.id}.${ext}`, `e2e-source-${b.id}`);
    db.insert(books)
      .values({
        id: b.id,
        filePath: `data/books/${b.id}.${ext}`,
        fileName: `${b.id}.${ext}`,
        fileSize: 100,
        fileHash: `e2e-${b.id}`,
        mimeType: "application/epub+zip",
        title: b.title,
        authors: JSON.stringify(b.author ? [b.author] : []),
        ccdPath: b.ccdPath ?? null,
        ccdVersion: b.ccdVersion ?? null,
        ccdError: b.ccdError ?? null,
      })
      .run();
  };

  // READY: a real CCD bundle on disk so getContent() returns renderable text.
  const bundle = await buildBundleFromEpub(EPUB_FIXTURE, BOOKS.ready.id, "epub");
  const ccdPath = storeCcdBundle(BOOKS.ready.id, JSON.stringify(bundle));
  insertBook({
    ...BOOKS.ready,
    ccdPath,
    ccdVersion: CCD_VERSION,
    withSource: false, // the .ccd.json.gz is the content; no raw source needed for the reader
  });

  // PROCESSING: no CCD, no job → ccdStatus "processing" → reader gates.
  insertBook({ ...BOOKS.processing, withSource: false });

  // FAILED: ccdError set → ccdStatus "failed" → reader gates with the failure copy.
  insertBook({ ...BOOKS.failed, ccdError: "E2E: corrupt source (zip)", withSource: false });

  // SEARCHABLE: unique title/author for the library + site-search assertions.
  insertBook(BOOKS.searchable);

  // Filler books WITH source files so "Matched Files" spans more than one page.
  for (let i = 1; i <= ADMIN_FILLER_COUNT; i++) {
    const n = String(i).padStart(3, "0");
    insertBook({ id: `e2e-filler-${n}`, title: `E2E Filler Book ${n}`, author: "Filler Author" });
  }

  // Sanity: prove the fixture is intact (fail fast with a clear message otherwise).
  void readFileSync(EPUB_FIXTURE);
}
