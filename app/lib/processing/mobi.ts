import { initMobiFile } from "@lingo-reader/mobi-parser";
import type { BookMetadata, ExtractedContent, Chapter } from "../types";

export async function extractMobiMetadata(buffer: Buffer): Promise<BookMetadata> {
  const mobi = await initMobiFile(buffer);
  const metadata = mobi.getMetadata();

  return {
    title: metadata.title || null,
    authors: metadata.author || [],
    publisher: metadata.publisher || null,
    description: metadata.description || null,
    language: metadata.language || null,
    isbn: null, // MOBI metadata doesn't have direct ISBN field in this API
    publishedDate: metadata.published || null,
    pageCount: null,
  };
}

export async function extractMobiContent(buffer: Buffer): Promise<ExtractedContent> {
  const mobi = await initMobiFile(buffer);
  const spine = mobi.getSpine();
  const toc = mobi.getToc();

  const chapters: Chapter[] = [];
  let fullText = "";

  for (let i = 0; i < spine.length; i++) {
    const spineItem = spine[i];
    try {
      const chapter = await mobi.loadChapter(spineItem.id);
      const text = stripHtml(chapter?.html || "");

      // Find matching TOC entry
      const tocEntry = toc.find((t) => t.href.includes(spineItem.id));

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
      href: item.href || "",
      index: i,
    })),
  };
}

export async function extractMobiCover(buffer: Buffer): Promise<Buffer | null> {
  try {
    const mobi = await initMobiFile(buffer);
    const cover = mobi.getCoverImage();
    if (cover) {
      return Buffer.from(cover);
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
