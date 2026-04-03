import { stat, access, mkdir, writeFile } from "fs/promises";
import { createReadStream, constants } from "fs";
import { resolve, dirname } from "path";
import { lookup } from "mime-types";
import type { Context } from "hono";

const RESOURCE_CACHE_DIR = resolve(process.cwd(), "data", "resource-cache");

/**
 * Get file stats without blocking the event loop.
 * Returns null if file doesn't exist.
 */
export async function getFileStat(filePath: string) {
  try {
    await access(filePath, constants.R_OK);
    return await stat(filePath);
  } catch {
    return null;
  }
}

/**
 * Generate a weak ETag from file mtime and size.
 */
export function generateETag(mtime: Date, size: number): string {
  return `W/"${mtime.getTime().toString(36)}-${size.toString(36)}"`;
}

/**
 * Check If-None-Match header against an ETag.
 * Returns a 304 response if the ETag matches, or null if the request should proceed.
 */
export function checkConditional(c: Context, etag: string): Response | null {
  const ifNoneMatch = c.req.header("if-none-match");
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  return null;
}

/**
 * Determine content type from file extension.
 */
const CONTENT_TYPE_MAP: Record<string, string> = {
  pdf: "application/pdf",
  epub: "application/epub+zip",
  mobi: "application/x-mobipocket-ebook",
  azw3: "application/x-mobipocket-ebook",
  cbr: "application/vnd.comicbook-rar",
  cbz: "application/vnd.comicbook+zip",
  m4b: "audio/mp4",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  css: "text/css",
  js: "application/javascript",
  mjs: "application/javascript",
  xhtml: "application/xhtml+xml",
  html: "text/html",
  xml: "application/xml",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
};

export function getContentType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return CONTENT_TYPE_MAP[ext] || lookup(filePath) || "application/octet-stream";
}

const AUDIO_EXTENSIONS = new Set(["m4b", "m4a", "mp3"]);

/**
 * Stream a file as a response with proper headers.
 * Supports range requests for all file types.
 */
export async function streamFileResponse(
  c: Context,
  filePath: string,
  options: {
    contentType?: string;
    cacheControl?: string;
    disposition?: string;
  } = {},
): Promise<Response> {
  const fileStat = await getFileStat(filePath);
  if (!fileStat) {
    return new Response("Not found", { status: 404 });
  }

  const fileSize = fileStat.size;
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const contentType = options.contentType || getContentType(filePath);
  const cacheControl = options.cacheControl || "public, max-age=3600";

  // Generate ETag from file metadata
  const etag = generateETag(fileStat.mtime, fileSize);
  const conditionalResponse = checkConditional(c, etag);
  if (conditionalResponse) {
    return conditionalResponse;
  }

  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    "Accept-Ranges": "bytes",
    ETag: etag,
  };

  if (options.disposition) {
    headers["Content-Disposition"] = options.disposition;
  }

  // Handle range requests
  const rangeHeader = c.req.header("range");
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (match) {
      const start = match[1] ? parseInt(match[1], 10) : 0;
      // For audio, cap at 1MB chunks; for other files, allow larger ranges
      const isAudio = AUDIO_EXTENSIONS.has(ext);
      const maxChunk = isAudio ? 1024 * 1024 : 10 * 1024 * 1024;
      const requestedEnd = match[2] ? parseInt(match[2], 10) : start + maxChunk - 1;
      const end = Math.min(requestedEnd, fileSize - 1);

      if (start >= fileSize || start > end) {
        return new Response("Range Not Satisfiable", {
          status: 416,
          headers: { "Content-Range": `bytes */${fileSize}` },
        });
      }

      const chunkSize = end - start + 1;
      return new Response(createFileStream(filePath, start, end), {
        status: 206,
        headers: {
          ...headers,
          "Content-Length": String(chunkSize),
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        },
      });
    }
  }

  // Full file response — stream it
  headers["Content-Length"] = String(fileSize);
  return new Response(createFileStream(filePath, 0, fileSize - 1), { headers });
}

/**
 * Create a ReadableStream from a file range.
 */
function createFileStream(
  filePath: string,
  start: number,
  end: number,
): ReadableStream<Uint8Array> {
  const stream = createReadStream(filePath, { start, end });
  return new ReadableStream({
    start(controller) {
      stream.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      stream.on("end", () => {
        controller.close();
      });
      stream.on("error", (err) => {
        controller.error(err);
      });
    },
    cancel() {
      stream.destroy();
    },
  });
}

/**
 * Get cached resource path for an extracted EPUB/comic resource.
 */
function getResourceCachePath(bookId: string, resourcePath: string): string {
  // Sanitize the resource path to be filesystem-safe
  const safePath = resourcePath.replace(/\.\./g, "_").replace(/^\/+/, "");
  return resolve(RESOURCE_CACHE_DIR, bookId, safePath);
}

/**
 * Serve an extracted resource with disk caching.
 * On first request, extracts from the archive and caches to disk.
 * Subsequent requests are served directly from the disk cache.
 */
export async function serveCachedResource(
  c: Context,
  bookId: string,
  resourcePath: string,
  extractor: () => Promise<{ data: Buffer; mimeType: string } | null>,
  cacheControl: string = "public, max-age=31536000, immutable",
): Promise<Response> {
  const cachePath = getResourceCachePath(bookId, resourcePath);

  // Try serving from disk cache first
  const cachedStat = await getFileStat(cachePath);
  if (cachedStat) {
    const contentType = getContentType(cachePath);
    return streamFileResponse(c, cachePath, { contentType, cacheControl });
  }

  // Extract from archive
  const resource = await extractor();
  if (!resource) {
    return new Response("Resource not found", { status: 404 });
  }

  // Cache to disk (fire-and-forget, don't block the response)
  mkdir(dirname(cachePath), { recursive: true })
    .then(() => writeFile(cachePath, resource.data))
    .catch((err) => console.error(`[resource-cache] Failed to cache ${cachePath}:`, err));

  // Return the extracted data directly this time
  const etag = generateETag(new Date(), resource.data.length);
  return new Response(new Uint8Array(resource.data), {
    headers: {
      "Content-Type": resource.mimeType,
      "Content-Length": String(resource.data.length),
      "Cache-Control": cacheControl,
      ETag: etag,
    },
  });
}

/**
 * Invalidate the resource cache for a book (e.g., after re-upload or edit).
 */
export async function invalidateResourceCache(bookId: string): Promise<void> {
  const bookCacheDir = resolve(RESOURCE_CACHE_DIR, bookId);
  const { rm } = await import("fs/promises");
  try {
    await rm(bookCacheDir, { recursive: true, force: true });
  } catch {
    // Cache dir may not exist, that's fine
  }
}
