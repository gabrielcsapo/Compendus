import AdmZip from "adm-zip";
import { createExtractorFromData } from "node-unrar-js";
import type { BookFormat } from "../types";

// Image extensions for comic book archives
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

export interface ComicPage {
  index: number;
  name: string;
  data: Buffer;
  mimeType: string;
}

/**
 * Get the MIME type for an image file based on extension
 */
function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return "image/jpeg";
  }
}

/**
 * Check if a filename is an image
 */
function isImageFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Get sorted list of image entries from a CBZ file (without extracting data)
 */
function getCbzImageEntries(buffer: Buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  return entries
    .filter((entry) => !entry.isDirectory && isImageFile(entry.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));
}

/**
 * Extract a single page from a CBZ (ZIP) file
 */
export async function extractCbzPage(buffer: Buffer, pageIndex: number): Promise<ComicPage | null> {
  const imageEntries = getCbzImageEntries(buffer);

  if (pageIndex < 0 || pageIndex >= imageEntries.length) {
    return null;
  }

  const entry = imageEntries[pageIndex];
  return {
    index: pageIndex,
    name: entry.entryName,
    data: entry.getData(),
    mimeType: getMimeType(entry.entryName),
  };
}

/**
 * Get page count from a CBZ file (without extracting data)
 */
export function getCbzPageCount(buffer: Buffer): number {
  return getCbzImageEntries(buffer).length;
}

/**
 * Extract all pages from a CBZ (ZIP) file
 */
export async function extractCbzPages(buffer: Buffer): Promise<ComicPage[]> {
  const imageEntries = getCbzImageEntries(buffer);

  return imageEntries.map((entry, index) => ({
    index,
    name: entry.entryName,
    data: entry.getData(),
    mimeType: getMimeType(entry.entryName),
  }));
}

/**
 * Convert Buffer to ArrayBuffer for node-unrar-js
 */
function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

/**
 * Get sorted list of image file names from a CBR file (without extracting data)
 */
async function getCbrImageFileList(buffer: Buffer): Promise<string[]> {
  const extractor = await createExtractorFromData({ data: bufferToArrayBuffer(buffer) });
  const list = extractor.getFileList();

  const imageFiles: string[] = [];
  for (const fileHeader of list.fileHeaders) {
    if (fileHeader.flags.directory) continue;
    if (!isImageFile(fileHeader.name)) continue;
    imageFiles.push(fileHeader.name);
  }

  return imageFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Extract a single page from a CBR (RAR) file
 */
export async function extractCbrPage(buffer: Buffer, pageIndex: number): Promise<ComicPage | null> {
  const imageFiles = await getCbrImageFileList(buffer);

  if (pageIndex < 0 || pageIndex >= imageFiles.length) {
    return null;
  }

  const targetFileName = imageFiles[pageIndex];

  // Extract only the specific file we need
  const extractor = await createExtractorFromData({ data: bufferToArrayBuffer(buffer) });
  const { files } = extractor.extract({ files: [targetFileName] });

  for (const file of files) {
    if (file.fileHeader.name === targetFileName && file.extraction) {
      return {
        index: pageIndex,
        name: file.fileHeader.name,
        data: Buffer.from(file.extraction),
        mimeType: getMimeType(file.fileHeader.name),
      };
    }
  }

  return null;
}

/**
 * Get page count from a CBR file (without extracting data)
 */
export async function getCbrPageCount(buffer: Buffer): Promise<number> {
  const imageFiles = await getCbrImageFileList(buffer);
  return imageFiles.length;
}

/**
 * Extract all pages from a CBR (RAR) file
 */
export async function extractCbrPages(buffer: Buffer): Promise<ComicPage[]> {
  const extractor = await createExtractorFromData({ data: bufferToArrayBuffer(buffer) });
  const { files } = extractor.extract();

  const pages: ComicPage[] = [];

  // Collect all image files
  for (const file of files) {
    if (file.fileHeader.flags.directory) continue;
    if (!isImageFile(file.fileHeader.name)) continue;

    pages.push({
      index: 0, // Will be set after sorting
      name: file.fileHeader.name,
      data: Buffer.from(file.extraction!),
      mimeType: getMimeType(file.fileHeader.name),
    });
  }

  // Sort alphabetically and update indices
  pages.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  pages.forEach((page, index) => {
    page.index = index;
  });

  return pages;
}

/**
 * Extract pages from a comic book archive (CBZ or CBR)
 */
export async function extractComicPages(
  buffer: Buffer,
  format: BookFormat,
): Promise<ComicPage[]> {
  switch (format) {
    case "cbz":
      return extractCbzPages(buffer);
    case "cbr":
      return extractCbrPages(buffer);
    default:
      throw new Error(`Not a comic book format: ${format}`);
  }
}

/**
 * Get a single page from a comic book archive (optimized - only extracts the requested page)
 */
export async function getComicPage(
  buffer: Buffer,
  format: BookFormat,
  pageIndex: number,
): Promise<ComicPage | null> {
  switch (format) {
    case "cbz":
      return extractCbzPage(buffer, pageIndex);
    case "cbr":
      return extractCbrPage(buffer, pageIndex);
    default:
      throw new Error(`Not a comic book format: ${format}`);
  }
}

/**
 * Get the total number of pages in a comic book archive (optimized - doesn't extract image data)
 */
export async function getComicPageCount(
  buffer: Buffer,
  format: BookFormat,
): Promise<number> {
  switch (format) {
    case "cbz":
      return getCbzPageCount(buffer);
    case "cbr":
      return getCbrPageCount(buffer);
    default:
      throw new Error(`Not a comic book format: ${format}`);
  }
}
