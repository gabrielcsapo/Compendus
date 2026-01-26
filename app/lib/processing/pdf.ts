import { PDFParse } from "pdf-parse";
import type { BookMetadata, ExtractedContent } from "../types";

export async function extractPdfMetadata(buffer: Buffer): Promise<BookMetadata> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const info = await parser.getInfo();

  return {
    title: info.info?.Title || null,
    authors: info.info?.Author ? [info.info.Author] : [],
    publisher: info.info?.Producer || null,
    description: info.info?.Subject || null,
    pageCount: info.total,
    language: null,
    publishedDate: info.info?.CreationDate ? parsePdfDate(info.info.CreationDate) : null,
  };
}

export async function extractPdfContent(buffer: Buffer): Promise<ExtractedContent> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const textResult = await parser.getText();

  return {
    fullText: textResult.text,
    chapters: [],
    toc: [],
  };
}

function parsePdfDate(pdfDate: string | Date): string | null {
  if (pdfDate instanceof Date) {
    return pdfDate.toISOString().split("T")[0];
  }
  // PDF dates are in format: D:YYYYMMDDHHmmSSOHH'mm'
  const match = pdfDate.match(/D:(\d{4})(\d{2})(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  return null;
}
