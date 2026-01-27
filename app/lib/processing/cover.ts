import sharp from "sharp";
import AdmZip from "adm-zip";
import { createExtractorFromData } from "node-unrar-js";
import { createCanvas } from "canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractEpubCover } from "./epub";
import { extractMobiCover } from "./mobi";
import { storeCoverImage } from "../storage";
import type { BookFormat, CoverResult } from "../types";

// Image extensions for comic book archives
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

const COVER_WIDTH = 600; // Increased for better quality
const COVER_HEIGHT = 900;
const COVER_QUALITY = 90;

/**
 * Validate that a buffer contains a supported image format by checking magic bytes
 */
function isValidImageBuffer(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 8) return false;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return true;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return true;
  }

  // GIF: 47 49 46 38
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return true;
  }

  // WebP: 52 49 46 46 ... 57 45 42 50
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer.length >= 12 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return true;
  }

  // BMP: 42 4D
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return true;
  }

  // TIFF: 49 49 2A 00 or 4D 4D 00 2A
  if (
    (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
    (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a)
  ) {
    return true;
  }

  return false;
}

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

export async function extractCover(
  buffer: Buffer,
  format: BookFormat,
): Promise<CoverResult | null> {
  let coverBuffer: Buffer | null = null;

  try {
    switch (format) {
      case "epub":
        coverBuffer = await extractEpubCover(buffer);
        break;
      case "mobi":
        coverBuffer = await extractMobiCover(buffer);
        break;
      case "cbz":
        coverBuffer = await extractCbzCover(buffer);
        break;
      case "cbr":
        coverBuffer = await extractCbrCover(buffer);
        break;
      case "pdf":
        coverBuffer = await extractPdfCover(buffer);
        break;
    }

    if (!coverBuffer) {
      return null;
    }

    // Validate the buffer contains a supported image format before processing
    if (!isValidImageBuffer(coverBuffer)) {
      console.warn("Cover buffer is not a valid image format, skipping");
      return null;
    }

    // Process and resize the cover
    const processed = await sharp(coverBuffer)
      .resize(COVER_WIDTH, COVER_HEIGHT, {
        fit: "cover",
        position: "top",
      })
      .jpeg({ quality: 85 })
      .toBuffer();

    // Get dominant color for placeholder
    const { dominant } = await sharp(coverBuffer)
      .resize(1, 1)
      .raw()
      .toBuffer({ resolveWithObject: true })
      .then(({ data }) => ({
        dominant: `#${data[0].toString(16).padStart(2, "0")}${data[1].toString(16).padStart(2, "0")}${data[2].toString(16).padStart(2, "0")}`,
      }));

    return {
      buffer: processed,
      mimeType: "image/jpeg",
      dominantColor: dominant,
    };
  } catch (error) {
    console.error("Error extracting cover:", error);
    return null;
  }
}

/**
 * Process a cover image buffer (from external source) and store it
 * Optimizes the image with sharp for better quality and smaller file size
 */
export async function processAndStoreCover(
  buffer: Buffer,
  bookId: string,
): Promise<{ path: string | null; dominantColor: string | null }> {
  try {
    // Validate the buffer contains a supported image format before processing
    if (!isValidImageBuffer(buffer)) {
      return { path: null, dominantColor: null };
    }

    // Get image metadata to determine optimal processing
    const metadata = await sharp(buffer).metadata();

    // Validate this looks like a book cover, not a placeholder
    // Book covers are typically taller than wide (portrait orientation)
    // and have reasonable minimum dimensions
    if (metadata.width && metadata.height) {
      const aspectRatio = metadata.height / metadata.width;

      // Reject if:
      // - Too small (likely a placeholder)
      // - Wrong aspect ratio (wider than tall, like Google's "no cover" banner)
      if (metadata.width < 100 || metadata.height < 100) {
        return { path: null, dominantColor: null };
      }

      if (aspectRatio < 0.8) {
        // Image is wider than tall - not a book cover
        return { path: null, dominantColor: null };
      }
    }

    // Process the cover with sharp
    let processor = sharp(buffer);

    // Only resize if image is larger than our target dimensions
    // This prevents upscaling low-quality images
    if (
      metadata.width &&
      metadata.height &&
      (metadata.width > COVER_WIDTH || metadata.height > COVER_HEIGHT)
    ) {
      processor = processor.resize(COVER_WIDTH, COVER_HEIGHT, {
        fit: "inside", // Keep aspect ratio, fit within bounds
        withoutEnlargement: true,
      });
    }

    // Convert to JPEG with good quality
    const processed = await processor
      .jpeg({
        quality: COVER_QUALITY,
        mozjpeg: true, // Use mozjpeg for better compression
      })
      .toBuffer();

    // Get dominant color for placeholder
    const dominantColor = await getDominantColor(buffer);

    // Store the processed cover
    const path = storeCoverImage(processed, bookId);

    return { path, dominantColor };
  } catch (error) {
    console.error("Error processing cover:", error);
    return { path: null, dominantColor: null };
  }
}

/**
 * Extract dominant color from an image for placeholder backgrounds
 */
async function getDominantColor(buffer: Buffer): Promise<string | null> {
  try {
    const { data } = await sharp(buffer).resize(1, 1).raw().toBuffer({ resolveWithObject: true });

    const r = data[0].toString(16).padStart(2, "0");
    const g = data[1].toString(16).padStart(2, "0");
    const b = data[2].toString(16).padStart(2, "0");

    return `#${r}${g}${b}`;
  } catch {
    return null;
  }
}

/**
 * Extract cover from CBZ (Comic Book ZIP) file
 * Returns the first image file sorted alphabetically
 */
async function extractCbzCover(buffer: Buffer): Promise<Buffer | null> {
  // Validate ZIP structure before parsing
  if (!isValidZipBuffer(buffer)) {
    console.error("CBZ file is not a valid ZIP archive");
    return null;
  }

  try {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();

    // Filter to only image files and sort alphabetically
    const imageEntries = entries
      .filter((entry) => {
        const name = entry.entryName.toLowerCase();
        return !entry.isDirectory && IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext));
      })
      .sort((a, b) => a.entryName.localeCompare(b.entryName));

    if (imageEntries.length === 0) {
      return null;
    }

    // Get the first image (typically the cover)
    const coverEntry = imageEntries[0];
    return coverEntry.getData();
  } catch (error) {
    console.error("Error extracting CBZ cover:", error);
    return null;
  }
}

/**
 * Extract cover from CBR (Comic Book RAR) file
 * Returns the first image file sorted alphabetically
 */
async function extractCbrCover(buffer: Buffer): Promise<Buffer | null> {
  try {
    const extractor = await createExtractorFromData({
      data: buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer,
    });
    const { files } = extractor.extract();

    // Collect all image files
    const imageFiles: { name: string; data: Buffer }[] = [];
    for (const file of files) {
      if (file.fileHeader.flags.directory) continue;
      const name = file.fileHeader.name.toLowerCase();
      if (!IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext))) continue;

      imageFiles.push({
        name: file.fileHeader.name,
        data: Buffer.from(file.extraction!),
      });
    }

    if (imageFiles.length === 0) {
      return null;
    }

    // Sort alphabetically and return the first image (cover)
    imageFiles.sort((a, b) => a.name.localeCompare(b.name));
    return imageFiles[0].data;
  } catch (error) {
    console.error("Error extracting CBR cover:", error);
    return null;
  }
}

/**
 * Extract cover from PDF file by rendering the first page
 */
async function extractPdfCover(buffer: Buffer): Promise<Buffer | null> {
  try {
    // Load the PDF document
    const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;

    if (pdf.numPages === 0) {
      return null;
    }

    // Get the first page
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2.0 }); // 2x scale for better quality

    // Create a canvas to render the page
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext("2d");

    // Render the page to the canvas
    await page.render({
      // @ts-expect-error - pdfjs types don't perfectly match node-canvas
      canvasContext: context,
      viewport,
    }).promise;

    // Convert canvas to PNG buffer
    const pngBuffer = canvas.toBuffer("image/png");

    // Clean up
    page.cleanup();
    await pdf.cleanup();
    await pdf.destroy();

    return pngBuffer;
  } catch (error) {
    console.error("Error extracting PDF cover:", error);
    return null;
  }
}
