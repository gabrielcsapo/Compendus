import { initEpubFile } from "@lingo-reader/epub-parser";
import type { BookMetadata, ExtractedContent, Chapter } from "../types";

/**
 * Validate that a buffer looks like a valid ZIP file by checking:
 * 1. PK signature at the start
 * 2. End of Central Directory signature somewhere in the file
 */
function isValidZipBuffer(buffer: Buffer): boolean {
  // Check minimum size (ZIP needs at least 22 bytes for EOCD)
  if (buffer.length < 22) return false;

  // Check PK signature at start
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) return false;

  // Check for End of Central Directory signature (PK\x05\x06)
  // Search in the last 65KB + 22 bytes (max comment size + EOCD size)
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

export async function extractEpubMetadata(buffer: Buffer): Promise<BookMetadata> {
  // Validate ZIP structure before parsing to prevent JSZip crash
  if (!isValidZipBuffer(buffer)) {
    return { title: null, authors: [] };
  }

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
  // Validate ZIP structure before parsing to prevent JSZip crash
  if (!isValidZipBuffer(buffer)) {
    return { fullText: "", chapters: [], toc: [] };
  }

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
  // Validate ZIP structure before parsing to prevent JSZip crash
  if (!isValidZipBuffer(buffer)) {
    return null;
  }

  try {
    const epub = await initEpubFile(buffer);
    const coverPath = epub.getCoverImage();
    // getCoverImage returns a path, not actual image data
    // For now, return null as we'd need additional processing
    if (coverPath) {
      // The cover would need to be extracted from the epub zip
      // This is complex and would require accessing the internal zip
      return null;
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
export async function extractEpubResource(buffer: Buffer, resourcePath: string): Promise<{ data: Buffer; mimeType: string } | null> {
  // Validate ZIP structure before parsing
  if (!isValidZipBuffer(buffer)) {
    return null;
  }

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
      resourcePath.replace(/^\/+/, ''),
      `OEBPS/${resourcePath.replace(/^\/+/, '')}`,
      `OPS/${resourcePath.replace(/^\/+/, '')}`,
      `EPUB/${resourcePath.replace(/^\/+/, '')}`,
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
    const fileName = resourcePath.split('/').pop();
    if (fileName) {
      const files = Object.keys(zip.files);
      const matchingFile = files.find(f => f.endsWith(`/${fileName}`) || f === fileName);
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
  } catch (err) {
    console.error("Failed to extract EPUB resource:", err);
    return null;
  }
}

function getMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'webp': 'image/webp',
    'css': 'text/css',
    'html': 'text/html',
    'xhtml': 'application/xhtml+xml',
    'xml': 'application/xml',
    'ttf': 'font/ttf',
    'otf': 'font/otf',
    'woff': 'font/woff',
    'woff2': 'font/woff2',
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}
