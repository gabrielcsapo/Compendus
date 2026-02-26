import { Hono } from "hono";
import { readFile, stat, writeFile } from "fs/promises";
import { resolve, extname } from "path";
import { eq } from "drizzle-orm";
import { getComicPage, getComicPageCount, convertCbrToCbz } from "../../app/lib/processing/comic";
import { extractEpubResource } from "../../app/lib/processing/epub";
import { convertMobiToEpub } from "../../app/lib/processing/mobi-to-epub";
import { db, books } from "../../app/lib/db";
import type { BookFormat } from "../../app/lib/types";
import {
  getFileStat,
  streamFileResponse,
  serveCachedResource,
} from "../lib/file-serving";

const app = new Hono();

// GET /books/:id/as-cbz - convert CBR to CBZ for offline iOS reading
app.get("/books/:id/as-cbz", async (c) => {
  const bookId = c.req.param("id");

  // First check if CBZ already exists (prefer native format)
  const cbzPath = resolve(process.cwd(), "data", "books", `${bookId}.cbz`);
  const cbzStat = await getFileStat(cbzPath);
  if (cbzStat) {
    return streamFileResponse(c, cbzPath, {
      contentType: "application/vnd.comicbook+zip",
      disposition: `attachment; filename="${bookId}.cbz"`,
      cacheControl: "public, max-age=3600",
    });
  }

  // Check for CBR and convert
  const cbrPath = resolve(process.cwd(), "data", "books", `${bookId}.cbr`);
  const cbrStat = await getFileStat(cbrPath);
  if (cbrStat) {
    try {
      console.log(`[as-cbz] Converting CBR to CBZ for book ${bookId}`);
      const cbrBuffer = await readFile(cbrPath);
      const cbzBuffer = await convertCbrToCbz(cbrBuffer);

      return new Response(new Uint8Array(cbzBuffer), {
        headers: {
          "Content-Type": "application/vnd.comicbook+zip",
          "Content-Disposition": `attachment; filename="${bookId}.cbz"`,
          "Content-Length": String(cbzBuffer.byteLength),
          "Cache-Control": "public, max-age=3600",
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`[as-cbz] Conversion failed for ${bookId}:`, errorMessage);

      if (errorMessage.includes("too large")) {
        return c.json({ error: errorMessage }, 413);
      }
      return c.json({ error: "Conversion failed", details: errorMessage }, 500);
    }
  }

  return new Response("Comic not found", { status: 404 });
});

// GET /books/:id/as-epub - serve converted EPUB (auto-converts MOBI/AZW3 on first request)
app.get("/books/:id/as-epub", async (c) => {
  const bookId = c.req.param("id");
  const epubPath = resolve(process.cwd(), "data", "books", `${bookId}.epub`);

  // Serve cached conversion if it exists
  const epubStat = await getFileStat(epubPath);
  if (epubStat) {
    return streamFileResponse(c, epubPath, {
      contentType: "application/epub+zip",
      disposition: `attachment; filename="${bookId}.epub"`,
      cacheControl: "public, max-age=3600",
    });
  }

  // Look up book to check if it's a convertible format
  const book = await db.query.books.findFirst({
    where: eq(books.id, bookId),
  });

  if (!book) {
    return c.json({ error: "Book not found" }, 404);
  }

  if (["mobi", "azw3"].includes(book.format)) {
    try {
      // Auto-convert MOBI/AZW3 → EPUB
      const ext = book.fileName ? extname(book.fileName) : `.${book.format}`;
      const mobiPath = resolve(process.cwd(), "data", "books", `${bookId}${ext}`);

      const mobiStat = await getFileStat(mobiPath);
      if (!mobiStat) {
        return c.json({ error: "Source file not found on disk" }, 404);
      }

      console.log(`[as-epub] Auto-converting ${book.format.toUpperCase()} → EPUB for ${bookId}`);

      const mobiBuffer = await readFile(mobiPath);
      const authors = book.authors ? JSON.parse(book.authors) : [];
      const epubBuffer = await convertMobiToEpub(mobiBuffer, {
        title: book.title ?? undefined,
        authors: Array.isArray(authors) ? authors : [],
        language: book.language ?? undefined,
      });

      // Cache the result
      await writeFile(epubPath, epubBuffer);
      const epubFileStat = await stat(epubPath);
      await db
        .update(books)
        .set({
          convertedEpubPath: `data/books/${bookId}.epub`,
          convertedEpubSize: epubFileStat.size,
        })
        .where(eq(books.id, bookId));

      console.log(`[as-epub] Conversion complete for ${bookId} (${(epubFileStat.size / 1024).toFixed(1)} KB)`);

      return new Response(new Uint8Array(epubBuffer), {
        headers: {
          "Content-Type": "application/epub+zip",
          "Content-Disposition": `attachment; filename="${bookId}.epub"`,
          "Content-Length": String(epubBuffer.byteLength),
          "Cache-Control": "public, max-age=3600",
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`[as-epub] MOBI → EPUB conversion failed for ${bookId}:`, errorMessage);
      return c.json({ error: "Conversion failed", details: errorMessage }, 500);
    }
  }

  return c.json({ error: "No converted EPUB available" }, 404);
});

// GET /books/* - serve book files with streaming and range request support
app.get("/books/:filepath{.+}", async (c) => {
  const filepath = c.req.param("filepath");
  const filePath = resolve(process.cwd(), "data", "books", filepath);

  return streamFileResponse(c, filePath, {
    cacheControl: "public, max-age=3600",
  });
});

// GET /covers/:filename - serve cover images
app.get("/covers/:filename", async (c) => {
  const filename = c.req.param("filename");
  const filePath = resolve(process.cwd(), "data", "covers", filename);

  return streamFileResponse(c, filePath, {
    contentType: "image/jpeg",
    cacheControl: "public, max-age=31536000, immutable",
  });
});

// GET /mobi-images/* - serve MOBI extracted images
app.get("/mobi-images/:rest{.+}", async (c) => {
  const rest = c.req.param("rest");
  const pathParts = rest.split("/");
  let filePath: string;

  if (pathParts.length >= 2) {
    const [bookId, ...restParts] = pathParts;
    const filename = restParts.join("/");
    filePath = resolve(process.cwd(), "images", bookId, filename);
  } else {
    filePath = resolve(process.cwd(), "images", pathParts[0]);
  }

  return streamFileResponse(c, filePath, {
    cacheControl: "public, max-age=86400",
  });
});

// GET /comic/:id/:format/page/:pageNum - serve comic book pages with disk caching
app.get("/comic/:id/:format/page/:pageNum", async (c) => {
  const bookId = c.req.param("id");
  const format = c.req.param("format");
  const pageNum = parseInt(c.req.param("pageNum"), 10);
  const bookPath = resolve(process.cwd(), "data", "books", `${bookId}.${format}`);

  const bookStat = await getFileStat(bookPath);
  if (!bookStat) {
    return new Response("Page not found", { status: 404 });
  }

  // Use resource caching — extract once, serve from disk thereafter
  const resourcePath = `page-${pageNum}.bin`;
  return serveCachedResource(
    c,
    `comic-${bookId}-${format}`,
    resourcePath,
    async () => {
      try {
        const buffer = await readFile(bookPath);
        const page = await getComicPage(buffer, format as BookFormat, pageNum);
        if (!page) return null;
        return { data: Buffer.from(page.data), mimeType: page.mimeType };
      } catch (error) {
        console.error("Error extracting comic page:", error);
        return null;
      }
    },
    "public, max-age=31536000, immutable",
  );
});

// GET /comic/:id/:format/info - get comic book page count
app.get("/comic/:id/:format/info", async (c) => {
  const bookId = c.req.param("id");
  const format = c.req.param("format");
  const bookPath = resolve(process.cwd(), "data", "books", `${bookId}.${format}`);

  const bookStat = await getFileStat(bookPath);
  if (!bookStat) {
    return new Response("Comic not found", { status: 404 });
  }

  try {
    const buffer = await readFile(bookPath);
    const pageCount = await getComicPageCount(buffer, format as BookFormat);
    return c.json({ pageCount });
  } catch (error) {
    console.error("Error getting comic info:", error);
    return new Response("Comic not found", { status: 404 });
  }
});

// GET /book/:id/* - serve EPUB internal resources with disk caching
// Uses middleware pattern (next) so React page routes fall through to the flight router
app.get("/book/:id/:rest{.+}", async (c, next) => {
  const bookId = c.req.param("id");
  const resourcePath = c.req.param("rest");

  // Let React page routes fall through to the flight router
  if (resourcePath === "read" || resourcePath === "edit") {
    return next();
  }

  const bookPath = resolve(process.cwd(), "data", "books", `${bookId}.epub`);
  const bookStat = await getFileStat(bookPath);
  if (!bookStat) {
    return new Response("Resource not found", { status: 404 });
  }

  // Use resource caching — extract once from ZIP, serve from disk thereafter
  return serveCachedResource(
    c,
    `epub-${bookId}`,
    resourcePath,
    async () => {
      try {
        const buffer = await readFile(bookPath);
        return await extractEpubResource(buffer, resourcePath);
      } catch (error) {
        console.error("Error extracting EPUB resource:", error);
        return null;
      }
    },
    "public, max-age=31536000, immutable",
  );
});

export { app as assetsRoutes };
