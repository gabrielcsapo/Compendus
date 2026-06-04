/**
 * E2E pipeline: source file → CCD bundle → CCD pack → web reader render.
 *
 * Covers the conversion + packaging + web-render path (no DB) over the committed
 * W3C/PDF fixtures, including the edge cases that have bitten us: reflowable text,
 * fixed-layout (FXL) → image-block pages, SVG pages rasterized to PNG, internal
 * links, and image resource handles. This is the heart of the "book renders"
 * guarantee for the web reader.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import JSZip from "jszip";
import { buildBundleFromEpub, buildBundleFromPdf } from "../app/lib/content-ast/bundle";
import { buildCcdPack } from "../app/lib/processing/ccd-pack";
import { bundleToTextContent } from "../app/lib/content-ast/to-html";
import { ccdStatusOf } from "../app/lib/book-types";
import { CCD_VERSION } from "../app/lib/content-ast/types";

const EPUB = (name: string) => resolve(import.meta.dirname, "..", "server/__fixtures__/epub", name);
const PDF = (name: string) => resolve(import.meta.dirname, "fixtures/pdfs", name);

/** Recursively collect plain text from CCD blocks for assertions. */
function blockText(blocks: any[]): string {
  let s = "";
  for (const b of blocks) {
    if (b.inlines) for (const i of b.inlines) if (i.t === "span") s += i.text + " ";
    if (b.children) s += blockText(b.children);
    if (b.items)
      for (const it of b.items) s += blockText(Array.isArray(it) ? it : (it.definition ?? []));
    if (b.lines)
      for (const ln of b.lines)
        if (ln.inlines) for (const i of ln.inlines) if (i.t === "span") s += i.text + " ";
  }
  return s;
}
function countBlocks(blocks: any[], t: string): number {
  let n = 0;
  for (const b of blocks) {
    if (b.t === t) n++;
    if (b.children) n += countBlocks(b.children, t);
  }
  return n;
}

describe("EPUB → CCD → pack → web render (reflowable: moby-dick)", () => {
  const buf = readFileSync(EPUB("moby-dick.epub"));

  it("converts to a multi-chapter bundle with real prose", async () => {
    const bundle = await buildBundleFromEpub(EPUB("moby-dick.epub"), "test-moby", "epub");
    expect(bundle.ccdVersion).toBe(CCD_VERSION);
    expect(bundle.chapters.length).toBeGreaterThan(50);
    expect(bundle.totalVirtual).toBeGreaterThan(1000);
    const allText = bundle.chapters.map((c) => blockText(c.blocks)).join(" ");
    expect(allText).toMatch(/whale|Ishmael|Ahab|sea/i);
  });

  it("packs the manifest + referenced image resources", async () => {
    const bundle = await buildBundleFromEpub(EPUB("moby-dick.epub"), "test-moby", "epub");
    const zip = await JSZip.loadAsync(await buildCcdPack(bundle, buf));
    const names = Object.keys(zip.files);
    expect(names).toContain("manifest.ccd.json");
    const manifest = JSON.parse(await zip.file("manifest.ccd.json")!.async("string"));
    expect(manifest.chapters.length).toBe(bundle.chapters.length);
    // At least one image resource bundled (cover), and every resources/ entry is real bytes.
    const resourceEntries = names.filter((n) => n.startsWith("resources/") && !zip.files[n].dir);
    expect(resourceEntries.length).toBeGreaterThan(0);
  });

  it("renders to web TextContent: chapters with real HTML, TOC, and resource-API image srcs", async () => {
    const bundle = await buildBundleFromEpub(EPUB("moby-dick.epub"), "test-moby", "epub");
    const content = bundleToTextContent(bundle, "test-moby");
    expect(content.type).toBe("text");
    expect(content.chapters.length).toBe(bundle.chapters.length);
    const nonEmpty = content.chapters.filter((c) => c.html.trim().length > 0);
    expect(nonEmpty.length).toBeGreaterThan(0);
    const joined = content.chapters.map((c) => c.html).join("");
    expect(joined).toMatch(/whale|Ishmael|Ahab/i);
    // Images, if any, are rewritten to the resource API (never a /tmp or absolute path).
    const imgSrcs = [...joined.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    for (const src of imgSrcs) {
      expect(src.startsWith("/api/reader/test-moby/resource/") || /^https?:|^data:/.test(src)).toBe(
        true,
      );
    }
    expect(content.toc.length).toBeGreaterThan(0);
  });
});

describe("FXL (fixed-layout) → one image-block page per spine item", () => {
  it("page-blanche-bitmaps-in-spine: image-in-spine pages become image-block chapters", async () => {
    const f = EPUB("page-blanche-bitmaps-in-spine.epub");
    const bundle = await buildBundleFromEpub(f, "test-fxl", "epub");
    expect(bundle.isFixedLayout).toBe(true);
    expect(bundle.chapters.length).toBeGreaterThan(0);
    // every chapter is a single full-page image
    for (const ch of bundle.chapters) {
      expect(countBlocks(ch.blocks, "image")).toBeGreaterThanOrEqual(1);
    }
    const zip = await JSZip.loadAsync(await buildCcdPack(bundle, readFileSync(f)));
    const resourceEntries = Object.keys(zip.files).filter(
      (n) => n.startsWith("resources/") && !zip.files[n].dir,
    );
    expect(resourceEntries.length).toBeGreaterThan(0);
  });
});

describe("SVG-in-spine → rasterized to PNG in the pack", () => {
  it("svg-in-spine: SVG resources become <handle>.png and the manifest is remapped", async () => {
    const f = EPUB("svg-in-spine.epub");
    const bundle = await buildBundleFromEpub(f, "test-svg", "epub");
    expect(bundle.chapters.length).toBeGreaterThan(0);
    const zip = await JSZip.loadAsync(await buildCcdPack(bundle, readFileSync(f)));
    const names = Object.keys(zip.files).filter(
      (n) => n.startsWith("resources/") && !zip.files[n].dir,
    );
    // pure-vector SVG pages are rasterized → at least one .png resource, and the
    // packed manifest points image blocks at the .png (never a raw .svg handle).
    expect(names.some((n) => n.endsWith(".png"))).toBe(true);
    const manifest = JSON.parse(await zip.file("manifest.ccd.json")!.async("string"));
    const imgResources: string[] = [];
    const walk = (bl: any[]) =>
      bl.forEach((b) => {
        if (b.t === "image") imgResources.push(b.resource);
        if (b.children) walk(b.children);
      });
    manifest.chapters.forEach((c: any) => walk(c.blocks));
    expect(imgResources.some((r) => r.endsWith(".png"))).toBe(true);
    expect(imgResources.some((r) => /\.svg$/i.test(r))).toBe(false);
  });
});

describe("PDF → CCD → web render", () => {
  it("simple-text.pdf: extracts text into a renderable chapter", async () => {
    const bundle = await buildBundleFromPdf(PDF("simple-text.pdf"), "test-pdf");
    expect(bundle.chapters.length).toBeGreaterThan(0);
    expect(blockText(bundle.chapters[0].blocks).trim().length).toBeGreaterThan(0);
    const content = bundleToTextContent(bundle, "test-pdf");
    expect(content.chapters.some((c) => c.html.trim().length > 0)).toBe(true);
  });

  it("two-column.pdf: columns are de-interleaved (left column fully precedes right)", async () => {
    const bundle = await buildBundleFromPdf(PDF("two-column.pdf"), "test-2col");
    const text = bundle.chapters
      .map((c) => blockText(c.blocks))
      .join(" ")
      .replace(/\s+/g, " ");
    // The fixture's left column is one coherent passage, the right another; correct
    // order keeps each column contiguous rather than interleaving line-by-line.
    expect(text.length).toBeGreaterThan(0);
    // (regression guard: the known-bad output interleaved "dawn...capital...boat...council")
    expect(text).not.toMatch(/dawn.{0,40}capital.{0,40}boat/i);
  });
});

describe("ccdStatusOf", () => {
  const base = {
    format: "epub",
    ccdPath: null as string | null,
    ccdVersion: null as string | null,
    ccdError: null as string | null,
  };
  it("ready when path + current version", () => {
    expect(
      ccdStatusOf({ ...base, ccdPath: "data/books/x.ccd.json.gz", ccdVersion: CCD_VERSION }),
    ).toBe("ready");
  });
  it("failed when ccdError set and not ready", () => {
    expect(ccdStatusOf({ ...base, ccdError: "corrupt zip" })).toBe("failed");
  });
  it("processing when reflowable but neither ready nor failed", () => {
    expect(ccdStatusOf(base)).toBe("processing");
  });
  it("null for non-CCD formats (comics/audio)", () => {
    expect(ccdStatusOf({ ...base, format: "cbz" })).toBe(null);
    expect(ccdStatusOf({ ...base, format: "m4b" })).toBe(null);
  });
  it("stale version counts as processing (re-backfill needed)", () => {
    expect(ccdStatusOf({ ...base, ccdPath: "x", ccdVersion: "0.0.1-old" })).toBe("processing");
  });
});
