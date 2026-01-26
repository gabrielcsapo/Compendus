import { rawDb } from "../db";
import type { ExtractedContent } from "../types";

const CHUNK_SIZE = 10000; // Characters per chunk

export async function indexContent(bookId: string, content: ExtractedContent): Promise<void> {
  // Index chapters individually
  for (const chapter of content.chapters) {
    const chunks = chunkText(chapter.content, CHUNK_SIZE);

    for (const chunk of chunks) {
      rawDb
        .prepare(
          `INSERT INTO book_content_fts (book_id, chapter_index, chapter_title, content)
           VALUES (?, ?, ?, ?)`,
        )
        .run(bookId, chapter.index, chapter.title, chunk);
    }
  }
}

export async function indexBookMetadata(
  bookId: string,
  title: string,
  authors: string,
  description: string | null,
): Promise<void> {
  rawDb
    .prepare(
      `INSERT INTO books_fts (book_id, title, authors, description)
       VALUES (?, ?, ?, ?)`,
    )
    .run(bookId, title, authors, description || "");
}

export async function removeBookIndex(bookId: string): Promise<void> {
  rawDb.prepare(`DELETE FROM book_content_fts WHERE book_id = ?`).run(bookId);
  rawDb.prepare(`DELETE FROM books_fts WHERE book_id = ?`).run(bookId);
}

export async function reindexBook(bookId: string, content: ExtractedContent): Promise<void> {
  // Remove existing index entries for content
  rawDb.prepare(`DELETE FROM book_content_fts WHERE book_id = ?`).run(bookId);

  // Re-index
  await indexContent(bookId, content);
}

export function optimizeIndex(): void {
  rawDb.exec(`INSERT INTO books_fts(books_fts) VALUES('optimize')`);
  rawDb.exec(`INSERT INTO book_content_fts(book_content_fts) VALUES('optimize')`);
}

export function rebuildIndex(): void {
  rawDb.exec(`INSERT INTO books_fts(books_fts) VALUES('rebuild')`);
  rawDb.exec(`INSERT INTO book_content_fts(book_content_fts) VALUES('rebuild')`);
}

function chunkText(text: string, maxSize: number): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxSize;

    // Try to break at sentence boundary
    if (end < text.length) {
      const lastPeriod = text.lastIndexOf(".", end);
      const lastNewline = text.lastIndexOf("\n", end);
      const breakPoint = Math.max(lastPeriod, lastNewline);

      if (breakPoint > start + maxSize / 2) {
        end = breakPoint + 1;
      }
    }

    chunks.push(text.slice(start, end).trim());
    start = end;
  }

  return chunks.filter((c) => c.length > 0);
}
