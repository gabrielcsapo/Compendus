/**
 * PDF → CCD emitter (spike / design-validation grade).
 *
 * The SECOND (and riskier) converter into CCD. PDF has no logical structure —
 * reading order, headings, and paragraphs are recovered from text-item geometry
 * (position + font size), mirroring app/lib/processing/pdf-to-epub.ts. The CCD
 * is used for inference/search (and optional reflow); the original PDF still
 * renders page-faithfully via PDFKit/pdf.js.
 *
 * Reading order: items → lines (by y) → COLUMN DETECTION (interior whitespace
 * gutters split lines into columns, ordered left→right, each top→bottom) →
 * paragraphs (per column, so a column boundary forces a break). Without column
 * detection, multi-column PDFs interleave columns row-by-row — silent, 0%-loss
 * corruption that poisons inference (see tests/fixtures/pdfs/two-column.pdf).
 */
import "../reader/parsers/pdf-polyfill.js";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Block } from "./types.js";

interface PItem {
  text: string;
  x: number;
  y: number;
  w: number;
  size: number;
  bold: boolean;
  italic: boolean;
}
interface Line {
  text: string;
  size: number;
  y: number;
  minX: number;
  maxX: number;
  bold: boolean;
}

export interface PdfDiagnostics {
  pages: number;
  rawChars: number;
  emittedChars: number;
  blockCounts: Record<string, number>;
  headings: number;
  multiColumnPages: number;
  /** Header/footer/page-number lines stripped as boilerplate. */
  strippedLines: number;
  /** Hyphenated line-breaks rejoined. */
  dehyphenated: number;
}
export interface PdfCCD {
  blocks: Block[];
  diagnostics: PdfDiagnostics;
}

/** Signature for running-header detection: letters only (page numbers removed). */
const sigOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[0-9]+/g, "")
    .replace(/[^a-z]+/g, "");
/** A bare page number or roman numeral (running folio). */
const isPageNumLike = (s: string) =>
  s.length <= 12 && /[0-9ivxlcm]/i.test(s) && /^[\divxlcm.\-–—\s]+$/i.test(s);
const lineText = (ln: PItem[]) =>
  ln
    .slice()
    .sort((a, b) => a.x - b.x)
    .map((i) => i.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();

/** Group items into full-width lines by y (for header/footer candidates). */
function groupLinesByY(items: PItem[]): PItem[][] {
  const its = items.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: PItem[][] = [];
  for (const it of its) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(it.y - last[0].y) < last[0].size * 0.6) last.push(it);
    else lines.push([it]);
  }
  return lines;
}

/**
 * Split a page's raw text ITEMS into columns by detecting interior vertical
 * gutters — x-bands covered by almost no items. Must run on items, NOT lines:
 * grouping into lines by y first would merge same-row left/right text into one
 * full-width line and hide the gutter. Returns columns left→right; a single
 * column when no real gutter exists. Robust to a full-width title (one item
 * crossing the gutter barely moves coverage).
 */
function detectColumns(items: PItem[], pageWidth: number): PItem[][] {
  if (items.length < 6) return [items];
  const bin = 3;
  const nbins = Math.max(1, Math.ceil(pageWidth / bin));
  const cov = Array.from<number>({ length: nbins }).fill(0);
  for (const it of items) {
    const a = Math.max(0, Math.floor(it.x / bin));
    const b = Math.min(nbins - 1, Math.floor((it.x + it.w) / bin));
    for (let i = a; i <= b; i++) cov[i]++;
  }
  const total = items.length;
  const gutterMinBins = Math.ceil(15 / bin); // ≥15pt empty band
  const marginBins = Math.floor((pageWidth * 0.12) / bin); // ignore outer 12% margins
  const splits: number[] = [];
  let runStart = -1;
  for (let i = 0; i <= nbins; i++) {
    const empty = i < nbins && cov[i] / total < 0.03;
    if (empty && runStart < 0) runStart = i;
    if ((!empty || i === nbins) && runStart >= 0) {
      const runEnd = i - 1,
        w = runEnd - runStart + 1;
      if (w >= gutterMinBins && runStart > marginBins && runEnd < nbins - marginBins) {
        splits.push(((runStart + runEnd + 1) / 2) * bin);
      }
      runStart = -1;
    }
  }
  if (!splits.length) return [items];

  const bounds = [0, ...splits.sort((a, b) => a - b), pageWidth];
  const bands: PItem[][] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const lo = bounds[i],
      hi = bounds[i + 1];
    const band = items.filter((it) => {
      const c = it.x + it.w / 2;
      return c >= lo && c < hi;
    });
    if (band.length) bands.push(band);
  }
  // Require ≥2 substantial bands, else it wasn't really columnar.
  if (bands.filter((b) => b.length >= 3).length < 2) return [items];
  return bands;
}

export async function convertPdf(buf: Uint8Array): Promise<PdfCCD> {
  const data = new Uint8Array(buf.byteLength);
  data.set(buf);
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true, disableFontFace: true })
    .promise;

  const pages: { items: PItem[]; width: number }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items: PItem[] = [];
    for (const it of tc.items as {
      str?: string;
      transform?: number[];
      width?: number;
      fontName?: string;
    }[]) {
      if (typeof it.str === "string" && it.str.trim() && it.transform) {
        const tx = it.transform;
        const size = Math.abs(tx[0]) || 12;
        items.push({
          text: it.str,
          x: tx[4],
          y: vp.height - tx[5],
          w: it.width || it.str.length * size * 0.5,
          size,
          bold: /bold/i.test(it.fontName || ""),
          italic: /italic|oblique/i.test(it.fontName || ""),
        });
      }
    }
    pages.push({ items, width: vp.width });
  }
  await doc.destroy();

  const sizes = pages
    .flatMap((p) => p.items)
    .map((i) => i.size)
    .sort((a, b) => a - b);
  const body = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 12;
  const hThresh = body * 1.4;

  const diag: PdfDiagnostics = {
    pages: pages.length,
    rawChars: 0,
    emittedChars: 0,
    blockCounts: {},
    headings: 0,
    multiColumnPages: 0,
    strippedLines: 0,
    dehyphenated: 0,
  };
  const bump = (k: string) => {
    diag.blockCounts[k] = (diag.blockCounts[k] || 0) + 1;
  };
  const blocks: Block[] = [];
  let counter = 0;
  const nextId = () => `pdf:${counter++}`;

  // Pass 1: find running headers/footers — top/bottom full-width line signatures
  // that repeat across pages (or are bare page numbers).
  const headerSig: Record<string, number> = {},
    footerSig: Record<string, number> = {};
  const topBottom = pages.map((p) => {
    if (!p.items.length) return { top: null as PItem[] | null, bottom: null as PItem[] | null };
    const ls = groupLinesByY(p.items);
    const top = ls[0],
      bottom = ls[ls.length - 1];
    const ts = sigOf(lineText(top));
    if (ts) headerSig[ts] = (headerSig[ts] || 0) + 1;
    const bs = sigOf(lineText(bottom));
    if (bs) footerSig[bs] = (footerSig[bs] || 0) + 1;
    return { top, bottom };
  });
  const repThresh = Math.max(3, Math.floor(pages.length * 0.3));
  const isRun = (ln: PItem[] | null, freq: Record<string, number>) => {
    if (!ln) return false;
    const t = lineText(ln);
    return isPageNumLike(t) || (freq[sigOf(t)] || 0) >= repThresh;
  };

  for (let pi = 0; pi < pages.length; pi++) {
    const { width } = pages[pi];
    bump("pageBreak");
    blocks.push({ t: "pageBreak", id: nextId(), label: String(pi + 1) });
    if (!pages[pi].items.length) continue;

    // Strip running header/footer/page-number lines before anything else.
    const strip = new Set<PItem>();
    const tb = topBottom[pi];
    if (isRun(tb.top, headerSig)) {
      tb.top!.forEach((i) => strip.add(i));
      diag.strippedLines++;
    }
    if (isRun(tb.bottom, footerSig) && tb.bottom !== tb.top) {
      tb.bottom!.forEach((i) => strip.add(i));
      diag.strippedLines++;
    }
    const items = strip.size ? pages[pi].items.filter((i) => !strip.has(i)) : pages[pi].items;
    diag.rawChars += items.reduce((a, it) => a + it.text.replace(/\s/g, "").length, 0);
    if (!items.length) continue;

    // Detect columns from RAW ITEMS first (before any y-grouping).
    const columns = detectColumns(items, width);
    if (columns.length > 1) diag.multiColumnPages++;

    // Within each column (left→right): items → lines (by y) → paragraphs.
    for (const colItems of columns) {
      colItems.sort((a, b) => a.y - b.y || a.x - b.x);
      const rawLines: PItem[][] = [];
      for (const it of colItems) {
        const last = rawLines[rawLines.length - 1];
        if (last && Math.abs(it.y - last[0].y) < last[0].size * 0.5) last.push(it);
        else rawLines.push([it]);
      }
      const colLines: Line[] = rawLines
        .map((ln) => {
          ln.sort((a, b) => a.x - b.x);
          return {
            text: ln
              .map((i) => i.text)
              .join("")
              .replace(/\s+/g, " ")
              .trim(),
            size: Math.max(...ln.map((i) => i.size)),
            y: ln[0].y,
            minX: Math.min(...ln.map((i) => i.x)),
            maxX: Math.max(...ln.map((i) => i.x + i.w)),
            bold: ln.every((i) => i.bold),
          };
        })
        .filter((l) => l.text);

      let para: Line[] = [];
      const flushPara = () => {
        if (!para.length) return;
        // Join lines, rejoining words split by a hyphen at a line break.
        let text = "";
        for (const l of para) {
          if (!text) {
            text = l.text;
            continue;
          }
          if (/[-­‐]$/.test(text) && /^[a-z]/.test(l.text)) {
            text = text.replace(/[-­‐]$/, "") + l.text;
            diag.dehyphenated++;
          } else text += " " + l.text;
        }
        text = text.replace(/\s+/g, " ").trim();
        const size = Math.max(...para.map((l) => l.size));
        const allBold = para.every((l) => l.bold);
        diag.emittedChars += text.replace(/\s/g, "").length;
        if (size >= hThresh && text.length > 1 && text.length < 120 && !/^\d+$/.test(text)) {
          const level = (size >= body * 2 ? 1 : size >= body * 1.7 ? 2 : 3) as 1 | 2 | 3;
          blocks.push({ t: "heading", id: nextId(), level, inlines: [{ t: "span", text }] });
          bump("heading");
          diag.headings++;
        } else {
          blocks.push({
            t: "paragraph",
            id: nextId(),
            inlines: [{ t: "span", text, marks: allBold ? ["strong"] : undefined }],
          });
          bump("paragraph");
        }
        para = [];
      };
      for (let i = 0; i < colLines.length; i++) {
        const ln = colLines[i],
          prev = colLines[i - 1];
        if (prev && (ln.y - prev.y > prev.size * 1.6 || Math.abs(ln.size - prev.size) > 2))
          flushPara();
        para.push(ln);
      }
      flushPara();
    }
  }

  return { blocks, diagnostics: diag };
}
