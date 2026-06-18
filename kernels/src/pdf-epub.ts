/**
 * PDF → EPUB kernel: runs the full conversion (text positioning, embedded
 * images, chapter detection, EPUB assembly) on whatever fleet device leases it
 * — the conversion that OOM-killed the 2-core box runs fine on a charging
 * laptop or a browser tab. The host pre-fetches the book file
 * (payload.fileRef) and injects payload.__bytes; the kernel returns the EPUB
 * as base64 (artifactB64) for the host to upload as a binary artifact.
 *
 * Shares app/lib/processing/pdf-to-epub.ts verbatim — the only divergence is
 * the injected pure-JS PNG encoder (no sharp on fleet hosts).
 *
 * The EPUB rides back as RAW BYTES (artifactBytes), never base64: the kernel
 * return value is an in-process function result (no serialization boundary),
 * and a base64 string of a GB-scale EPUB exceeds V8's max string length —
 * found the hard way on a 1.2GB conversion.
 */
import "../../app/lib/reader/parsers/pdf-polyfill.js";
// Bundle pdfjs's worker INTO the kernel (self-contained by definition).
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
(globalThis as Record<string, unknown>).pdfjsWorker = pdfjsWorker;
import { convertPdfToEpub } from "../../app/lib/processing/pdf-to-epub.js";
import { encodePng } from "./lib/png.js";

export default async function run(payload: {
  bookId: string;
  title?: string;
  authors?: string[];
  language?: string;
  __bytes?: ArrayBuffer;
}): Promise<{ artifactBytes: Uint8Array; mime: string; result: { bytes: number } }> {
  if (!payload.__bytes) throw new Error("host did not inject file bytes");
  const epub = await convertPdfToEpub(
    new Uint8Array(payload.__bytes),
    { title: payload.title, authors: payload.authors, language: payload.language },
    { encodePng: async (raw, w, h, c) => encodePng(raw, w, h, c) },
  );
  return {
    artifactBytes: epub,
    mime: "application/epub+zip",
    result: { bytes: epub.length },
  };
}
