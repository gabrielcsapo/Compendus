/**
 * PDF → CCD kernel: converts a PDF's bytes into the canonical ContentBundle
 * on whatever fleet device runs it (browser tab, Node harness). The host
 * pre-fetches the book file (payload.fileRef) and injects payload.__bytes;
 * the kernel itself is pure compute. The host uploads the returned
 * artifactJson as a content-addressed artifact and completes with its hash.
 *
 * Mirrors app/lib/content-ast/bundle.ts buildBundleFromPdf exactly — keep in
 * sync if that assembly changes (the conversion itself is shared code).
 */
import "../../app/lib/reader/parsers/pdf-polyfill.js";
// Bundle pdfjs's worker INTO the kernel (self-contained by definition):
// without this, the fake-worker path tries to import pdf.worker.mjs from
// alongside the bundle, which doesn't exist on fleet hosts.
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
(globalThis as Record<string, unknown>).pdfjsWorker = pdfjsWorker;
import { convertPdf } from "../../app/lib/content-ast/from-pdf.js";
import {
  CCD_VERSION,
  type Block,
  type Chapter,
  type TocEntry,
} from "../../app/lib/content-ast/types.js";

function blockChars(blocks: Block[]): number {
  let n = 0;
  for (const b of blocks) {
    if ("inlines" in b) {
      for (const i of b.inlines) if (i.t === "span") n += i.text.length;
    }
  }
  return n;
}

export default async function run(payload: {
  bookId: string;
  expectCcdVersion: string;
  __bytes?: ArrayBuffer;
}): Promise<{
  artifactJson: string;
  result: { chapters: number; totalVirtual: number; ccdVersion: string };
}> {
  if (!payload.__bytes) throw new Error("host did not inject file bytes");
  const { blocks } = await convertPdf(new Uint8Array(payload.__bytes));
  const len = Math.max(1, blockChars(blocks));
  const chapter: Chapter = {
    id: "pdf",
    spineIndex: 0,
    blocks,
    virtualStart: 0,
    virtualLength: len,
  };
  const toc: TocEntry[] = blocks
    .filter((b): b is Extract<Block, { t: "heading" }> => b.t === "heading" && b.level <= 2)
    .slice(0, 200)
    .map((h) => ({
      title: h.inlines
        .map((i) => (i.t === "span" ? i.text : ""))
        .join("")
        .trim(),
      spineIndex: 0,
      blockId: h.id,
      level: h.level - 1,
    }))
    .filter((e) => e.title);
  const bundle = {
    ccdVersion: CCD_VERSION,
    bookId: payload.bookId,
    sourceFormat: "pdf",
    readingOrder: [{ id: "pdf", spineIndex: 0, virtualStart: 0, virtualLength: len }],
    toc,
    totalVirtual: len,
    chapters: [chapter],
  };
  return {
    artifactJson: JSON.stringify(bundle),
    result: { chapters: 1, totalVirtual: len, ccdVersion: CCD_VERSION },
  };
}
