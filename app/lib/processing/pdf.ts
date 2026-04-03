import { getDocument, type DocumentInitParameters } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { BookMetadata, ExtractedContent } from "../types";

const PDFJS_OPTIONS: Partial<DocumentInitParameters> = {
  useWorkerFetch: false,
  isEvalSupported: false,
  useSystemFonts: false,
};

export async function extractPdfMetadata(buffer: Buffer): Promise<BookMetadata> {
  const task = getDocument({ ...PDFJS_OPTIONS, data: new Uint8Array(buffer) });
  const doc = await task.promise;

  try {
    const meta = await doc.getMetadata();
    const info = meta.info as Record<string, unknown> | null;

    return {
      title: (info?.Title as string) || null,
      authors: info?.Author ? [info.Author as string] : [],
      publisher: (info?.Producer as string) || null,
      description: (info?.Subject as string) || null,
      pageCount: doc.numPages,
      language: null,
      publishedDate: info?.CreationDate ? parsePdfDate(info.CreationDate as string) : null,
    };
  } finally {
    await doc.destroy();
  }
}

export async function extractPdfContent(buffer: Buffer): Promise<ExtractedContent> {
  const task = getDocument({ ...PDFJS_OPTIONS, data: new Uint8Array(buffer) });
  const doc = await task.promise;

  try {
    const textParts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .filter((item): item is { str: string } => "str" in item)
        .map((item) => item.str)
        .join(" ");
      textParts.push(pageText);
    }

    return {
      fullText: textParts.join("\n"),
      chapters: [],
      toc: [],
    };
  } finally {
    await doc.destroy();
  }
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
