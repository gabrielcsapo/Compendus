import { Hono } from "hono";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { eq } from "drizzle-orm";
import { extractEpubResource } from "../../app/lib/processing/epub";
import { getBookFilePath, resolveStoragePath } from "../../app/lib/storage";
import { renderPdfPage } from "../../app/lib/reader/pdf-renderer";
import { db, books } from "../../app/lib/db";
import { getFileStat, serveCachedResource, generateETag } from "../lib/file-serving";

const app = new Hono();

// GET /api/reader/:bookId/pdf-page/:pageNum - Render PDF page as image
app.get("/api/reader/:bookId/pdf-page/:pageNum", async (c) => {
  try {
    const bookId = c.req.param("bookId");
    const pageNumber = parseInt(c.req.param("pageNum"), 10);
    const scale = parseFloat(c.req.query("scale") || "2.0");

    // Get book to find the file
    const book = await db.query.books.findFirst({
      where: eq(books.id, bookId),
    });

    if (!book || book.format !== "pdf") {
      return new Response("PDF not found", { status: 404 });
    }

    // Read PDF file
    const pdfPath = resolve("data", "books", `${bookId}.pdf`);
    const pdfStat = await getFileStat(pdfPath);
    if (!pdfStat) {
      return new Response("PDF file not found", { status: 404 });
    }

    const buffer = await readFile(pdfPath);
    const pngBuffer = await renderPdfPage(buffer, bookId, pageNumber, scale);

    const etag = generateETag(new Date(), pngBuffer.length);
    return new Response(new Uint8Array(pngBuffer), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(pngBuffer.length),
        "Cache-Control": "public, max-age=31536000, immutable",
        ETag: etag,
      },
    });
  } catch (error) {
    console.error("PDF page render error:", error);
    return new Response("Failed to render PDF page", { status: 500 });
  }
});

// GET /api/reader/:bookId/resource/* - Serve embedded resources from EPUB files
app.get("/api/reader/:bookId/resource/*", async (c) => {
  try {
    const bookId = c.req.param("bookId");
    const resourcePath = decodeURIComponent(c.req.path.replace(`/api/reader/${bookId}/resource/`, ""));

    // Get book to find the file
    const book = await db.query.books.findFirst({
      where: eq(books.id, bookId),
    });

    if (!book) {
      return new Response("Not found", { status: 404 });
    }

    // Determine the EPUB file path — prefer convertedEpubPath (matches editor logic)
    let filePath: string;
    if (book.convertedEpubPath) {
      filePath = resolveStoragePath(book.convertedEpubPath);
    } else if (book.format === "epub") {
      filePath = getBookFilePath(bookId, "epub");
    } else {
      return new Response("Not found", { status: 404 });
    }

    const epubStat = await getFileStat(filePath);
    if (!epubStat) {
      return new Response("Not found", { status: 404 });
    }

    // Use resource caching — extract once from ZIP, serve from disk thereafter
    return serveCachedResource(
      c,
      `epub-reader-${bookId}`,
      resourcePath,
      async () => {
        const buffer = await readFile(filePath);
        return await extractEpubResource(buffer, resourcePath);
      },
      "public, max-age=86400",
    );
  } catch (error) {
    console.error("EPUB resource error:", error);
    return new Response("Error loading resource", { status: 500 });
  }
});

export { app as readerRoutes };
