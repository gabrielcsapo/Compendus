import { initMobiFile, initKf8File } from "@lingo-reader/mobi-parser";
import { resolve } from "path";
import { mkdirSync } from "fs";
import type { TextContent, NormalizedChapter, TocEntry } from "../types";
import type { BookFormat } from "../../types";
import { yieldToEventLoop } from "../../processing/utils";

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
 * Rewrites image src URLs to point to the MOBI resource API with book-specific paths
 * Also strips AZW3/KF8-specific content like kindle: URLs
 */
function sanitizeHtml(html: string, bookId: string): string {
  return (
    html
      // Remove XML declarations (AZW3/KF8) - handle BOM, whitespace, and various formats
      .replace(/^\s*<\?xml[^?]*\?>\s*/gi, "")
      .replace(/<\?xml[^?]*\?>/gi, "")
      // Remove any XML processing instructions
      .replace(/<\?[^?]*\?>/gi, "")
      // Remove DOCTYPE declarations
      .replace(/<!DOCTYPE[^>]*>/gi, "")
      // Remove XML declaration fragments - various malformed patterns
      // Aggressively match anything that looks like XML declaration attributes followed by ?>
      .replace(/^\s*version\s*=\s*["'][^"']*["'][^?]*\?>/gi, "")
      .replace(/version\s*=\s*["'][^"']*["'][^?]*\?>/gi, "")
      // Remove link tags with kindle: URLs (AZW3/KF8 internal stylesheets)
      .replace(/<link[^>]*href=["']kindle:[^"']*["'][^>]*\/?>/gi, "")
      // Remove link tags with flow: URLs
      .replace(/<link[^>]*href=["']flow:[^"']*["'][^>]*\/?>/gi, "")
      // Remove any other link tags pointing to internal resources
      .replace(/<link[^>]*>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, "")
      .replace(/\s+on\w+\s*=\s*[^\s>]*/gi, "")
      .replace(/href\s*=\s*["']javascript:[^"']*["']/gi, "")
      .replace(/src\s*=\s*["']data:[^"']*["']/gi, "")
      // Remove html/head/body wrapper tags
      .replace(/<html[^>]*>/gi, "")
      .replace(/<\/html>/gi, "")
      .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
      .replace(/<body[^>]*>/gi, "")
      .replace(/<\/body>/gi, "")
      // Rewrite all image src URLs to use the mobi-images API
      // Use a function to find and replace img src attributes
      .replace(/<img\s+([^>]*)>/gi, (match, attributes) => {
        // Extract src attribute value
        const srcMatch =
          attributes.match(/src\s*=\s*["']([^"']+)["']/i) ||
          attributes.match(/src\s*=\s*([^\s>]+)/i);
        if (!srcMatch) return match;

        const src = srcMatch[1];

        // Skip absolute URLs and data URIs
        if (
          src.startsWith("http://") ||
          src.startsWith("https://") ||
          src.startsWith("data:") ||
          src.startsWith("/mobi-images/")
        ) {
          return match;
        }

        // Extract just the filename
        const filename = src.split("/").pop() || src;
        const newSrc = `/mobi-images/${bookId}/${filename}`;

        // Replace the src in the attributes
        const newAttributes = attributes
          .replace(/src\s*=\s*(["'])[^"']+\1/i, `src="${newSrc}"`)
          .replace(/src\s*=\s*[^\s>"']+/i, `src="${newSrc}"`);

        return `<img ${newAttributes}>`;
      })
      // Also rewrite SVG image xlink:href URLs
      .replace(
        /(<image\s+[^>]*?xlink:href\s*=\s*["'])([^"']+)(["'][^>]*?>)/gi,
        (match, before, href, after) => {
          // Skip absolute URLs and data URIs
          if (
            href.startsWith("http://") ||
            href.startsWith("https://") ||
            href.startsWith("data:")
          ) {
            return match;
          }
          // Handle absolute filesystem paths - extract filename
          const filename = href.split("/").pop() || href;
          return `${before}/mobi-images/${bookId}/${filename}${after}`;
        },
      )
      // Remove href from anchor tags linking to internal images/resources
      // These cause React Router navigation errors and aren't useful in a web reader
      .replace(
        /<a\s+([^>]*href\s*=\s*["'][^"']*\.(jpe?g|png|gif|webp|svg|bmp)["'][^>]*)>/gi,
        (_match, attributes) => {
          // Remove the href attribute to prevent navigation
          const newAttributes = attributes.replace(/href\s*=\s*["'][^"']*["']/gi, "");
          return `<a ${newAttributes.trim()}>`;
        },
      )
      // Also remove anchor links to internal ebook resources (not external URLs)
      .replace(
        /<a\s+([^>]*href\s*=\s*["'](?!https?:\/\/|mailto:|#)[^"']+["'][^>]*)>/gi,
        (_match, attributes) => {
          // Check if this is an internal link (not http/https/mailto/anchor)
          const hrefMatch = attributes.match(/href\s*=\s*["']([^"']+)["']/i);
          if (hrefMatch) {
            const href = hrefMatch[1];
            // Keep anchor links (#something) but remove file links
            if (!href.startsWith("#")) {
              const newAttributes = attributes.replace(/href\s*=\s*["'][^"']*["']/gi, "");
              return `<a ${newAttributes.trim()}>`;
            }
          }
          return `<a ${attributes}>`;
        },
      )
      .trim()
  );
}

/**
 * Interface for ebook parser (both Mobi and Kf8 parsers implement this)
 */
interface EbookParser {
  getSpine(): Array<{ id: string; text?: string }>;
  getToc(): Array<{ label: string; href?: string }>;
  loadChapter(id: string): { html?: string } | undefined;
}

/**
 * Result of parsing with a specific parser
 */
interface ParseResult {
  parser: EbookParser;
  parserType: string;
  chapters: NormalizedChapter[];
  totalCharacters: number;
  spine: Array<{ id: string; text?: string }>;
  toc: Array<{ label: string; href?: string }>;
}

/**
 * Try to parse with KF8 parser (for AZW3/KF8 format)
 */
async function tryKf8Parser(buffer: Uint8Array, resourceDir: string): Promise<EbookParser | null> {
  try {
    const kf8 = await initKf8File(buffer, resourceDir);
    const spine = kf8.getSpine();
    if (spine.length > 0) {
      return kf8 as unknown as EbookParser;
    }
    return null;
  } catch (error) {
    console.log(`[MOBI Parser] KF8 parser failed:`, error);
    return null;
  }
}

/**
 * Try to parse with MOBI parser (for standard MOBI format)
 */
async function tryMobiParser(buffer: Uint8Array, resourceDir: string): Promise<EbookParser | null> {
  try {
    const mobi = await initMobiFile(buffer, resourceDir);
    const spine = mobi.getSpine();
    console.log(`[MOBI Parser] MOBI spine length: ${spine.length}`);
    if (spine.length > 0) {
      return mobi as unknown as EbookParser;
    }
    console.log(`[MOBI Parser] MOBI parser returned empty spine`);
    return null;
  } catch (error) {
    console.log(`[MOBI Parser] MOBI parser failed:`, error);
    return null;
  }
}

/**
 * Extract content from a parser and return the result
 * Made async to yield to event loop and prevent blocking the server
 */
async function extractContent(parser: EbookParser, parserType: string, bookId: string): Promise<ParseResult> {
  const spine = parser.getSpine();
  const toc = parser.getToc();
  const chapters: NormalizedChapter[] = [];
  let totalCharacters = 0;

  for (let i = 0; i < spine.length; i++) {
    const spineItem = spine[i];
    try {
      const chapterContent = parser.loadChapter(spineItem.id);

      if (!chapterContent?.html) {
        continue;
      }

      const html = sanitizeHtml(chapterContent.html, bookId);
      const text = stripHtml(html); // Use sanitized HTML for text extraction

      // Skip chapters with no content after sanitization
      // But keep chapters that have HTML (might be image-based content)
      if (html.length === 0) {
        continue;
      }

      const tocEntry = toc.find((t) => t.href?.includes(spineItem.id));
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
      // Skip chapters that fail
    }

    // Yield to event loop every 5 chapters to prevent blocking
    if (i % 5 === 4) {
      await yieldToEventLoop();
    }
  }

  return { parser, parserType, chapters, totalCharacters, spine, toc };
}

/**
 * Parse MOBI/AZW3 file into normalized content for the reader
 * Many Amazon files are dual-format (MOBI7 + KF8), so we try both parsers
 * and use the one that extracts more content.
 */
export async function parseMobi(
  buffer: Buffer,
  bookId: string,
  format?: BookFormat,
): Promise<TextContent> {
  try {
    console.log(
      `[MOBI Parser] Book ${bookId}: Parsing ${format ?? "mobi"} file, buffer size: ${buffer.length} bytes`,
    );

    // Create book-specific directory for extracted resources
    const resourceDir = resolve(process.cwd(), "images", bookId);
    mkdirSync(resourceDir, { recursive: true });

    const uint8Buffer = new Uint8Array(buffer);

    // Try both parsers
    const mobiParser = await tryMobiParser(uint8Buffer, resourceDir);
    const kf8Parser = await tryKf8Parser(uint8Buffer, resourceDir);

    let mobiResult: ParseResult | null = null;
    let kf8Result: ParseResult | null = null;

    if (mobiParser) {
      mobiResult = await extractContent(mobiParser, "MOBI", bookId);
    }

    if (kf8Parser) {
      kf8Result = await extractContent(kf8Parser, "KF8", bookId);
    }

    // Choose the better result - consider both text content and number of chapters (for image-based books)
    let bestResult: ParseResult | null = null;

    if (mobiResult && kf8Result) {
      // Both parsers succeeded - use the one with more content
      // For text-based books, prefer more characters
      // For image-based books (0 text chars), prefer more chapters
      const mobiScore =
        mobiResult.totalCharacters > 0 ? mobiResult.totalCharacters : mobiResult.chapters.length;
      const kf8Score =
        kf8Result.totalCharacters > 0 ? kf8Result.totalCharacters : kf8Result.chapters.length;

      if (kf8Score > mobiScore) {
        bestResult = kf8Result;
      } else if (mobiScore > 0) {
        bestResult = mobiResult;
      } else {
        // Both have 0 content, prefer KF8 as it's newer format
        bestResult = kf8Result.chapters.length > 0 ? kf8Result : mobiResult;
      }
    } else if (kf8Result) {
      bestResult = kf8Result;
    } else if (mobiResult) {
      bestResult = mobiResult;
    }

    if (!bestResult || bestResult.chapters.length === 0) {
      console.error(
        `[MOBI Parser] Book ${bookId}: No content extracted. MOBI result: ${mobiResult?.chapters.length ?? "null"} chapters, KF8 result: ${kf8Result?.chapters.length ?? "null"} chapters`,
      );
      return createEmptyContent(
        bookId,
        "This MOBI file uses an older format that cannot be parsed. Please convert it to EPUB using Calibre (https://calibre-ebook.com) and re-upload.",
      );
    }

    // Build TOC with normalized positions
    const normalizedToc = buildToc(bestResult.toc, bestResult.chapters, bestResult.totalCharacters);

    return {
      bookId,
      format: format || "mobi",
      type: "text",
      chapters: bestResult.chapters,
      totalCharacters: bestResult.totalCharacters,
      toc: normalizedToc,
    };
  } catch (error) {
    console.error(`[MOBI Parser] Book ${bookId}: Parse failed:`, error);
    return createEmptyContent(
      bookId,
      "This MOBI file uses an older format that cannot be parsed. Please convert it to EPUB using Calibre (https://calibre-ebook.com) and re-upload.",
    );
  }
}

/**
 * Build normalized TOC with positions
 */
function buildToc(
  rawToc: Array<{ label: string; href?: string }>,
  chapters: NormalizedChapter[],
  totalCharacters: number,
): TocEntry[] {
  return rawToc.map((item) => {
    const href = item.href || "";
    const chapter = chapters.find((ch) => ch.id.includes(href) || href.includes(ch.id));
    const position = chapter ? chapter.characterStart / Math.max(1, totalCharacters) : 0;

    return {
      title: item.label,
      position,
      level: 0,
    };
  });
}

/**
 * Create empty content structure for failed parses
 */
function createEmptyContent(bookId: string, error?: string): TextContent {
  return {
    bookId,
    format: "mobi",
    type: "text",
    chapters: [],
    totalCharacters: 0,
    toc: [],
    error,
  };
}
