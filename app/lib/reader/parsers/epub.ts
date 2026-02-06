import { initEpubFile } from "@lingo-reader/epub-parser";
import { resolve } from "path";
import { mkdirSync, writeFileSync } from "fs";
import { yieldToEventLoop } from "../../processing/utils.js";
import type { TextContent, NormalizedChapter, TocEntry } from "../types.js";

/**
 * Validate that a buffer looks like a valid ZIP file
 */
function isValidZipBuffer(buffer: Buffer): boolean {
  if (buffer.length < 22) return false;
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) return false;

  const searchStart = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= searchStart; i--) {
    if (
      buffer[i] === 0x50 &&
      buffer[i + 1] === 0x4b &&
      buffer[i + 2] === 0x05 &&
      buffer[i + 3] === 0x06
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Strip HTML tags and normalize whitespace
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Sanitize HTML for safe rendering
 * Removes scripts, event handlers, and dangerous elements
 * Rewrites image src URLs to point to the EPUB resource API
 */
function sanitizeHtml(html: string, bookId: string): string {
  return (
    html
      // Remove script tags and their content
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      // Remove style tags and their content (we apply our own styles)
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      // Remove event handlers
      .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, "")
      .replace(/\s+on\w+\s*=\s*[^\s>]*/gi, "")
      // Remove javascript: URLs
      .replace(/href\s*=\s*["']javascript:[^"']*["']/gi, "")
      // Remove data: URLs in src (potential XSS)
      .replace(/src\s*=\s*["']data:[^"']*["']/gi, "")
      // Rewrite image src URLs to use the EPUB resource API
      .replace(
        /(<img[^>]*\s+src\s*=\s*["'])([^"']+)(["'][^>]*>)/gi,
        (match, before, src, after) => {
          // Skip absolute URLs and data URIs
          if (
            src.startsWith("http://") ||
            src.startsWith("https://") ||
            src.startsWith("data:")
          ) {
            return match;
          }
          // Handle absolute filesystem paths (from epub-parser extracting to disk)
          // These start with / and contain paths like /Users/.../images/{bookId}/filename.jpg
          if (src.startsWith("/") && src.includes("/images/")) {
            const filename = src.split("/").pop() || src;
            return `${before}/mobi-images/${bookId}/${filename}${after}`;
          }
          // For relative EPUB internal paths, use the resource API
          const encodedPath = encodeURIComponent(src);
          return `${before}/api/reader/${bookId}/resource/${encodedPath}${after}`;
        },
      )
      // Also rewrite SVG image xlink:href URLs (used by some EPUBs for cover images)
      .replace(
        /(<image[^>]*\s+xlink:href\s*=\s*["'])([^"']+)(["'][^>]*>)/gi,
        (match, before, href, after) => {
          // Skip absolute URLs and data URIs
          if (
            href.startsWith("http://") ||
            href.startsWith("https://") ||
            href.startsWith("data:")
          ) {
            return match;
          }
          // Handle absolute filesystem paths (from epub-parser extracting to disk)
          if (href.startsWith("/") && href.includes("/images/")) {
            const filename = href.split("/").pop() || href;
            return `${before}/mobi-images/${bookId}/${filename}${after}`;
          }
          // For relative EPUB internal paths, use the resource API
          const encodedPath = encodeURIComponent(href);
          return `${before}/api/reader/${bookId}/resource/${encodedPath}${after}`;
        },
      )
      // Keep the structure but ensure it's safe
      .trim()
  );
}

/**
 * Parse EPUB file into normalized content for the reader
 */
export async function parseEpub(
  buffer: Buffer,
  bookId: string,
): Promise<TextContent> {
  // Validate ZIP structure
  if (!isValidZipBuffer(buffer)) {
    return createEmptyContent(bookId);
  }

  // Create book-specific directory for extracted resources
  const resourceDir = resolve(process.cwd(), "images", bookId);
  mkdirSync(resourceDir, { recursive: true });

  let epub;
  try {
    epub = await initEpubFile(buffer, resourceDir);
  } catch {
    // Try fallback parser for EPUBs with malformed navigation
    const fallbackResult = await parseEpubFallback(buffer, bookId, resourceDir);
    if (fallbackResult) {
      return fallbackResult;
    }
    return createEmptyContent(bookId);
  }

  let spine;
  let toc;
  try {
    spine = epub.getSpine();
    toc = epub.getToc();
  } catch {
    return createEmptyContent(bookId);
  }

  const chapters: NormalizedChapter[] = [];
  let totalCharacters = 0;

  for (let i = 0; i < spine.length; i++) {
    const spineItem = spine[i];
    try {
      const chapterContent = await epub.loadChapter(spineItem.id);
      const html = sanitizeHtml(chapterContent.html || "", bookId);
      const text = stripHtml(chapterContent.html || "");

      // Find matching TOC entry for title
      const tocEntry = toc.find((t) => t.href.includes(spineItem.href));
      const title = tocEntry?.label || `Chapter ${i + 1}`;

      chapters.push({
        id: spineItem.id,
        title,
        html,
        text,
        characterStart: totalCharacters,
        characterEnd: totalCharacters + text.length,
      });

      totalCharacters += text.length;
    } catch {
      // Skip chapters that fail to load
    }

    // Yield to event loop every 5 chapters to prevent blocking
    if (i % 5 === 4) {
      await yieldToEventLoop();
    }
  }

  // Build TOC with normalized positions
  const normalizedToc = buildToc(toc, chapters, totalCharacters);

  return {
    bookId,
    format: "epub",
    type: "text",
    chapters,
    totalCharacters,
    toc: normalizedToc,
  };
}

/**
 * Build normalized TOC with positions
 */
function buildToc(
  rawToc: Array<{ label: string; href: string; children?: unknown[] }>,
  chapters: NormalizedChapter[],
  totalCharacters: number,
  level = 0,
): TocEntry[] {
  return rawToc.map((item) => {
    // Find the chapter that matches this TOC entry
    const chapter = chapters.find(
      (ch) => ch.id.includes(item.href) || item.href.includes(ch.id),
    );
    const position = chapter
      ? chapter.characterStart / Math.max(1, totalCharacters)
      : 0;

    const entry: TocEntry = {
      title: item.label,
      position,
      level,
    };

    if (
      item.children &&
      Array.isArray(item.children) &&
      item.children.length > 0
    ) {
      entry.children = buildToc(
        item.children as Array<{
          label: string;
          href: string;
          children?: unknown[];
        }>,
        chapters,
        totalCharacters,
        level + 1,
      );
    }

    return entry;
  });
}

/**
 * Fallback EPUB parser using JSZip for EPUBs with malformed navigation
 * This handles cases where the @lingo-reader/epub-parser fails due to invalid NCX
 */
async function parseEpubFallback(
  buffer: Buffer,
  bookId: string,
  resourceDir: string,
): Promise<TextContent | null> {
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);

    // Find container.xml to get the root file path
    const containerXml = await zip
      .file("META-INF/container.xml")
      ?.async("string");
    if (!containerXml) {
      return null;
    }

    // Extract root file path from container.xml
    const rootFileMatch = containerXml.match(/full-path="([^"]+)"/);
    if (!rootFileMatch) {
      return null;
    }
    const rootFilePath = rootFileMatch[1];
    const rootDir = rootFilePath.substring(
      0,
      rootFilePath.lastIndexOf("/") + 1,
    );

    // Read the OPF file
    const opfContent = await zip.file(rootFilePath)?.async("string");
    if (!opfContent) {
      return null;
    }

    // Parse manifest items - extract each <item> tag and then parse its attributes
    const manifestItems = new Map<
      string,
      { href: string; mediaType: string }
    >();
    const itemTagMatches = opfContent.matchAll(/<item\s+([^>]+)\/?>/gi);
    for (const tagMatch of itemTagMatches) {
      const attrs = tagMatch[1];
      // Extract id, href, and media-type attributes in any order
      const idMatch = attrs.match(/id\s*=\s*["']([^"']+)["']/i);
      const hrefMatch = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
      const mediaTypeMatch = attrs.match(/media-type\s*=\s*["']([^"']+)["']/i);

      if (idMatch && hrefMatch) {
        manifestItems.set(idMatch[1], {
          href: hrefMatch[1],
          mediaType: mediaTypeMatch
            ? mediaTypeMatch[1]
            : "application/xhtml+xml",
        });
      }
    }

    // Parse spine
    const spineMatches = opfContent.matchAll(
      /<itemref\s+[^>]*idref="([^"]+)"[^>]*\/?>/gi,
    );
    const spineItems: string[] = [];
    for (const match of spineMatches) {
      spineItems.push(match[1]);
    }

    if (spineItems.length === 0) {
      return null;
    }

    const chapters: NormalizedChapter[] = [];
    let totalCharacters = 0;

    // Extract images to resource directory
    let imageCount = 0;
    for (const [, item] of manifestItems) {
      if (item.mediaType.startsWith("image/")) {
        const imagePath = rootDir + item.href;
        const imageFile = zip.file(imagePath) || zip.file(item.href);
        if (imageFile) {
          try {
            const imageData = await imageFile.async("nodebuffer");
            const filename = item.href.split("/").pop() || item.href;
            writeFileSync(resolve(resourceDir, filename), imageData);
            imageCount++;
            // Yield every 10 images to prevent blocking
            if (imageCount % 10 === 0) {
              await yieldToEventLoop();
            }
          } catch {
            // Skip failed image extractions
          }
        }
      }
    }

    // Process spine items
    for (let i = 0; i < spineItems.length; i++) {
      const itemId = spineItems[i];
      const item = manifestItems.get(itemId);
      if (!item || !item.mediaType.includes("html")) continue;

      const filePath = rootDir + item.href;
      const fileContent =
        (await zip.file(filePath)?.async("string")) ||
        (await zip.file(item.href)?.async("string"));

      if (!fileContent) continue;

      const html = sanitizeHtml(fileContent, bookId);
      const text = stripHtml(fileContent);

      chapters.push({
        id: itemId,
        title: `Chapter ${i + 1}`,
        html,
        text,
        characterStart: totalCharacters,
        characterEnd: totalCharacters + text.length,
      });

      totalCharacters += text.length;

      // Yield to event loop every 5 chapters to prevent blocking
      if (i % 5 === 4) {
        await yieldToEventLoop();
      }
    }

    if (chapters.length === 0) {
      return null;
    }

    return {
      bookId,
      format: "epub",
      type: "text",
      chapters,
      totalCharacters,
      toc: [], // No TOC available in fallback mode
    };
  } catch {
    return null;
  }
}

/**
 * Create empty content structure for failed parses
 */
function createEmptyContent(bookId: string): TextContent {
  return {
    bookId,
    format: "epub",
    type: "text",
    chapters: [],
    totalCharacters: 0,
    toc: [],
  };
}
