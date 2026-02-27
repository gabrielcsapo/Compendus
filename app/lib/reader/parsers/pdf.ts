// Must be imported before pdfjs-dist to polyfill DOMMatrix/Path2D/ImageData in Node.js
import "./pdf-polyfill";

import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PdfContent, TocEntry } from "../types";

/**
 * Parse PDF file into normalized content for the reader
 *
 * Uses pdfjs-dist to get accurate page count and outline
 */
export async function parsePdf(buffer: Buffer | Uint8Array, bookId: string): Promise<PdfContent> {
  try {
    // pdfjs-dist explicitly requires a pure Uint8Array, NOT a Buffer
    // Buffer is a subclass of Uint8Array in Node.js, but pdfjs rejects it
    // We must create a fresh Uint8Array from the buffer's underlying ArrayBuffer
    let data: Uint8Array;
    if (Buffer.isBuffer(buffer)) {
      // Create a pure Uint8Array from the Buffer's underlying ArrayBuffer
      data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } else if (buffer instanceof Uint8Array) {
      // Already a pure Uint8Array
      data = buffer;
    } else {
      // Handle case where buffer is a serialized object (e.g., from worker threads)
      const b = Buffer.from(buffer as unknown as ArrayLike<number>);
      data = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    }

    console.log(`[PDF Parser] Loading PDF for ${bookId}, buffer size: ${data.length} bytes`);

    const loadingTask = pdfjsLib.getDocument({
      data,
      useSystemFonts: true,
      disableFontFace: true,
    });

    const pdfDoc = await loadingTask.promise;
    const pageCount = pdfDoc.numPages;

    console.log(`[PDF Parser] PDF loaded for ${bookId}, numPages: ${pageCount}`);

    // Try to extract TOC from PDF outline
    const toc = await extractPdfToc(pdfDoc);

    // Clean up
    await pdfDoc.destroy();

    return {
      bookId,
      format: "pdf",
      type: "pdf",
      pageCount,
      toc,
    };
  } catch (error) {
    console.error(`[PDF Parser] Error parsing PDF for ${bookId}:`, error);
    // Re-throw the error so it can be handled properly upstream
    throw error;
  }
}

/**
 * Extract table of contents from PDF outline
 */
async function extractPdfToc(pdfDoc: pdfjsLib.PDFDocumentProxy): Promise<TocEntry[]> {
  try {
    const outline = await pdfDoc.getOutline();
    if (!outline) return [];

    const numPages = pdfDoc.numPages;

    async function processOutlineItems(
      items: Array<{ title: string; dest: unknown; items?: unknown[] }>,
      level = 0,
    ): Promise<TocEntry[]> {
      const entries: TocEntry[] = [];

      for (const item of items) {
        let position = 0;

        // Try to get page number from destination
        if (item.dest) {
          try {
            const dest =
              typeof item.dest === "string" ? await pdfDoc.getDestination(item.dest) : item.dest;

            if (dest && Array.isArray(dest) && dest[0]) {
              const pageRef = dest[0] as { num: number; gen: number };
              const pageIndex = await pdfDoc.getPageIndex(pageRef);
              position = pageIndex / Math.max(1, numPages - 1);
            }
          } catch {
            // Ignore destination resolution errors
          }
        }

        const entry: TocEntry = {
          title: item.title,
          position,
          level,
        };

        if (item.items && item.items.length > 0) {
          entry.children = await processOutlineItems(
            item.items as Array<{ title: string; dest: unknown; items?: unknown[] }>,
            level + 1,
          );
        }

        entries.push(entry);
      }

      return entries;
    }

    return processOutlineItems(
      outline as Array<{ title: string; dest: unknown; items?: unknown[] }>,
    );
  } catch {
    return [];
  }
}
