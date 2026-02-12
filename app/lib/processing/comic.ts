import { createExtractorFromData } from "node-unrar-js";
import type { BookFormat } from "../types";

// Image extensions for comic book archives
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

interface ComicPage {
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
    case "bmp":
      return "image/bmp";
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
 * Get sorted list of image file names from a CBZ file (without extracting data)
 * Returns empty array if the archive is corrupted
 */
async function getCbzImageFileList(buffer: Buffer): Promise<string[]> {
  try {
    console.log(`[CBZ] Parsing CBZ archive, buffer size: ${buffer.length} bytes`);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);

    const allFiles = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
    const imageFiles = allFiles.filter((name) => isImageFile(name));

    console.log(`[CBZ] Found ${allFiles.length} total files, ${imageFiles.length} images`);
    if (imageFiles.length === 0 && allFiles.length > 0) {
      console.log(`[CBZ] All files in archive:`, allFiles.slice(0, 10));
    }

    return imageFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch (error) {
    console.error("Error reading CBZ archive:", error);
    return [];
  }
}

/**
 * Extract a single page from a CBZ (ZIP) file
 */
async function extractCbzPage(buffer: Buffer, pageIndex: number): Promise<ComicPage | null> {
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);
    const imageFiles = Object.keys(zip.files)
      .filter((name) => !zip.files[name].dir && isImageFile(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (pageIndex < 0 || pageIndex >= imageFiles.length) {
      return null;
    }

    const fileName = imageFiles[pageIndex];
    const file = zip.files[fileName];
    const data = await file.async("nodebuffer");

    return {
      index: pageIndex,
      name: fileName,
      data,
      mimeType: getMimeType(fileName),
    };
  } catch (error) {
    console.error("Error extracting CBZ page:", error);
    return null;
  }
}

/**
 * Get page count from a CBZ file (without extracting data)
 */
async function getCbzPageCount(buffer: Buffer): Promise<number> {
  const imageFiles = await getCbzImageFileList(buffer);
  return imageFiles.length;
}

/**
 * Convert Buffer to ArrayBuffer for node-unrar-js
 */
function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

/**
 * Get sorted list of image file names from a CBR file (without extracting data)
 * Returns empty array if the archive is corrupted
 */
async function getCbrImageFileList(buffer: Buffer): Promise<string[]> {
  try {
    console.log(`[CBR] Parsing CBR archive, buffer size: ${buffer.length} bytes`);
    const extractor = await createExtractorFromData({ data: bufferToArrayBuffer(buffer) });
    const list = extractor.getFileList();

    const allFiles: string[] = [];
    const imageFiles: string[] = [];
    for (const fileHeader of list.fileHeaders) {
      allFiles.push(fileHeader.name);
      if (fileHeader.flags.directory) continue;
      if (!isImageFile(fileHeader.name)) continue;
      imageFiles.push(fileHeader.name);
    }

    console.log(`[CBR] Found ${allFiles.length} total files, ${imageFiles.length} images`);
    if (imageFiles.length === 0 && allFiles.length > 0) {
      console.log(`[CBR] All files in archive:`, allFiles.slice(0, 10));
    }

    return imageFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch (error) {
    console.error("Error reading CBR archive:", error);
    return [];
  }
}

/**
 * Extract a single page from a CBR (RAR) file
 */
async function extractCbrPage(buffer: Buffer, pageIndex: number): Promise<ComicPage | null> {
  try {
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
  } catch (error) {
    console.error("Error extracting CBR page:", error);
    return null;
  }
}

/**
 * Get page count from a CBR file (without extracting data)
 */
async function getCbrPageCount(buffer: Buffer): Promise<number> {
  const imageFiles = await getCbrImageFileList(buffer);
  return imageFiles.length;
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
export async function getComicPageCount(buffer: Buffer, format: BookFormat): Promise<number> {
  switch (format) {
    case "cbz":
      return getCbzPageCount(buffer);
    case "cbr":
      return getCbrPageCount(buffer);
    default:
      throw new Error(`Not a comic book format: ${format}`);
  }
}

/**
 * Convert a CBR (RAR) archive to CBZ (ZIP) format
 * This allows iOS devices to read comics offline without server extraction
 *
 * Note: Large files (300MB+) may require 4GB+ container memory due to
 * in-memory extraction. Configure Docker with appropriate memory limits.
 */
export async function convertCbrToCbz(cbrBuffer: Buffer): Promise<Buffer> {
  const sizeMB = (cbrBuffer.length / 1024 / 1024).toFixed(1);
  console.log(`[CBR→CBZ] Starting conversion, input size: ${sizeMB}MB`);

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  // Get list of image files from CBR
  const imageFiles = await getCbrImageFileList(cbrBuffer);

  if (imageFiles.length === 0) {
    throw new Error("No images found in CBR archive");
  }

  console.log(`[CBR→CBZ] Extracting ${imageFiles.length} images...`);

  // Extract all images from CBR
  const extractor = await createExtractorFromData({ data: bufferToArrayBuffer(cbrBuffer) });
  const { files } = extractor.extract({ files: imageFiles });

  let extractedCount = 0;
  for (const file of files) {
    if (file.extraction) {
      // Get just the filename without directory path for cleaner structure
      const baseName = file.fileHeader.name.split("/").pop() || file.fileHeader.name;
      zip.file(baseName, file.extraction);
      extractedCount++;
    }
  }

  console.log(`[CBR→CBZ] Extracted ${extractedCount} images, creating CBZ...`);

  // Generate CBZ with good compression
  const cbzBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  console.log(`[CBR→CBZ] Conversion complete, output size: ${(cbzBuffer.length / 1024 / 1024).toFixed(1)}MB`);

  return cbzBuffer;
}
