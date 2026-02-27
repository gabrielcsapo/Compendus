/**
 * Worker thread for CPU-intensive book processing tasks
 * Handles metadata extraction, cover extraction, and CBR→CBZ conversion
 * in a separate thread to keep the main event loop responsive.
 *
 * All database operations and filesystem storage happen on the main thread.
 * This worker only performs CPU-bound transformations and returns results.
 */
import { parentPort } from "worker_threads";
import type { BookFormat, BookMetadata } from "../types";

// Lazy imports to avoid loading heavy modules until needed
let _extractPdfMetadata: typeof import("./pdf").extractPdfMetadata;
let _extractEpubMetadata: typeof import("./epub").extractEpubMetadata;
let _extractMobiMetadata: typeof import("./mobi").extractMobiMetadata;
let _extractAudioMetadata: typeof import("./audio").extractAudioMetadata;
let _extractCover: typeof import("./cover").extractCover;
let _convertCbrToCbz: typeof import("./comic").convertCbrToCbz;

async function getExtractPdfMetadata() {
  if (!_extractPdfMetadata) {
    _extractPdfMetadata = (await import("./pdf")).extractPdfMetadata;
  }
  return _extractPdfMetadata;
}

async function getExtractEpubMetadata() {
  if (!_extractEpubMetadata) {
    _extractEpubMetadata = (await import("./epub")).extractEpubMetadata;
  }
  return _extractEpubMetadata;
}

async function getExtractMobiMetadata() {
  if (!_extractMobiMetadata) {
    _extractMobiMetadata = (await import("./mobi")).extractMobiMetadata;
  }
  return _extractMobiMetadata;
}

async function getExtractAudioMetadata() {
  if (!_extractAudioMetadata) {
    _extractAudioMetadata = (await import("./audio")).extractAudioMetadata;
  }
  return _extractAudioMetadata;
}

async function getExtractCover() {
  if (!_extractCover) {
    _extractCover = (await import("./cover")).extractCover;
  }
  return _extractCover;
}

async function getConvertCbrToCbz() {
  if (!_convertCbrToCbz) {
    _convertCbrToCbz = (await import("./comic")).convertCbrToCbz;
  }
  return _convertCbrToCbz;
}

export type WorkerTaskType = "extractMetadata" | "extractCover" | "convertCbrToCbz";

export interface WorkerTask {
  id: string;
  type: WorkerTaskType;
  buffer: Buffer;
  format: BookFormat;
}

export interface WorkerResult {
  id: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

async function extractMetadata(
  buffer: Buffer,
  format: BookFormat,
): Promise<BookMetadata> {
  switch (format) {
    case "pdf":
      return (await getExtractPdfMetadata())(buffer);
    case "epub":
      return (await getExtractEpubMetadata())(buffer);
    case "mobi":
    case "azw3":
      return (await getExtractMobiMetadata())(buffer);
    case "cbr":
    case "cbz":
      return { title: null, authors: [] };
    case "m4b":
    case "m4a":
    case "mp3":
      return (await getExtractAudioMetadata())(buffer);
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

async function handleTask(task: WorkerTask): Promise<unknown> {
  // Ensure buffer is a proper Buffer (serialization may convert to Uint8Array)
  const buffer = Buffer.isBuffer(task.buffer)
    ? task.buffer
    : Buffer.from(task.buffer);

  switch (task.type) {
    case "extractMetadata":
      return extractMetadata(buffer, task.format);

    case "extractCover": {
      const extract = await getExtractCover();
      const result = await extract(buffer, task.format);
      if (!result) return null;
      // Serialize CoverResult: convert Buffer to Uint8Array for transfer
      return {
        buffer: new Uint8Array(result.buffer),
        thumbnail: new Uint8Array(result.thumbnail),
        mimeType: result.mimeType,
        dominantColor: result.dominantColor,
      };
    }

    case "convertCbrToCbz": {
      const convert = await getConvertCbrToCbz();
      const cbzBuffer = await convert(buffer);
      // Return as Uint8Array for transfer
      return new Uint8Array(cbzBuffer);
    }

    default:
      throw new Error(`Unknown task type: ${(task as WorkerTask).type}`);
  }
}

if (parentPort) {
  parentPort.on("message", async (task: WorkerTask) => {
    const startTime = performance.now();
    try {
      const result = await handleTask(task);
      const duration = ((performance.now() - startTime) / 1000).toFixed(2);
      console.log(`[Processing Worker] ${task.type} completed in ${duration}s`);
      parentPort!.postMessage({ id: task.id, success: true, result });
    } catch (error) {
      const duration = ((performance.now() - startTime) / 1000).toFixed(2);
      console.error(`[Processing Worker] ${task.type} failed after ${duration}s:`, error);
      parentPort!.postMessage({
        id: task.id,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
}
