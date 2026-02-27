import { initMobiFile, initKf8File } from "../mobi-parser.js";
import type { MobiParser } from "../mobi-parser.js";
import JSZip from "jszip";
import { mkdirSync, readdirSync, readFileSync, rmSync, existsSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

interface ConvertOptions {
  onProgress?: (percent: number, message: string) => void;
}

interface ChapterData {
  id: string;
  title: string;
  html: string;
}

interface ImageEntry {
  id: string;
  href: string;
  mimeType: string;
  data: Buffer;
}

interface TocEntry {
  label: string;
  href: string;
  children?: TocEntry[];
}

const MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

/**
 * Convert a MOBI/AZW/AZW3 buffer to an EPUB buffer.
 * Uses the custom MOBI parser to extract HTML chapters, TOC, cover, and images,
 * then assembles a valid EPUB 3 package with JSZip.
 */
export async function convertMobiToEpub(
  mobiBuffer: Buffer,
  metadata: { title?: string; authors?: string[]; language?: string },
  options?: ConvertOptions,
): Promise<Buffer> {
  const progress = options?.onProgress ?? (() => {});
  const resourceSaveDir = resolve(tmpdir(), `mobi-convert-${randomUUID()}`);

  try {
    progress(2, "Parsing MOBI file...");

    mkdirSync(resourceSaveDir, { recursive: true });

    // Initialize both MOBI and KF8 parsers — pick the one with more content
    const uint8 = new Uint8Array(mobiBuffer);
    const parser = await initBestParser(uint8, resourceSaveDir);

    progress(8, "Extracting chapters...");

    const spine = parser.getSpine();
    const toc = parser.getToc();
    const parserMetadata = parser.getMetadata();

    // Use parser metadata as fallback for missing fields
    const title = metadata.title || parserMetadata.title || "Untitled";
    const authors = metadata.authors?.length ? metadata.authors : parserMetadata.author?.length ? parserMetadata.author : ["Unknown"];
    const language = metadata.language || parserMetadata.language || "en";

    // Extract chapters
    const chapters: ChapterData[] = [];
    for (let i = 0; i < spine.length; i++) {
      const spineItem = spine[i];
      const pct = 10 + Math.round((i / spine.length) * 55);
      progress(pct, `Extracting chapter ${i + 1}/${spine.length}...`);

      try {
        const chapter = parser.loadChapter(spineItem.id);
        if (!chapter?.html) continue;

        // Find matching TOC entry for chapter title
        const tocEntry = toc.find((t) => t.href.includes(spineItem.id));
        const chapterTitle = tocEntry?.label || `Chapter ${i + 1}`;

        chapters.push({
          id: `chapter-${i + 1}`,
          title: chapterTitle,
          html: sanitizeChapterHtml(chapter.html),
        });
      } catch {
        // Skip chapters that fail to load
      }
    }

    if (chapters.length === 0) {
      throw new Error("No chapters could be extracted from the MOBI file");
    }

    progress(67, "Collecting images...");

    // Collect images from resourceSaveDir
    const images = collectImages(resourceSaveDir);

    // Get cover image
    let coverImageId: string | null = null;
    try {
      const coverPath = parser.getCoverImage();
      if (coverPath) {
        const coverEntry = images.find(
          (img) => img.href === `images/${coverPath}` || coverPath.includes(img.id),
        );
        if (coverEntry) {
          coverImageId = coverEntry.id;
        }
      }
    } catch {
      // Cover extraction may fail — non-fatal
    }

    progress(72, "Assembling EPUB...");

    // Assemble EPUB
    const epubBuffer = await assembleEpub(
      chapters,
      images,
      toc,
      { title, authors, language },
      coverImageId,
      progress,
    );

    // Cleanup parser
    parser.destroy();

    progress(100, "Conversion complete");

    return epubBuffer;
  } finally {
    // Clean up temp directory
    if (existsSync(resourceSaveDir)) {
      rmSync(resourceSaveDir, { recursive: true, force: true });
    }
  }
}

/**
 * Initialize both MOBI and KF8 parsers and pick the one with more content.
 * AZW3 files are KF8 format; many MOBIs are dual-format.
 */
async function initBestParser(
  data: Uint8Array,
  resourceSaveDir: string,
): Promise<MobiParser> {
  let mobiParser: MobiParser | null = null;
  let kf8Parser: MobiParser | null = null;

  try {
    mobiParser = await initMobiFile(data, resourceSaveDir);
  } catch {
    // MOBI parsing failed
  }

  try {
    kf8Parser = await initKf8File(data, resourceSaveDir);
  } catch {
    // KF8 parsing failed
  }

  if (!mobiParser && !kf8Parser) {
    throw new Error("Failed to parse file as either MOBI or KF8 format");
  }

  if (!kf8Parser) return mobiParser!;
  if (!mobiParser) return kf8Parser;

  // Compare spine lengths — prefer KF8 if it has more or equal content
  const mobiSpine = mobiParser.getSpine();
  const kf8Spine = kf8Parser.getSpine();

  if (kf8Spine.length >= mobiSpine.length) {
    mobiParser.destroy();
    return kf8Parser;
  } else {
    kf8Parser.destroy();
    return mobiParser;
  }
}

/**
 * Collect extracted images from the resource save directory
 */
function collectImages(resourceSaveDir: string): ImageEntry[] {
  const images: ImageEntry[] = [];

  if (!existsSync(resourceSaveDir)) return images;

  try {
    const files = readdirSync(resourceSaveDir);
    for (const file of files) {
      const ext = file.split(".").pop()?.toLowerCase() || "";
      const mimeType = MIME_TYPES[ext];
      if (!mimeType) continue;

      try {
        const data = readFileSync(resolve(resourceSaveDir, file));
        const id = file.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
        images.push({
          id: `img-${id}`,
          href: `images/${file}`,
          mimeType,
          data,
        });
      } catch {
        // Skip files that can't be read
      }
    }
  } catch {
    // Directory listing failed
  }

  return images;
}

/**
 * Sanitize MOBI chapter HTML for inclusion in EPUB XHTML files.
 */
function sanitizeChapterHtml(html: string): string {
  let sanitized = html;

  // Remove XML declarations and DOCTYPE
  sanitized = sanitized.replace(/<\?xml[^>]*\?>/gi, "");
  sanitized = sanitized.replace(/<!DOCTYPE[^>]*>/gi, "");

  // Remove script and style tags
  sanitized = sanitized.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  sanitized = sanitized.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  // Remove event handlers (onclick, onload, etc.)
  sanitized = sanitized.replace(/\s+on\w+="[^"]*"/gi, "");
  sanitized = sanitized.replace(/\s+on\w+='[^']*'/gi, "");

  // Strip html, head, body wrappers (the EPUB XHTML template provides these)
  sanitized = sanitized.replace(/<\/?html[^>]*>/gi, "");
  sanitized = sanitized.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "");
  sanitized = sanitized.replace(/<\/?body[^>]*>/gi, "");

  // Rewrite image src to use relative EPUB paths
  sanitized = sanitized.replace(
    /(<img[^>]*\s+src=["'])([^"']*\/)?([^"'/]+)(["'])/gi,
    "$1images/$3$4",
  );

  // Ensure XHTML self-closing tags
  sanitized = sanitized.replace(/<br\s*>/gi, "<br/>");
  sanitized = sanitized.replace(/<hr\s*>/gi, "<hr/>");
  sanitized = sanitized.replace(
    /<img([^>]*[^/])>/gi,
    "<img$1/>",
  );

  // Fix bare ampersands (but not already-escaped entities)
  sanitized = sanitized.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/g, "&amp;");

  return sanitized.trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build flat TOC entries from potentially nested MOBI TOC
 */
function flattenToc(
  items: TocEntry[],
  chapterFiles: { id: string; href: string; title: string }[],
): { label: string; href: string }[] {
  const result: { label: string; href: string }[] = [];

  function walk(entries: TocEntry[]) {
    for (const entry of entries) {
      // Try to match TOC entry to a chapter file
      const matchedChapter = chapterFiles.find(
        (_ch, i) => entry.href.includes(`chapter-${i + 1}`) || entry.href.includes(chapterFiles[i]?.id),
      );
      result.push({
        label: entry.label,
        href: matchedChapter?.href || chapterFiles[0]?.href || "chapter-1.xhtml",
      });
      if (entry.children?.length) {
        walk(entry.children);
      }
    }
  }

  walk(items);
  return result;
}

/**
 * Assemble chapters, images, and metadata into a valid EPUB 3 file
 */
async function assembleEpub(
  chapters: ChapterData[],
  images: ImageEntry[],
  toc: TocEntry[],
  metadata: { title: string; authors: string[]; language: string },
  coverImageId: string | null,
  progress: (pct: number, msg: string) => void,
): Promise<Buffer> {
  const zip = new JSZip();
  const { title, authors, language } = metadata;
  const bookId = `mobi-epub-${Date.now()}`;

  // 1. mimetype (must be first, uncompressed)
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

  // 2. META-INF/container.xml
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );

  // 3. Generate chapter XHTML files
  const chapterFiles: { id: string; href: string; title: string }[] = [];

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    const chapterHref = `${chapter.id}.xhtml`;

    progress(
      72 + Math.round((i / chapters.length) * 20),
      `Writing chapter ${i + 1}/${chapters.length}...`,
    );

    const chapterXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${language}">
<head>
  <title>${escapeHtml(chapter.title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <section>
${chapter.html}
  </section>
</body>
</html>`;

    zip.file(`OEBPS/${chapterHref}`, chapterXhtml);
    chapterFiles.push({ id: chapter.id, href: chapterHref, title: chapter.title });
  }

  // 4. Add images to ZIP
  for (const img of images) {
    zip.file(`OEBPS/${img.href}`, img.data);
  }

  // 5. CSS stylesheet
  zip.file(
    "OEBPS/styles.css",
    `body {
  font-family: serif;
  line-height: 1.6;
  margin: 1em;
  color: #333;
}
h1, h2, h3 {
  line-height: 1.3;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}
p {
  margin: 0.5em 0;
  text-align: justify;
}
hr {
  border: none;
  border-top: 1px solid #ccc;
  margin: 2em 0;
}
img {
  max-width: 100%;
  height: auto;
}
`,
  );

  // 6. content.opf (package document)
  const manifestItems = [
    `    <item id="styles" href="styles.css" media-type="text/css"/>`,
    `    <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    ...chapterFiles.map(
      (ch) =>
        `    <item id="${ch.id}" href="${ch.href}" media-type="application/xhtml+xml"/>`,
    ),
    ...images.map((img) => {
      const props = img.id === coverImageId ? ` properties="cover-image"` : "";
      return `    <item id="${img.id}" href="${img.href}" media-type="${img.mimeType}"${props}/>`;
    }),
  ].join("\n");

  const spineItems = chapterFiles
    .map((ch) => `    <itemref idref="${ch.id}"/>`)
    .join("\n");

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${bookId}</dc:identifier>
    <dc:title>${escapeHtml(title)}</dc:title>
${authors.map((a) => `    <dc:creator>${escapeHtml(a)}</dc:creator>`).join("\n")}
    <dc:language>${language}</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}</meta>
  </metadata>
  <manifest>
${manifestItems}
  </manifest>
  <spine>
${spineItems}
  </spine>
</package>`,
  );

  // 7. Navigation document (EPUB 3 nav)
  // Use MOBI TOC if available, otherwise fall back to chapter titles
  let tocListItems: string;
  if (toc.length > 0) {
    const flatToc = flattenToc(toc, chapterFiles);
    tocListItems = flatToc
      .map((entry) => `      <li><a href="${entry.href}">${escapeHtml(entry.label)}</a></li>`)
      .join("\n");
  } else {
    tocListItems = chapterFiles
      .map(
        (ch) =>
          `      <li><a href="${ch.href}">${escapeHtml(ch.title)}</a></li>`,
      )
      .join("\n");
  }

  zip.file(
    "OEBPS/toc.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${language}">
<head>
  <title>Table of Contents</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Table of Contents</h1>
    <ol>
${tocListItems}
    </ol>
  </nav>
</body>
</html>`,
  );

  progress(95, "Compressing EPUB...");

  // Generate the ZIP buffer
  const epubBuffer = await zip.generateAsync({
    type: "nodebuffer",
    mimeType: "application/epub+zip",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return epubBuffer;
}
