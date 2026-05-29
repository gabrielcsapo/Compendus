/**
 * Dedicated book → clean text + images extractor for the knowledge pipeline.
 *
 * Why this exists: the reader derives chapter `text` by regex-stripping tags and
 * never decodes entities, so that text is full of `&#13;` etc. and drops images.
 * It's render-oriented, not NLP-grade. Here we parse each chapter's HTML with a
 * real parser (node-html-parser) for properly-decoded text, and copy referenced
 * image binaries into a permanent dir (deduped by content hash).
 *
 * The EPUB parser dumps resources into its `resourceSaveDir` and `loadChapter`
 * rewrites <img src> to those paths — but `destroy()` deletes them. So we read
 * each referenced image while the parser is alive (from a throwaway temp dir) and
 * copy it to the caller's `imagesDir`.
 *
 * DB-free by design (takes a file path, not a bookId) so it can be tested on
 * fixtures without the database.
 */
import { resolve, join } from "path";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { createHash } from "crypto";
import { parse, type HTMLElement } from "node-html-parser";
import { initEpubFile } from "../epub-parser";

export interface ExtractedImage {
  /** Relative path (under the book's figures dir) where the binary was copied. */
  storedPath: string;
  mimeType: string;
  alt: string | null;
  caption: string | null;
  /** Approximate global character offset (section start) for later passage linkage. */
  charStart: number;
}

export interface BookSection {
  title: string | null;
  spineIndex: number;
  text: string;
  images: ExtractedImage[];
}

export interface BookSource {
  sections: BookSection[];
  totalCharacters: number;
}

const IMAGE_EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
};

function extToMime(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXT_MIME[ext] ?? null;
}

/** Clean, entity-decoded, block-separated text for a chapter. */
function cleanText(root: HTMLElement): string {
  root.querySelectorAll("script, style").forEach((n) => n.remove());
  // structuredText decodes entities and separates block elements with newlines.
  const raw = root.structuredText;

  // Defensive control-byte strip (keep tab/newline) — guards against malformed
  // or binary spine content slipping through.
  let stripped = "";
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code === 9 || code === 10 || code >= 32) stripped += raw[i];
  }

  return stripped
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** A spine item is text content we can extract (vs. an image/audio/video item). */
function isTextItem(mediaType: string): boolean {
  return /html/i.test(mediaType); // application/xhtml+xml, text/html
}

/** Find an enclosing <figure>'s <figcaption> text, if any. */
function findCaption(img: HTMLElement): string | null {
  let node: HTMLElement | null = img.parentNode as HTMLElement | null;
  for (let depth = 0; node && depth < 4; depth++) {
    if (node.rawTagName?.toLowerCase() === "figure") {
      const text = node.querySelector("figcaption")?.text.trim();
      return text ? text.slice(0, 500) : null;
    }
    node = node.parentNode as HTMLElement | null;
  }
  return null;
}

/**
 * Extract ordered sections of clean text + image references from an EPUB.
 * Image binaries are copied into `imagesDir` (created if needed), named by
 * content hash so repeated references store once. Returns each image's path
 * relative to `imagesDir`.
 */
export async function extractBookSource(
  epubPath: string,
  imagesDir: string,
): Promise<BookSource | { unsupported: string }> {
  const tmp = mkdtempSync(join(tmpdir(), "compendus-epub-"));
  let parser: Awaited<ReturnType<typeof initEpubFile>>;
  try {
    parser = await initEpubFile(epubPath, tmp);
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    return {
      unsupported: `Could not open EPUB: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }

  try {
    mkdirSync(imagesDir, { recursive: true });
    const spine = parser.getSpine();
    const sections: BookSection[] = [];
    let total = 0;

    for (let i = 0; i < spine.length; i++) {
      const item = spine[i];
      // Skip image/svg/audio spine items (fixed-layout books) — only real text.
      if (item.mediaType && !isTextItem(item.mediaType)) continue;
      let html: string;
      try {
        html = (await parser.loadChapter(item.id)).html;
      } catch {
        continue;
      }
      if (!html.trim()) continue;

      const root = parse(html);
      const heading = root.querySelector("h1, h2, h3");
      const title = heading?.text.trim().slice(0, 200) || null;
      const text = cleanText(root);
      if (text.length === 0) continue;

      const images: ExtractedImage[] = [];
      for (const img of root.querySelectorAll("img, image")) {
        const src =
          img.getAttribute("src") || img.getAttribute("xlink:href") || img.getAttribute("href");
        if (!src || src.startsWith("data:") || src.startsWith("http")) continue;
        const mimeType = extToMime(src);
        if (!mimeType) continue;

        // src is the parser's temp path (exists until destroy) — copy it out.
        const stored = copyImage(src, imagesDir);
        if (!stored) continue;
        images.push({
          storedPath: stored,
          mimeType,
          alt: img.getAttribute("alt")?.trim() || null,
          caption: findCaption(img),
          charStart: total,
        });
      }

      sections.push({ title, spineIndex: i, text, images });
      total += text.length;
    }

    return { sections, totalCharacters: total };
  } finally {
    parser.destroy();
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Copy an image from the parser's temp path into imagesDir, named by content
 *  hash. Returns the basename (caller knows imagesDir), or null on failure. */
function copyImage(tempPath: string, imagesDir: string): string | null {
  let data: Buffer;
  try {
    data = readFileSync(tempPath);
  } catch {
    return null;
  }
  if (data.length === 0) return null;
  const ext = tempPath.split(".").pop()?.toLowerCase() || "img";
  const name = `${createHash("sha256").update(data).digest("hex").slice(0, 16)}.${ext}`;
  const dest = resolve(imagesDir, name);
  if (!existsSync(dest)) writeFileSync(dest, data);
  return name;
}
