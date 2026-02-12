import { fromBuffer } from "pdf2pic";
import { readFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

// Cache directory for rendered pages
const CACHE_DIR = "data/pdf-cache";

// Ensure cache directory exists
async function ensureCacheDir(): Promise<void> {
  if (!existsSync(CACHE_DIR)) {
    await mkdir(CACHE_DIR, { recursive: true });
  }
}

/**
 * Render a PDF page to a PNG buffer using GraphicsMagick via pdf2pic
 */
export async function renderPdfPage(
  buffer: Buffer,
  bookId: string,
  pageNumber: number,
  scale = 2.0,
): Promise<Buffer> {
  await ensureCacheDir();

  // Check if page is already cached
  const cachePath = join(CACHE_DIR, `${bookId}-page-${pageNumber}.png`);
  if (existsSync(cachePath)) {
    return readFile(cachePath);
  }

  // Use pdf2pic with GraphicsMagick for high-quality rendering
  const converter = fromBuffer(buffer, {
    density: Math.round(150 * scale), // DPI - higher = better quality
    savePath: CACHE_DIR,
    saveFilename: `${bookId}-page`,
    format: "png",
    width: Math.round(800 * scale),
    height: Math.round(1200 * scale),
    preserveAspectRatio: true,
  });

  let result;
  try {
    result = await converter(pageNumber, { responseType: "buffer" });
  } catch (error) {
    console.error(`[PDF] Error rendering page ${pageNumber} for book ${bookId}:`, error);
    throw new Error(`Failed to render PDF page ${pageNumber}: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  if (!result.buffer) {
    console.error(`[PDF] Failed to render page ${pageNumber} for book ${bookId}. Result:`, result);
    throw new Error(`Failed to render PDF page ${pageNumber}`);
  }

  return result.buffer;
}
