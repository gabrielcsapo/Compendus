/**
 * CCD generation for a book: route by format → build the bundle → store it →
 * record `ccdPath`/`ccdVersion` on the book row.
 *
 *   epub        → XHTML→CCD (direct)
 *   pdf         → PDF→CCD (direct; original kept for fidelity render)
 *   mobi / azw3 → ensureEpub (convert to EPUB) → XHTML→CCD
 *
 * Comics (cbz/cbr) and audio (m4b/mp3/m4a) have no CCD — they keep their own
 * code paths.
 */
import { eq } from "drizzle-orm";
import { readFile } from "fs/promises";
import { db, books } from "../db";
import { resolveStoragePath, storeCcdBundle } from "../storage";
import { ensureEpub } from "./ensure-epub";
import { runInWorker } from "./utils";
import { buildBundleFromEpub, buildBundleFromPdf } from "../content-ast/bundle";
import { CCD_VERSION, type ContentBundle, type SourceFormat } from "../content-ast/types";

type BookRow = typeof books.$inferSelect;

const CCD_FORMATS = new Set<string>(["epub", "pdf", "mobi", "azw3", "lit"]);
export function bookSupportsCcd(format: string): boolean {
  return CCD_FORMATS.has(format);
}

export interface CcdResult {
  ccdPath: string;
  ccdVersion: string;
  chapters: number;
  totalVirtual: number;
}

/** Build + store the CCD bundle and persist its path/version. Returns null for
 *  formats without a CCD (comics/audio) or empty results. */
export async function generateCcd(book: BookRow): Promise<CcdResult | null> {
  if (!bookSupportsCcd(book.format)) return null;

  try {
    // Resolve the source path (mobi/azw3/lit are converted to EPUB first).
    let sourcePath: string;
    let workerFormat: "epub" | "pdf";
    if (book.format === "pdf") {
      sourcePath = resolveStoragePath(book.filePath);
      workerFormat = "pdf";
    } else if (book.format === "epub") {
      sourcePath = resolveStoragePath(book.filePath);
      workerFormat = "epub";
    } else {
      sourcePath = await ensureEpub(book);
      workerFormat = "epub";
    }

    // Build the bundle in a WORKER THREAD so the conversion never blocks the
    // server's event loop (the backfill loop pegs a core otherwise). Falls back
    // to the main thread if the worker is unavailable.
    const buffer = await readFile(sourcePath);
    const bundle = await runInWorker<ContentBundle>("buildCcd", buffer, workerFormat, () =>
      workerFormat === "pdf"
        ? buildBundleFromPdf(sourcePath, book.id)
        : buildBundleFromEpub(sourcePath, book.id, book.format as SourceFormat),
    );
    // The worker doesn't know the bookId / original format — patch them in.
    bundle.bookId = book.id;
    bundle.sourceFormat = book.format as SourceFormat;

    if (!bundle.chapters.length) {
      // Converted, but nothing readable came out (e.g. a pure-vector-only book) —
      // record it as a failure so the book shows "failed", not perpetually "processing".
      await db
        .update(books)
        .set({ ccdError: "No readable content could be extracted" })
        .where(eq(books.id, book.id));
      return null;
    }

    const ccdPath = storeCcdBundle(book.id, JSON.stringify(bundle));
    await db
      .update(books)
      .set({ ccdPath, ccdVersion: CCD_VERSION, ccdError: null })
      .where(eq(books.id, book.id));
    return {
      ccdPath,
      ccdVersion: CCD_VERSION,
      chapters: bundle.chapters.length,
      totalVirtual: bundle.totalVirtual,
    };
  } catch (e) {
    // Persist the failure so book.ccdStatus reports "failed" (corrupt zip, DRM,
    // unsupported, …). Rethrow so the caller (backfill) still counts/logs it.
    const message = e instanceof Error ? e.message : String(e);
    await db.update(books).set({ ccdError: message }).where(eq(books.id, book.id));
    throw e;
  }
}

/** True when a book still needs (re)generation at the current CCD version. */
export function needsCcd(book: Pick<BookRow, "format" | "ccdPath" | "ccdVersion">): boolean {
  if (!bookSupportsCcd(book.format)) return false;
  return !book.ccdPath || book.ccdVersion !== CCD_VERSION;
}
