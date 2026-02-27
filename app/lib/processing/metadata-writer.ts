import { readFile, writeFile, rename, unlink } from "fs/promises";
import { dirname, join } from "path";
import { randomBytes } from "crypto";
import type { BookFormat } from "../types";
import NodeID3Module from "node-id3";

/**
 * Atomically replace a file by writing to a temp file in the same directory
 * and then renaming. This ensures the original file is never deleted without
 * a valid replacement ready, preventing data loss on crash or disk errors.
 *
 * @param targetPath - The file to replace
 * @param content - The new content (Buffer)
 */
async function safeWriteFile(targetPath: string, content: Buffer): Promise<void> {
  const dir = dirname(targetPath);
  const tempPath = join(dir, `.compendus-tmp-${randomBytes(8).toString("hex")}`);
  try {
    await writeFile(tempPath, content);
    await rename(tempPath, targetPath);
  } catch (error) {
    try { await unlink(tempPath); } catch {}
    throw error;
  }
}

/**
 * Atomically replace a file with a temp file that was produced by an external
 * process (e.g. ffmpeg). The temp file must be on the same filesystem as the
 * target for atomic rename. Returns a path to use as the temp output target.
 *
 * @param targetPath - The file to replace
 * @returns tempPath to pass to the external process as output
 */
function getTempPathForAtomic(targetPath: string): string {
  const dir = dirname(targetPath);
  const suffix = randomBytes(8).toString("hex");
  return join(dir, `.compendus-tmp-${suffix}`);
}

/**
 * Atomically replace targetPath with tempPath via rename.
 * On failure, cleans up tempPath and throws.
 */
async function atomicReplace(tempPath: string, targetPath: string): Promise<void> {
  try {
    await rename(tempPath, targetPath);
  } catch (error) {
    try { await unlink(tempPath); } catch {}
    throw error;
  }
}
/**
 * Metadata fields that can be written to book files
 */
interface WritableMetadata {
  title: string;
  authors: string[];
  publisher?: string | null;
  description?: string | null;
  isbn?: string | null;
  language?: string | null;
  series?: string | null;
  seriesNumber?: string | null;
  publishedDate?: string | null;
  coverImage?: Buffer | null;
  coverMimeType?: string; // Default: "image/jpeg"
}

/**
 * Result of a metadata write operation
 */
interface MetadataWriteResult {
  success: boolean;
  error?: string;
  format: BookFormat;
  coverEmbedded?: boolean;
}

/**
 * Write metadata to a book file.
 * This modifies the file in-place. Errors are logged but don't throw.
 *
 * @param filePath - Absolute path to the book file
 * @param format - Book format (epub, pdf, etc.)
 * @param metadata - Metadata to write
 * @returns Result indicating success or failure
 */
export async function writeMetadataToFile(
  filePath: string,
  format: BookFormat,
  metadata: WritableMetadata,
): Promise<MetadataWriteResult> {
  try {
    switch (format) {
      case "epub":
        return await writeEpubMetadata(filePath, metadata);
      case "pdf":
        return await writePdfMetadata(filePath, metadata);
      case "mp3":
        return await writeMp3Metadata(filePath, metadata);
      case "m4b":
      case "m4a":
        return await writeM4Metadata(filePath, format, metadata);
      default:
        // Unsupported format - not an error, just skip
        return {
          success: true,
          format,
          error: `Format ${format} does not support embedded metadata writing`,
        };
    }
  } catch (error) {
    return {
      success: false,
      format,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Write metadata to an EPUB file by modifying the OPF package document.
 */
async function writeEpubMetadata(
  filePath: string,
  metadata: WritableMetadata,
): Promise<MetadataWriteResult> {
  // Step 1: Read the EPUB file
  const buffer = await readFile(filePath);
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  // Step 2: Find the OPF file path from container.xml
  const containerXml = await zip
    .file("META-INF/container.xml")
    ?.async("string");
  if (!containerXml) {
    return {
      success: false,
      format: "epub",
      error: "Invalid EPUB: missing container.xml",
    };
  }

  // Parse container.xml to find rootfile path
  const rootfileMatch = containerXml.match(/full-path="([^"]+)"/);
  if (!rootfileMatch) {
    return {
      success: false,
      format: "epub",
      error: "Invalid EPUB: cannot find OPF path",
    };
  }
  const opfPath = rootfileMatch[1];

  // Step 3: Read and parse the OPF file
  const opfContent = await zip.file(opfPath)?.async("string");
  if (!opfContent) {
    return {
      success: false,
      format: "epub",
      error: `Invalid EPUB: missing OPF at ${opfPath}`,
    };
  }

  // Step 4: Update metadata in OPF
  let updatedOpf = updateOpfMetadata(opfContent, metadata);

  // Step 5: Embed cover if provided
  let coverEmbedded = false;
  if (metadata.coverImage) {
    // Determine the directory where OPF lives to place cover alongside it
    const opfDir = opfPath.includes("/")
      ? opfPath.substring(0, opfPath.lastIndexOf("/"))
      : "";
    const coverFileName = "cover.jpg";
    const coverPath = opfDir ? `${opfDir}/${coverFileName}` : coverFileName;

    // Add cover image to ZIP
    zip.file(coverPath, metadata.coverImage);

    // Update OPF: add manifest item and meta cover element
    updatedOpf = addCoverToOpf(updatedOpf, coverFileName);
    coverEmbedded = true;
  }

  // Step 6: Write the updated OPF back to the ZIP
  zip.file(opfPath, updatedOpf);

  // Step 7: Generate and save the modified EPUB
  const newBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });

  await safeWriteFile(filePath, newBuffer);

  return { success: true, format: "epub", coverEmbedded };
}

/**
 * Add cover image reference to OPF manifest and metadata.
 */
function addCoverToOpf(opfContent: string, coverFileName: string): string {
  let result = opfContent;

  // Remove any existing cover-image manifest item
  result = result.replace(
    /<item[^>]*id=["']cover-image["'][^>]*(?:\/>|>[^<]*<\/item>)\s*/gi,
    "",
  );

  // Remove any existing cover meta element
  result = result.replace(/<meta\s+name=["']cover["'][^>]*\/>\s*/gi, "");

  // Add manifest item before </manifest>
  const manifestEnd = result.match(/<\/manifest>/i);
  if (manifestEnd && manifestEnd.index !== undefined) {
    const manifestItem = `    <item id="cover-image" href="${escapeXml(coverFileName)}" media-type="image/jpeg"/>\n  `;
    result =
      result.slice(0, manifestEnd.index) +
      manifestItem +
      result.slice(manifestEnd.index);
  }

  // Add meta cover element before </metadata>
  const metadataEnd = result.match(/<\/(?:opf:)?metadata>/i);
  if (metadataEnd && metadataEnd.index !== undefined) {
    const metaElement = `    <meta name="cover" content="cover-image"/>\n  `;
    result =
      result.slice(0, metadataEnd.index) +
      metaElement +
      result.slice(metadataEnd.index);
  }

  return result;
}

/**
 * Update Dublin Core metadata elements in OPF XML content.
 * Uses regex-based manipulation to avoid XML parser dependency.
 */
function updateOpfMetadata(
  opfContent: string,
  metadata: WritableMetadata,
): string {
  let result = opfContent;

  // Update title
  result = updateDcElement(result, "title", metadata.title);

  // Update creators (authors) - remove existing and add new
  if (metadata.authors.length > 0) {
    // Remove existing dc:creator elements
    result = result.replace(
      /<(?:dc:)?creator[^>]*>[^<]*<\/(?:dc:)?creator>\s*/gi,
      "",
    );

    // Add new creator elements before </metadata>
    const metadataEnd = result.match(/<\/(?:opf:)?metadata>/i);
    if (metadataEnd && metadataEnd.index !== undefined) {
      const creators = metadata.authors
        .map((author) => `    <dc:creator>${escapeXml(author)}</dc:creator>`)
        .join("\n");
      result =
        result.slice(0, metadataEnd.index) +
        creators +
        "\n  " +
        result.slice(metadataEnd.index);
    }
  }

  // Update other DC elements
  result = updateDcElement(result, "publisher", metadata.publisher);
  result = updateDcElement(result, "description", metadata.description);
  result = updateDcElement(result, "language", metadata.language);
  result = updateDcElement(result, "date", metadata.publishedDate);

  // Handle ISBN as dc:identifier with scheme
  if (metadata.isbn) {
    // Remove existing ISBN identifiers
    result = result.replace(
      /<(?:dc:)?identifier[^>]*(?:scheme|opf:scheme)="ISBN"[^>]*>[^<]*<\/(?:dc:)?identifier>\s*/gi,
      "",
    );

    const newIsbn = `    <dc:identifier opf:scheme="ISBN">${escapeXml(metadata.isbn)}</dc:identifier>`;
    const metadataEnd = result.match(/<\/(?:opf:)?metadata>/i);
    if (metadataEnd && metadataEnd.index !== undefined) {
      result =
        result.slice(0, metadataEnd.index) +
        newIsbn +
        "\n  " +
        result.slice(metadataEnd.index);
    }
  }

  // Handle series metadata using calibre-style meta elements
  if (metadata.series) {
    // Remove existing calibre series meta
    result = result.replace(/<meta\s+name="calibre:series"[^>]*\/>\s*/gi, "");
    result = result.replace(
      /<meta\s+name="calibre:series_index"[^>]*\/>\s*/gi,
      "",
    );

    const metadataEnd = result.match(/<\/(?:opf:)?metadata>/i);
    if (metadataEnd && metadataEnd.index !== undefined) {
      let seriesMeta = `    <meta name="calibre:series" content="${escapeXml(metadata.series)}" />`;
      if (metadata.seriesNumber) {
        seriesMeta += `\n    <meta name="calibre:series_index" content="${escapeXml(metadata.seriesNumber)}" />`;
      }
      result =
        result.slice(0, metadataEnd.index) +
        seriesMeta +
        "\n  " +
        result.slice(metadataEnd.index);
    }
  }

  return result;
}

/**
 * Update or insert a Dublin Core element in OPF content.
 */
function updateDcElement(
  content: string,
  element: string,
  value: string | null | undefined,
): string {
  if (!value) return content;

  const escaped = escapeXml(value);

  // Pattern to match existing element (handles namespace prefix)
  const pattern = new RegExp(
    `(<(?:dc:)?${element}[^>]*>)[^<]*(</(?:dc:)?${element}>)`,
    "i",
  );

  if (pattern.test(content)) {
    // Replace existing element content
    return content.replace(pattern, `$1${escaped}$2`);
  }

  // Insert new element in metadata section
  const metadataEnd = content.match(/<\/(?:opf:)?metadata>/i);
  if (metadataEnd && metadataEnd.index !== undefined) {
    const newElement = `    <dc:${element}>${escaped}</dc:${element}>\n  `;
    return (
      content.slice(0, metadataEnd.index) +
      newElement +
      content.slice(metadataEnd.index)
    );
  }

  return content;
}

/**
 * Escape XML special characters.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Write metadata to a PDF file using pdf-lib.
 */
async function writePdfMetadata(
  filePath: string,
  metadata: WritableMetadata,
): Promise<MetadataWriteResult> {
  const { PDFDocument } = await import("pdf-lib");

  // Step 1: Read and load the PDF
  const buffer = await readFile(filePath);
  const pdfDoc = await PDFDocument.load(buffer, {
    updateMetadata: false,
  });

  // Step 2: Update document info dictionary
  pdfDoc.setTitle(metadata.title);

  if (metadata.authors.length > 0) {
    pdfDoc.setAuthor(metadata.authors.join(", "));
  }

  if (metadata.description) {
    pdfDoc.setSubject(metadata.description);
  }

  // Build keywords from publisher, ISBN, series, language
  const keywords: string[] = [];
  if (metadata.publisher) keywords.push(`Publisher: ${metadata.publisher}`);
  if (metadata.isbn) keywords.push(`ISBN: ${metadata.isbn}`);
  if (metadata.series) {
    keywords.push(`Series: ${metadata.series}`);
    if (metadata.seriesNumber) {
      keywords.push(`Book ${metadata.seriesNumber}`);
    }
  }
  if (metadata.language) keywords.push(`Language: ${metadata.language}`);

  if (keywords.length > 0) {
    pdfDoc.setKeywords(keywords);
  }

  // Set creator to indicate metadata was updated by Compendus
  pdfDoc.setCreator("Compendus");

  // Step 3: Save the modified PDF (atomic write to prevent corruption)
  const newBuffer = await pdfDoc.save();
  await safeWriteFile(filePath, Buffer.from(newBuffer));

  return { success: true, format: "pdf" };
}

// Threshold for using ffmpeg instead of in-memory node-id3 (100MB)
const MP3_FFMPEG_THRESHOLD = 100 * 1024 * 1024;

/**
 * Write metadata to an MP3 file using ID3 tags.
 * For large files (>100MB), uses ffmpeg to avoid loading the entire file into memory.
 * For small files, uses node-id3 for richer ID3v2 tag support.
 */
async function writeMp3Metadata(
  filePath: string,
  metadata: WritableMetadata,
): Promise<MetadataWriteResult> {
  const { stat } = await import("fs/promises");
  const fileStat = await stat(filePath);

  // For large files, use ffmpeg (same approach as M4B) to avoid OOM
  if (fileStat.size > MP3_FFMPEG_THRESHOLD) {
    return writeMp3MetadataWithFfmpeg(filePath, metadata);
  }

  // Build ID3 tags object
  const tags: NodeID3Module.Tags = {
    title: metadata.title,
    artist: metadata.authors.join(", "),
  };

  // Add optional fields
  if (metadata.publisher) {
    tags.publisher = metadata.publisher;
  }

  if (metadata.description) {
    // Use comment frame for description
    tags.comment = {
      language: metadata.language || "eng",
      text: metadata.description,
    };
  }

  if (metadata.series) {
    // Use content group for series name
    tags.contentGroup = metadata.series;
    if (metadata.seriesNumber) {
      // Use track number for series position (audiobook convention)
      tags.trackNumber = metadata.seriesNumber;
    }
  }

  if (metadata.publishedDate) {
    // Extract year from date string
    const year = metadata.publishedDate.match(/\d{4}/)?.[0];
    if (year) {
      tags.year = year;
    }
  }

  // Add cover image using APIC frame
  let coverEmbedded = false;
  if (metadata.coverImage) {
    tags.image = {
      mime: metadata.coverMimeType || "image/jpeg",
      type: {
        id: 3, // Front cover
        name: "front cover",
      },
      description: "Cover",
      imageBuffer: metadata.coverImage,
    };
    coverEmbedded = true;
  }

  // Use async file I/O to avoid blocking the event loop.
  // node-id3's update(tags, filePath) is synchronous and blocks on large files.
  const fileBuffer = await readFile(filePath);
  const result = NodeID3Module.update(tags, fileBuffer);

  if (result instanceof Buffer) {
    await safeWriteFile(filePath, result);
    return { success: true, format: "mp3", coverEmbedded };
  }

  return {
    success: false,
    format: "mp3",
    error:
      result instanceof Error ? result.message : "Failed to write ID3 tags",
  };
}

/**
 * Write MP3 metadata using ffmpeg (for large files that can't be loaded into memory).
 * Uses stream copy to avoid re-encoding.
 */
async function writeMp3MetadataWithFfmpeg(
  filePath: string,
  metadata: WritableMetadata,
): Promise<MetadataWriteResult> {
  const { spawn } = await import("child_process");
  const { tmpdir } = await import("os");

  // Check if ffmpeg is available
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
      proc.on("close", (code) => (code === 0 ? resolve() : reject()));
      proc.on("error", reject);
    });
  } catch {
    return {
      success: true,
      format: "mp3",
      error: "ffmpeg not installed - skipping MP3 metadata update for large file",
    };
  }

  const metadataArgs: string[] = [];
  metadataArgs.push("-metadata", `title=${metadata.title}`);

  if (metadata.authors.length > 0) {
    metadataArgs.push("-metadata", `artist=${metadata.authors.join(", ")}`);
    metadataArgs.push("-metadata", `album_artist=${metadata.authors[0]}`);
  }

  if (metadata.publisher) {
    metadataArgs.push("-metadata", `publisher=${metadata.publisher}`);
  }

  if (metadata.description) {
    metadataArgs.push("-metadata", `comment=${metadata.description}`);
  }

  if (metadata.series) {
    metadataArgs.push("-metadata", `album=${metadata.series}`);
    if (metadata.seriesNumber) {
      metadataArgs.push("-metadata", `track=${metadata.seriesNumber}`);
    }
  }

  if (metadata.publishedDate) {
    const year = metadata.publishedDate.match(/\d{4}/)?.[0];
    if (year) {
      metadataArgs.push("-metadata", `date=${year}`);
    }
  }

  // Temp file in same directory as original for atomic rename (same filesystem)
  const tempPath = getTempPathForAtomic(filePath);
  let coverTempPath: string | null = null;
  let coverEmbedded = false;

  if (metadata.coverImage) {
    coverTempPath = join(tmpdir(), `compendus-cover-${Date.now()}.jpg`);
    await writeFile(coverTempPath, metadata.coverImage);
  }

  try {
    let ffmpegArgs: string[];
    if (coverTempPath) {
      ffmpegArgs = [
        "-i", filePath,
        "-i", coverTempPath,
        "-map", "0:a",
        "-map", "1:v",
        "-c:a", "copy",
        "-c:v", "mjpeg",
        "-id3v2_version", "3",
        "-disposition:v:0", "attached_pic",
        ...metadataArgs,
        "-y", tempPath,
      ];
      coverEmbedded = true;
    } else {
      ffmpegArgs = [
        "-i", filePath,
        "-c", "copy",
        "-id3v2_version", "3",
        ...metadataArgs,
        "-y", tempPath,
      ];
    }

    await new Promise<void>((resolve, reject) => {
      const proc = spawn("ffmpeg", ffmpegArgs, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
        if (stderr.length > 1024) {
          stderr = stderr.slice(-1024);
        }
      });
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
      });
      proc.on("error", reject);
    });

    // Atomically replace original — no delete-then-rename race condition
    await atomicReplace(tempPath, filePath);

    return { success: true, format: "mp3", coverEmbedded };
  } catch (error) {
    try { await unlink(tempPath); } catch {}
    return {
      success: false,
      format: "mp3",
      error: error instanceof Error ? error.message : "Failed to write MP3 metadata with ffmpeg",
    };
  } finally {
    if (coverTempPath) {
      try { await unlink(coverTempPath); } catch {}
    }
  }
}

/**
 * Write metadata to M4B/M4A files using iTunes-style atoms.
 * Uses ffmpeg for reliable metadata writing.
 */
async function writeM4Metadata(
  filePath: string,
  format: "m4b" | "m4a",
  metadata: WritableMetadata,
): Promise<MetadataWriteResult> {
  const { spawn } = await import("child_process");
  const { tmpdir } = await import("os");

  // Check if ffmpeg is available
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
      proc.on("close", (code) => (code === 0 ? resolve() : reject()));
      proc.on("error", reject);
    });
  } catch {
    return {
      success: true,
      format,
      error: "ffmpeg not installed - skipping M4B/M4A metadata update",
    };
  }

  // Build metadata arguments for ffmpeg
  const metadataArgs: string[] = [];

  metadataArgs.push("-metadata", `title=${metadata.title}`);

  if (metadata.authors.length > 0) {
    metadataArgs.push("-metadata", `artist=${metadata.authors.join(", ")}`);
    metadataArgs.push("-metadata", `album_artist=${metadata.authors[0]}`);
  }

  if (metadata.publisher) {
    metadataArgs.push("-metadata", `publisher=${metadata.publisher}`);
  }

  if (metadata.description) {
    metadataArgs.push("-metadata", `description=${metadata.description}`);
    metadataArgs.push("-metadata", `comment=${metadata.description}`);
  }

  if (metadata.series) {
    metadataArgs.push("-metadata", `album=${metadata.series}`);
    if (metadata.seriesNumber) {
      metadataArgs.push("-metadata", `track=${metadata.seriesNumber}`);
    }
  }

  if (metadata.publishedDate) {
    const year = metadata.publishedDate.match(/\d{4}/)?.[0];
    if (year) {
      metadataArgs.push("-metadata", `date=${year}`);
    }
  }

  // Temp file in same directory as original for atomic rename (same filesystem)
  const tempPath = getTempPathForAtomic(filePath);
  let coverTempPath: string | null = null;
  let coverEmbedded = false;

  // Write cover to temp file if provided (can use system tmpdir since it's ephemeral)
  if (metadata.coverImage) {
    coverTempPath = join(tmpdir(), `compendus-cover-${Date.now()}.jpg`);
    await writeFile(coverTempPath, metadata.coverImage);
  }

  try {
    // Build ffmpeg args array (using spawn avoids shell escaping issues and memory buffering)
    let ffmpegArgs: string[];
    if (coverTempPath) {
      // With cover: map audio from input 0, video (cover) from input 1
      ffmpegArgs = [
        "-i", filePath,
        "-i", coverTempPath,
        "-map", "0:a",
        "-map", "1:v",
        "-c:a", "copy",
        "-c:v", "mjpeg",
        "-disposition:v:0", "attached_pic",
        ...metadataArgs,
        "-y", tempPath,
      ];
      coverEmbedded = true;
    } else {
      // Without cover: just copy all streams
      ffmpegArgs = [
        "-i", filePath,
        "-c", "copy",
        ...metadataArgs,
        "-y", tempPath,
      ];
    }

    // Use spawn instead of exec to avoid buffering all output in memory
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("ffmpeg", ffmpegArgs, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
        // Only keep last 1KB of stderr for error reporting
        if (stderr.length > 1024) {
          stderr = stderr.slice(-1024);
        }
      });
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
      });
      proc.on("error", reject);
    });

    // Atomically replace original — no delete-then-rename race condition
    await atomicReplace(tempPath, filePath);

    return { success: true, format, coverEmbedded };
  } catch (error) {
    // Clean up temp file if it exists
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }

    return {
      success: false,
      format,
      error:
        error instanceof Error
          ? error.message
          : "Failed to write M4B/M4A metadata",
    };
  } finally {
    // Clean up cover temp file
    if (coverTempPath) {
      try {
        await unlink(coverTempPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
