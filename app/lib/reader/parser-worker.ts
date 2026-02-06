/**
 * Worker thread for CPU-intensive book parsing
 * Runs parsing in a separate thread to avoid blocking the main event loop
 */
import { parentPort, workerData } from "worker_threads";
import type { NormalizedContent } from "./types";
import type { BookFormat } from "../types";

// Static imports so esbuild can bundle them
import { parseEpub } from "./parsers/epub";
import { parsePdf } from "./parsers/pdf";
import { parseMobi } from "./parsers/mobi";
import { parseComic } from "./parsers/comic";

interface ParseRequest {
  buffer: Buffer;
  format: BookFormat;
  bookId: string;
}

async function parseBook(request: ParseRequest): Promise<NormalizedContent> {
  const { buffer, format, bookId } = request;
  const startTime = performance.now();
  const fileSizeMB = (buffer.length / 1024 / 1024).toFixed(1);

  console.log(
    `[Parser Worker] Starting ${format} parse for ${bookId} (${fileSizeMB}MB)`,
  );

  let result: NormalizedContent;

  switch (format) {
    case "epub": {
      result = await parseEpub(buffer, bookId);
      break;
    }
    case "pdf": {
      result = await parsePdf(buffer, bookId);
      break;
    }
    case "mobi":
    case "azw3": {
      result = await parseMobi(buffer, bookId, format);
      break;
    }
    case "cbr":
    case "cbz": {
      result = await parseComic(buffer, bookId, format);
      break;
    }
    default:
      throw new Error(`Unsupported format: ${format}`);
  }

  const duration = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(
    `[Parser Worker] Completed ${format} parse for ${bookId} in ${duration}s`,
  );

  return result;
}

// Handle messages from main thread
if (parentPort) {
  parentPort.on("message", async (request: ParseRequest) => {
    try {
      const result = await parseBook(request);
      parentPort!.postMessage({ success: true, content: result });
    } catch (error) {
      parentPort!.postMessage({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
}

// Also support being called with workerData for one-shot parsing
if (workerData) {
  parseBook(workerData as ParseRequest)
    .then((result) => {
      parentPort?.postMessage({ success: true, content: result });
    })
    .catch((error) => {
      parentPort?.postMessage({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    });
}
