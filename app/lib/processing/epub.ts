import { initEpubFile } from "../epub-parser.js";
import type { BookMetadata, ExtractedContent, Chapter } from "../types";
import { yieldToEventLoop } from "./utils";

export async function extractEpubMetadata(buffer: Buffer): Promise<BookMetadata> {
  let epub;
  try {
    epub = await initEpubFile(buffer);
  } catch {
    // Handle corrupted or non-standard EPUB files gracefully
    // Common issues: malformed guide section, missing required elements
    return { title: null, authors: [] };
  }

  let metadata;
  try {
    metadata = epub.getMetadata();
  } catch {
    return { title: null, authors: [] };
  }

  // Extract authors from creator array
  const authors: string[] = [];
  if (metadata.creator) {
    for (const c of metadata.creator) {
      if (c.contributor) {
        authors.push(c.contributor);
      }
    }
  }

  // Extract ISBN from identifier
  let isbn: string | null = null;
  if (metadata.identifier) {
    const id = metadata.identifier.id;
    const match = id.match(/(?:isbn[:\s]?)?(97[89]\d{10}|\d{9}[\dXx])/i);
    if (match) isbn = match[1];
  }

  // Extract date
  let publishedDate: string | null = null;
  if (metadata.date) {
    // date is Record<string, string>, get first value
    const dates = Object.values(metadata.date);
    if (dates.length > 0) {
      publishedDate = dates[0];
    }
  }

  return {
    title: metadata.title || null,
    subtitle: null,
    authors,
    publisher: metadata.publisher || null,
    description: metadata.description || null,
    language: metadata.language || null,
    isbn,
    publishedDate,
    pageCount: null,
  };
}

export async function extractEpubContent(buffer: Buffer): Promise<ExtractedContent> {
  let epub;
  try {
    epub = await initEpubFile(buffer);
  } catch {
    // Handle corrupted or non-standard EPUB files gracefully
    // Common issues: malformed guide section, missing required elements
    // The book will still import, just without full-text search indexing
    return { fullText: "", chapters: [], toc: [] };
  }

  let spine;
  let toc;
  try {
    spine = epub.getSpine();
    toc = epub.getToc();
  } catch {
    // Some EPUBs have malformed spine/toc - continue with empty content
    return { fullText: "", chapters: [], toc: [] };
  }

  const chapters: Chapter[] = [];
  let fullText = "";

  for (let i = 0; i < spine.length; i++) {
    const spineItem = spine[i];
    try {
      const chapterContent = await epub.loadChapter(spineItem.id);
      const text = stripHtml(chapterContent.html || "");

      // Find matching TOC entry
      const tocEntry = toc.find((t) => t.href.includes(spineItem.href));

      chapters.push({
        index: i,
        title: tocEntry?.label || `Chapter ${i + 1}`,
        content: text,
      });

      fullText += text + "\n\n";
    } catch {
      // Skip chapters that fail to load
    }

    // Yield to event loop every 5 chapters to prevent blocking
    if (i % 5 === 4) {
      await yieldToEventLoop();
    }
  }

  return {
    fullText,
    chapters,
    toc: toc.map((item, i) => ({
      title: item.label,
      href: item.href,
      index: i,
    })),
  };
}

export async function extractEpubCover(buffer: Buffer): Promise<Buffer | null> {
  try {
    const { mkdirSync, existsSync, readFileSync, rmSync } = await import("fs");
    const { resolve } = await import("path");
    const { tmpdir } = await import("os");
    const { randomUUID } = await import("crypto");

    // Use a temporary directory for resource extraction
    const tmpResourceDir = resolve(tmpdir(), `epub-cover-${randomUUID()}`);
    mkdirSync(tmpResourceDir, { recursive: true });

    try {
      const epub = await initEpubFile(buffer, tmpResourceDir);
      const coverPath = epub.getCoverImage();

      if (coverPath && existsSync(coverPath)) {
        const data = readFileSync(coverPath);
        epub.destroy();
        return data;
      }

      epub.destroy();
    } finally {
      // Clean up temp directory
      if (existsSync(tmpResourceDir)) {
        rmSync(tmpResourceDir, { recursive: true, force: true });
      }
    }

    // Fallback: Try to find cover by common naming patterns in the ZIP
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);
    const files = Object.keys(zip.files);

    const coverPatterns = [
      /cover\.(jpe?g|png|gif|webp)$/i,
      /cover[-_]?image\.(jpe?g|png|gif|webp)$/i,
      /title\.(jpe?g|png|gif|webp)$/i,
      /front\.(jpe?g|png|gif|webp)$/i,
      /jacket\.(jpe?g|png|gif|webp)$/i,
    ];

    for (const pattern of coverPatterns) {
      const coverFile = files.find((f) => pattern.test(f));
      if (coverFile) {
        const file = zip.file(coverFile);
        if (file) {
          return await file.async("nodebuffer");
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract a resource (image, css, etc.) from an EPUB file by path
 */
export async function extractEpubResource(
  buffer: Buffer,
  resourcePath: string,
): Promise<{ data: Buffer; mimeType: string } | null> {
  try {
    // Use JSZip directly to extract the resource
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);

    // Try to find the resource - EPUBs often have resources in OEBPS/ or OPS/ subdirectories
    const possiblePaths = [
      resourcePath,
      `OEBPS/${resourcePath}`,
      `OPS/${resourcePath}`,
      `EPUB/${resourcePath}`,
      // Also try without leading slashes
      resourcePath.replace(/^\/+/, ""),
      `OEBPS/${resourcePath.replace(/^\/+/, "")}`,
      `OPS/${resourcePath.replace(/^\/+/, "")}`,
      `EPUB/${resourcePath.replace(/^\/+/, "")}`,
    ];

    for (const path of possiblePaths) {
      const file = zip.file(path);
      if (file) {
        const data = await file.async("nodebuffer");
        const mimeType = getMimeType(path);
        return { data, mimeType };
      }
    }

    // If not found by exact path, try to find by filename
    const fileName = resourcePath.split("/").pop();
    if (fileName) {
      const files = Object.keys(zip.files);
      const matchingFile = files.find((f) => f.endsWith(`/${fileName}`) || f === fileName);
      if (matchingFile) {
        const file = zip.file(matchingFile);
        if (file) {
          const data = await file.async("nodebuffer");
          const mimeType = getMimeType(matchingFile);
          return { data, mimeType };
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

function getMimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
    css: "text/css",
    html: "text/html",
    xhtml: "application/xhtml+xml",
    xml: "application/xml",
    ttf: "font/ttf",
    otf: "font/otf",
    woff: "font/woff",
    woff2: "font/woff2",
  };
  return mimeTypes[ext || ""] || "application/octet-stream";
}
