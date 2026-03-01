import { initEpubFile } from "../../epub-parser.js";
import { resolve } from "path";
import { mkdirSync } from "fs";
import { yieldToEventLoop } from "../../processing/utils.js";
import type { TextContent, NormalizedChapter, TocEntry } from "../types.js";

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
 * Preserves inline <style> blocks for publisher CSS
 * Marks footnote references with data attributes
 */
function sanitizeHtml(html: string, bookId: string): string {
  return (
    html
      // Remove script tags and their content
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      // Remove event handlers
      .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, "")
      .replace(/\s+on\w+\s*=\s*[^\s>]*/gi, "")
      // Remove javascript: URLs
      .replace(/href\s*=\s*["']javascript:[^"']*["']/gi, "")
      // Remove data: URLs in src (potential XSS)
      .replace(/src\s*=\s*["']data:[^"']*["']/gi, "")
      // Mark footnote reference links for client-side detection
      .replace(
        /(<a\s)([^>]*epub:type\s*=\s*["']noteref["'][^>]*>)/gi,
        '$1data-footnote-ref="true" $2',
      )
      .replace(
        /(<a\s)([^>]*role\s*=\s*["']doc-noteref["'][^>]*>)/gi,
        '$1data-footnote-ref="true" $2',
      )
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
      // Rewrite video/audio/source src URLs for inline media
      .replace(
        /(<(?:video|audio|source)[^>]*\s+src\s*=\s*["'])([^"']+)(["'][^>]*>)/gi,
        (match, before, src, after) => {
          if (
            src.startsWith("http://") ||
            src.startsWith("https://") ||
            src.startsWith("data:")
          ) {
            return match;
          }
          if (src.startsWith("/") && src.includes("/images/")) {
            const filename = src.split("/").pop() || src;
            return `${before}/mobi-images/${bookId}/${filename}${after}`;
          }
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
  // Create book-specific directory for extracted resources
  const resourceDir = resolve(process.cwd(), "images", bookId);
  mkdirSync(resourceDir, { recursive: true });

  let epub;
  try {
    epub = await initEpubFile(buffer, resourceDir);
  } catch {
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

  // Check for fixed layout (pre-paginated) EPUB
  let isFixedLayout = false;
  try {
    const metadata = epub.getMetadata();
    isFixedLayout = metadata.metas?.["rendition:layout"] === "pre-paginated";
  } catch {
    // metadata extraction is non-fatal
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

      // Collect CSS file paths (EPUB-internal paths for the resource API)
      const cssFiles: string[] = [];
      if (chapterContent.css) {
        for (const cssRef of chapterContent.css) {
          if (cssRef.epubPath) {
            cssFiles.push(cssRef.epubPath);
          }
        }
      }

      chapters.push({
        id: spineItem.id,
        title,
        html,
        text,
        characterStart: totalCharacters,
        characterEnd: totalCharacters + text.length,
        cssFiles: cssFiles.length > 0 ? cssFiles : undefined,
        href: spineItem.href,
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

  // Build chapter href map for internal link resolution
  const chapterHrefMap: Record<string, number> = {};
  for (const chapter of chapters) {
    const position = chapter.characterStart / Math.max(1, totalCharacters);
    if (chapter.href) {
      chapterHrefMap[chapter.href] = position;
      // Also map by filename without directory prefix
      const filename = chapter.href.split("/").pop();
      if (filename) {
        chapterHrefMap[filename] = position;
      }
    }
    chapterHrefMap[chapter.id] = position;
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
    isFixedLayout: isFixedLayout || undefined,
    chapterHrefMap,
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
