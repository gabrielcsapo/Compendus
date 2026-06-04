/**
 * CCD resource pack: a single self-contained archive a client downloads to read
 * a reflowable book fully offline with NO source file (no `.epub`) on device.
 *
 * Layout of the zip:
 *   manifest.ccd.json          — the full ContentBundle JSON (text/structure/TOC)
 *   resources/<handle>         — every image/embed resource the bundle references,
 *                                keyed by its in-EPUB handle (e.g. EPUB/images/x.jpg)
 *
 * The client unzips it and resolves a CCD `resource` handle by appending it to the
 * unpacked `resources/` dir — the same handle the web reader passes to the resource
 * API. Resources are extracted from the EPUB ONCE here (server side), so the client
 * never parses a container format.
 */
import type { ContentBundle, Block } from "../content-ast/types.js";
import { extractEpubResource } from "./epub.js";
import { yieldToEventLoop } from "./utils.js";

const isSvgHandle = (handle: string, mimeType?: string) =>
  /\.svg$/i.test(handle) || (mimeType || "").includes("svg");

/** Rewrite an image/embed resource handle everywhere it appears in the bundle
 *  (used to point SVG pages at their rasterized PNG inside the pack). */
function remapResources(bundle: ContentBundle, remap: Map<string, string>): ContentBundle {
  if (remap.size === 0) return bundle;
  const fix = (blocks: Block[]): void => {
    for (const b of blocks) {
      if ((b.t === "image" || b.t === "embed") && b.resource && remap.has(b.resource)) {
        (b as { resource: string }).resource = remap.get(b.resource)!;
      }
      if (b.t === "image" && b.caption) fix(b.caption);
      else if (b.t === "blockquote" || b.t === "container") fix(b.children);
      else if (b.t === "list") for (const it of b.items) fix(it);
      else if (b.t === "definitionList") for (const it of b.items) fix(it.definition);
      else if (b.t === "table") {
        for (const r of b.rows) for (const c of r.cells) fix(c.blocks);
        if (b.caption) fix(b.caption);
      }
    }
  };
  const clone: ContentBundle = JSON.parse(JSON.stringify(bundle));
  for (const ch of clone.chapters) fix(ch.blocks);
  return clone;
}

/** Collect every unique image/embed resource handle referenced anywhere in the bundle. */
export function collectResourceHandles(bundle: ContentBundle): string[] {
  const handles = new Set<string>();
  const visitBlocks = (blocks: Block[]) => {
    for (const b of blocks) {
      switch (b.t) {
        case "image":
        case "embed":
          if (b.resource) handles.add(b.resource);
          if (b.t === "image" && b.caption) visitBlocks(b.caption);
          break;
        case "blockquote":
        case "container":
          visitBlocks(b.children);
          break;
        case "list":
          for (const item of b.items) visitBlocks(item);
          break;
        case "definitionList":
          for (const item of b.items) visitBlocks(item.definition);
          break;
        case "table":
          for (const row of b.rows) for (const cell of row.cells) visitBlocks(cell.blocks);
          if (b.caption) visitBlocks(b.caption);
          break;
        default:
          break;
      }
    }
  };
  for (const ch of bundle.chapters) visitBlocks(ch.blocks);
  return [...handles];
}

/**
 * Build the pack zip from a bundle + the source EPUB bytes. Images are already
 * compressed, so the zip uses STORE (no deflate) to keep this cheap on the host.
 * Yields to the event loop between resources so a many-image book can't starve it.
 */
export async function buildCcdPack(bundle: ContentBundle, epubBuffer: Buffer): Promise<Buffer> {
  const JSZip = (await import("jszip")).default;
  const sharp = (await import("sharp")).default;
  const out = new JSZip();

  // SVG handles are rasterized to PNG so the client never needs an SVG renderer.
  // We remap those handles to `<handle>.png` and rewrite the manifest accordingly.
  const remap = new Map<string, string>();
  const handles = collectResourceHandles(bundle);
  let i = 0;
  for (const handle of handles) {
    const res = await extractEpubResource(epubBuffer, handle).catch(() => null);
    if (res) {
      if (isSvgHandle(handle, res.mimeType)) {
        try {
          const png = await sharp(res.data, { density: 144 }).png().toBuffer();
          const pngHandle = `${handle}.png`;
          out.file(`resources/${pngHandle}`, png);
          remap.set(handle, pngHandle);
        } catch {
          out.file(`resources/${handle}`, res.data); // rasterization failed — ship the SVG as-is
        }
      } else {
        out.file(`resources/${handle}`, res.data);
      }
    }
    if (++i % 16 === 0) await yieldToEventLoop();
  }

  out.file("manifest.ccd.json", JSON.stringify(remapResources(bundle, remap)));
  return out.generateAsync({ type: "nodebuffer", compression: "STORE" });
}
