/**
 * CCD bundle assembly — turns a source file into a `ContentBundle` (the
 * `.ccd.json` artifact): a ContentDocument manifest + all chapters inline.
 *
 * Two paths only (per the plan): EPUB (XHTML→CCD) and PDF (PDF→CCD). MOBI/AZW3/
 * LIT are converted to EPUB upstream (`ensureEpub`) and arrive here as EPUB.
 */
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { initEpubFile } from "../epub-parser.js";
import { convertChapter } from "./from-epub.js";
import { convertPdf } from "./from-pdf.js";
import {
  CCD_VERSION,
  type ContentBundle,
  type Chapter,
  type ChapterRef,
  type Block,
  type Inline,
  type TocEntry,
  type SourceFormat,
  type WritingMode,
} from "./types.js";

/** POSIX-join an in-EPUB href against a base file's directory, resolving `..`/`.`. */
function joinEpubHref(baseFileHref: string, ref: string): string {
  if (/^[a-z]+:/i.test(ref) || ref.startsWith("/")) return ref.replace(/^\/+/, "");
  const baseDir = baseFileHref.split("/").slice(0, -1);
  const out = [...baseDir];
  for (const seg of ref.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/** For an SVG-in-spine FXL page, return the in-EPUB handle of the single raster
 *  image it wraps (the common `<svg><image xlink:href="…"/></svg>` cover/page),
 *  or null if it's pure vector art (no native image to show). */
async function svgPageImage(
  epub: { getResource(path: string): Promise<Buffer | null> },
  svgHref: string,
): Promise<string | null> {
  const buf = await epub.getResource(svgHref);
  if (!buf) return null;
  const svg = buf.toString("utf8");
  const m = svg.match(/<image\b[^>]*?(?:xlink:)?href\s*=\s*["']([^"']+)["']/i);
  if (!m) return null;
  return joinEpubHref(svgHref, m[1]);
}

/** Reading-text length of a block tree — the virtual-position unit (chars). */
function blockChars(blocks: Block[]): number {
  let n = 0;
  for (const b of blocks) {
    switch (b.t) {
      case "paragraph":
      case "heading":
        n += inlineChars(b.inlines);
        break;
      case "blockquote":
      case "container":
        n += blockChars(b.children);
        break;
      case "list":
        for (const it of b.items) n += blockChars(it);
        break;
      case "verse":
        for (const ln of b.lines) n += inlineChars(ln.inlines);
        break;
      case "definitionList":
        for (const it of b.items) n += inlineChars(it.term) + blockChars(it.definition);
        break;
      case "table":
        for (const r of b.rows) for (const c of r.cells) n += blockChars(c.blocks);
        if (b.caption) n += blockChars(b.caption);
        break;
      case "image":
        if (b.caption) n += blockChars(b.caption);
        break;
      case "code":
        n += b.text.length;
        break;
    }
  }
  return n;
}
function inlineChars(inlines: Inline[]): number {
  let n = 0;
  for (const i of inlines) {
    if (i.t === "span") n += i.text.length;
    else if (i.t === "ruby") n += i.base.length;
  }
  return n;
}

/** Plain reading text of a block tree (block-separated) — the NLP/graph substrate. */
export function blocksToPlainText(blocks: Block[]): string {
  let s = "";
  const inl = (inlines: Inline[]) => {
    for (const i of inlines) {
      if (i.t === "span") s += i.text;
      else if (i.t === "ruby") s += i.base;
    }
  };
  for (const b of blocks) {
    switch (b.t) {
      case "paragraph":
      case "heading":
        inl(b.inlines);
        s += "\n";
        break;
      case "blockquote":
      case "container":
        s += blocksToPlainText(b.children);
        break;
      case "list":
        for (const it of b.items) s += blocksToPlainText(it);
        break;
      case "verse":
        for (const ln of b.lines) {
          inl(ln.inlines);
          s += "\n";
        }
        break;
      case "definitionList":
        for (const it of b.items) {
          inl(it.term);
          s += "\n" + blocksToPlainText(it.definition);
        }
        break;
      case "table":
        for (const r of b.rows) for (const c of r.cells) s += blocksToPlainText(c.blocks);
        if (b.caption) s += blocksToPlainText(b.caption);
        break;
      case "image":
        if (b.caption) s += blocksToPlainText(b.caption);
        break;
      case "code":
        s += b.text + "\n";
        break;
    }
  }
  return s;
}

/** Build a CCD bundle from an EPUB on disk (also the MOBI/AZW3/LIT path, after conversion). */
export async function buildBundleFromEpub(
  epubInput: string | Uint8Array,
  bookId: string,
  sourceFormat: SourceFormat,
): Promise<ContentBundle> {
  const resDir = mkdtempSync(join(tmpdir(), "ccd-res-"));
  try {
    const epub = await initEpubFile(epubInput, resDir);
    const spine = epub.getSpine();
    const meta = epub.getMetadata();
    const isFixedLayout =
      meta.metas?.["rendition:layout"] === "pre-paginated" ||
      spine.some((s) => (s.properties || "").includes("rendition:layout-pre-paginated"));
    const writingMode: WritingMode | undefined =
      meta.metas?.["rendition:flow"]?.includes("vertical") ||
      /vertical/.test(meta.metas?.["primary-writing-mode"] || "")
        ? "vertical-rl"
        : undefined;

    // href (without fragment) → spineIndex, for TOC mapping.
    const hrefToSpine = new Map<string, number>();
    spine.forEach((s, i) => {
      if (s.href) hrefToSpine.set(s.href.split("#")[0], i);
    });

    const chapters: Chapter[] = [];
    const readingOrder: ChapterRef[] = [];
    let virtual = 0;

    // Emit a single-image "page" chapter for a fixed-layout spine item whose body
    // IS an image (or an SVG wrapping one). Keeps FXL fully inside CCD — one image
    // block per page — so it renders natively from the pack with no source file.
    const pushImagePage = (i: number, resource: string) => {
      const block: Block = { t: "image", id: `${i}:0`, resource };
      const len = 1; // one page unit
      const title = spine[i].id;
      chapters.push({
        id: spine[i].id,
        href: spine[i].href,
        spineIndex: i,
        blocks: [block],
        virtualStart: virtual,
        virtualLength: len,
      });
      readingOrder.push({
        id: spine[i].id,
        title,
        spineIndex: i,
        virtualStart: virtual,
        virtualLength: len,
      });
      virtual += len;
    };

    for (let i = 0; i < spine.length; i++) {
      const mt = (spine[i].mediaType || "").toLowerCase();
      // FXL pages: the spine item is itself an image, or an SVG wrapping a single
      // raster image → one CCD image block per page (no on-device rendering needed).
      // Check SVG first — its media type is `image/svg+xml`, which also matches the
      // generic image test below, but we must unwrap it to its inner raster image.
      if (mt.includes("svg")) {
        // Raster-wrapping SVG → its inner image; pure-vector SVG → the SVG handle
        // itself (the pack builder rasterizes SVG resources to PNG so the client
        // needs no SVG renderer; the web serves the SVG directly to the browser).
        const inner = await svgPageImage(epub, spine[i].href).catch(() => null);
        pushImagePage(i, inner ?? spine[i].href);
        continue;
      }
      if (mt.startsWith("image/")) {
        pushImagePage(i, spine[i].href);
        continue;
      }
      if (!mt.includes("xhtml") && !mt.includes("html")) continue;
      let html: string;
      try {
        html = (await epub.loadChapter(spine[i].id)).html;
      } catch {
        continue;
      }
      if (!html) continue;
      const { blocks, notes } = convertChapter(html, i);
      if (!blocks.length) continue;
      const len = Math.max(1, blockChars(blocks));
      const title = spine[i].id;
      chapters.push({
        id: spine[i].id,
        href: spine[i].href,
        spineIndex: i,
        blocks,
        notes: Object.keys(notes).length ? notes : undefined,
        virtualStart: virtual,
        virtualLength: len,
      });
      readingOrder.push({
        id: spine[i].id,
        title,
        spineIndex: i,
        virtualStart: virtual,
        virtualLength: len,
      });
      virtual += len;
    }

    const toc: TocEntry[] = mapToc(epub.getToc(), hrefToSpine);
    epub.destroy();
    return {
      ccdVersion: CCD_VERSION,
      bookId,
      sourceFormat,
      readingOrder,
      toc,
      totalVirtual: virtual,
      ...(isFixedLayout ? { isFixedLayout } : {}),
      ...(writingMode ? { writingMode } : {}),
      chapters,
    };
  } finally {
    rmSync(resDir, { recursive: true, force: true });
  }
}

type EpubToc = { label: string; href: string; children?: EpubToc[] };
function mapToc(items: EpubToc[], hrefToSpine: Map<string, number>, level = 0): TocEntry[] {
  const out: TocEntry[] = [];
  for (const it of items) {
    const spineIndex = hrefToSpine.get((it.href || "").split("#")[0]);
    if (spineIndex === undefined) continue;
    out.push({
      title: it.label,
      spineIndex,
      level,
      ...(it.children?.length ? { children: mapToc(it.children, hrefToSpine, level + 1) } : {}),
    });
  }
  return out;
}

/** Build a CCD bundle from a PDF (one chapter; TOC derived from headings). */
export async function buildBundleFromPdf(
  pdfInput: string | Uint8Array,
  bookId: string,
): Promise<ContentBundle> {
  const { blocks } = await convertPdf(
    typeof pdfInput === "string" ? new Uint8Array(readFileSync(pdfInput)) : pdfInput,
  );
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
  return {
    ccdVersion: CCD_VERSION,
    bookId,
    sourceFormat: "pdf",
    readingOrder: [{ id: "pdf", spineIndex: 0, virtualStart: 0, virtualLength: len }],
    toc,
    totalVirtual: len,
    chapters: [chapter],
  };
}
