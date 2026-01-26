import { initEpubFile } from "@lingo-reader/epub-parser";
import type { BookMetadata, ExtractedContent, Chapter } from "../types";

export async function extractEpubMetadata(buffer: Buffer): Promise<BookMetadata> {
  const epub = await initEpubFile(buffer);
  const metadata = epub.getMetadata();

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
  const epub = await initEpubFile(buffer);
  const spine = epub.getSpine();
  const toc = epub.getToc();

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
