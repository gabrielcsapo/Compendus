import { Hono } from "hono";
import { readFile, open } from "fs/promises";
import { resolve, extname } from "path";
import { existsSync, statSync, createReadStream, writeFileSync } from "fs";
import { eq } from "drizzle-orm";
import { getComicPage, getComicPageCount, convertCbrToCbz } from "../../app/lib/processing/comic";
import { extractEpubResource } from "../../app/lib/processing/epub";
import { convertMobiToEpub } from "../../app/lib/processing/mobi-to-epub";
import { db, books } from "../../app/lib/db";
import type { BookFormat } from "../../app/lib/types";

const app = new Hono();

// GET /books/:id/as-cbz - convert CBR to CBZ for offline iOS reading
app.get("/books/:id/as-cbz", async (c) => {
  const bookId = c.req.param("id");

  // First check if CBZ already exists (prefer native format)
  const cbzPath = resolve(process.cwd(), "data", "books", `${bookId}.cbz`);
  if (existsSync(cbzPath)) {
    const buffer = await readFile(cbzPath);
    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.comicbook+zip",
        "Content-Disposition": `attachment; filename="${bookId}.cbz"`,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  // Check for CBR and convert
  const cbrPath = resolve(process.cwd(), "data", "books", `${bookId}.cbr`);
  if (existsSync(cbrPath)) {
    try {
      console.log(`[as-cbz] Converting CBR to CBZ for book ${bookId}`);
      const cbrBuffer = await readFile(cbrPath);
      const cbzBuffer = await convertCbrToCbz(cbrBuffer);

      return new Response(new Uint8Array(cbzBuffer), {
        headers: {
          "Content-Type": "application/vnd.comicbook+zip",
          "Content-Disposition": `attachment; filename="${bookId}.cbz"`,
          "Access-Control-Allow-Origin": "*",
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
  if (existsSync(epubPath)) {
    const buffer = await readFile(epubPath);
    return new Response(buffer, {
      headers: {
        "Content-Type": "application/epub+zip",
        "Content-Disposition": `attachment; filename="${bookId}.epub"`,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
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

      if (!existsSync(mobiPath)) {
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
      writeFileSync(epubPath, epubBuffer);
      const epubSize = statSync(epubPath).size;
      await db
        .update(books)
        .set({
          convertedEpubPath: `data/books/${bookId}.epub`,
          convertedEpubSize: epubSize,
        })
        .where(eq(books.id, bookId));

      console.log(`[as-epub] Conversion complete for ${bookId} (${(epubSize / 1024).toFixed(1)} KB)`);

      return new Response(new Uint8Array(epubBuffer), {
        headers: {
          "Content-Type": "application/epub+zip",
          "Content-Disposition": `attachment; filename="${bookId}.epub"`,
          "Access-Control-Allow-Origin": "*",
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

// GET /books/* - serve book files with range request support for audio
app.get("/books/:filepath{.+}", async (c) => {
  const filepath = c.req.param("filepath");
  const pathname = `/books/${filepath}`;
  const filePath = resolve(process.cwd(), "data", pathname.slice(1));

  if (!existsSync(filePath)) {
    return new Response("Not found", { status: 404 });
  }

  const ext = pathname.split(".").pop();
  const contentType =
    {
      pdf: "application/pdf",
      epub: "application/epub+zip",
      mobi: "application/x-mobipocket-ebook",
      cbr: "application/vnd.comicbook-rar",
      cbz: "application/vnd.comicbook+zip",
      m4b: "audio/mp4",
      m4a: "audio/mp4",
      mp3: "audio/mpeg",
    }[ext || ""] || "application/octet-stream";

  // Check if this is an audio file that needs range request support
  const isAudioFile = ["m4b", "m4a", "mp3"].includes(ext || "");

  if (isAudioFile) {
    const stat = statSync(filePath);
    const fileSize = stat.size;
    const rangeHeader = c.req.header("range");

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
      if (match) {
        const start = match[1] ? parseInt(match[1], 10) : 0;
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

        if (start >= fileSize || end >= fileSize || start > end) {
          return new Response("Range Not Satisfiable", {
            status: 416,
            headers: {
              "Content-Range": `bytes */${fileSize}`,
            },
          });
        }

        const chunkSize = end - start + 1;
        const fileHandle = await open(filePath, "r");
        const buffer = Buffer.alloc(chunkSize);
        await fileHandle.read(buffer, 0, chunkSize, start);
        await fileHandle.close();

        return new Response(buffer, {
          status: 206,
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(chunkSize),
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=3600",
          },
        });
      }
    }

    // No range header - stream the full file
    const stream = createReadStream(filePath);
    const readableStream = new ReadableStream({
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

    return new Response(readableStream, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(fileSize),
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  // Non-audio files: return full file
  const buffer = await readFile(filePath);
  return new Response(buffer, {
    headers: {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
    },
  });
});

// GET /covers/:filename - serve cover images
app.get("/covers/:filename", async (c) => {
  const filename = c.req.param("filename");
  const filePath = resolve(process.cwd(), "data", "covers", filename);

  if (!existsSync(filePath)) {
    return new Response("Not found", { status: 404 });
  }

  const buffer = await readFile(filePath);
  return new Response(buffer, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});

// GET /mobi-images/* - serve MOBI extracted images
app.get("/mobi-images/:rest{.+}", async (c) => {
  const rest = c.req.param("rest");
  const pathParts = rest.split("/");
  let filePath: string;

  if (pathParts.length >= 2) {
    // New format: /mobi-images/{bookId}/{filename}
    const [bookId, ...restParts] = pathParts;
    const filename = restParts.join("/");
    filePath = resolve(process.cwd(), "images", bookId, filename);
  } else {
    // Legacy format: /mobi-images/{filename}
    filePath = resolve(process.cwd(), "images", pathParts[0]);
  }

  if (!existsSync(filePath)) {
    return new Response("Not found", { status: 404 });
  }

  const buffer = await readFile(filePath);
  const ext = filePath.split(".").pop()?.toLowerCase();
  const contentType =
    {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
    }[ext || ""] || "image/jpeg";

  return new Response(buffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
});

// GET /comic/:id/:format/page/:pageNum - serve comic book pages
app.get("/comic/:id/:format/page/:pageNum", async (c) => {
  const bookId = c.req.param("id");
  const format = c.req.param("format");
  const pageNum = parseInt(c.req.param("pageNum"), 10);
  const bookPath = resolve(process.cwd(), "data", "books", `${bookId}.${format}`);

  if (existsSync(bookPath)) {
    try {
      const buffer = await readFile(bookPath);
      const page = await getComicPage(buffer, format as BookFormat, pageNum);

      if (page) {
        return new Response(new Uint8Array(page.data), {
          headers: {
            "Content-Type": page.mimeType,
            "Cache-Control": "public, max-age=31536000",
          },
        });
      }
    } catch (error) {
      console.error("Error extracting comic page:", error);
    }
  }

  return new Response("Page not found", { status: 404 });
});

// GET /comic/:id/:format/info - get comic book page count
app.get("/comic/:id/:format/info", async (c) => {
  const bookId = c.req.param("id");
  const format = c.req.param("format");
  const bookPath = resolve(process.cwd(), "data", "books", `${bookId}.${format}`);

  if (existsSync(bookPath)) {
    try {
      const buffer = await readFile(bookPath);
      const pageCount = await getComicPageCount(buffer, format as BookFormat);
      return c.json({ pageCount });
    } catch (error) {
      console.error("Error getting comic info:", error);
    }
  }

  return new Response("Comic not found", { status: 404 });
});

// GET /book/:id/* - serve EPUB internal resources (images, css, etc.)
app.get("/book/:id/:rest{.+}", async (c) => {
  const bookId = c.req.param("id");
  const resourcePath = c.req.param("rest");

  // Skip if this looks like a React Router route
  if (resourcePath === "read" || resourcePath === "edit") {
    return new Response("Not found", { status: 404 });
  }

  const bookPath = resolve(process.cwd(), "data", "books", `${bookId}.epub`);

  if (existsSync(bookPath)) {
    try {
      const buffer = await readFile(bookPath);
      const resource = await extractEpubResource(buffer, resourcePath);

      if (resource) {
        return new Response(new Uint8Array(resource.data), {
          headers: {
            "Content-Type": resource.mimeType,
            "Cache-Control": "public, max-age=31536000",
          },
        });
      }
    } catch (error) {
      console.error("Error extracting EPUB resource:", error);
    }
  }

  return new Response("Resource not found", { status: 404 });
});

export { app as assetsRoutes };
