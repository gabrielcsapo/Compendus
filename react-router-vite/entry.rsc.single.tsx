import { fetchServer } from "./entry.rsc";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { existsSync } from "fs";
import { eq } from "drizzle-orm";
import {
  apiSearchBooks,
  apiLookupByIsbn,
  apiGetBook,
  apiListBooks,
} from "../app/lib/api/search";
import { getComicPage, getComicPageCount } from "../app/lib/processing/comic";
import { processBook } from "../app/lib/processing";
import { processAndStoreCover } from "../app/lib/processing/cover";
import { indexBookMetadata } from "../app/lib/search/indexer";
import { db, books } from "../app/lib/db";
import { sql } from "drizzle-orm";
import type { BookFormat } from "../app/lib/types";

// CORS headers for public API
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// JSON response helper
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

// Handle API requests
async function handleApiRequest(
  request: Request,
  pathname: string,
  searchParams: URLSearchParams,
): Promise<Response | null> {
  // Only handle /api/* routes - let other requests pass through to SSR/RSC
  if (!pathname.startsWith("/api/")) {
    return null;
  }

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const baseUrl = new URL(request.url).origin;

  // GET /api/search?q=query&limit=20&offset=0&content=true
  if (pathname === "/api/search") {
    const query = searchParams.get("q") || "";
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);
    const searchContent = searchParams.get("content") === "true";

    const result = await apiSearchBooks(
      query,
      { limit, offset, searchContent },
      baseUrl,
    );
    return jsonResponse(result, result.success ? 200 : 400);
  }

  // GET /api/books - list all books
  if (pathname === "/api/books") {
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    const result = await apiListBooks({ limit, offset }, baseUrl);
    return jsonResponse(result, result.success ? 200 : 400);
  }

  // GET /api/books/isbn/:isbn - lookup by ISBN
  const isbnMatch = pathname.match(/^\/api\/books\/isbn\/(.+)$/);
  if (isbnMatch) {
    const isbn = isbnMatch[1];
    const result = await apiLookupByIsbn(isbn, baseUrl);
    return jsonResponse(result, result.success ? 200 : 404);
  }

  // GET /api/books/:id - get book by ID
  const bookIdMatch = pathname.match(/^\/api\/books\/([a-f0-9-]+)$/);
  if (bookIdMatch) {
    const id = bookIdMatch[1];
    const result = await apiGetBook(id, baseUrl);
    return jsonResponse(result, result.success ? 200 : 404);
  }

  // POST /api/books/:id/cover - upload custom cover image
  const coverUploadMatch = pathname.match(/^\/api\/books\/([a-f0-9-]+)\/cover$/);
  if (coverUploadMatch && request.method === "POST") {
    try {
      const bookId = coverUploadMatch[1];

      // Check if book exists
      const book = await db.select().from(books).where(eq(books.id, bookId)).get();
      if (!book) {
        return jsonResponse({ success: false, error: "book_not_found" }, 404);
      }

      const formData = await request.formData();
      const file = formData.get("cover") as File | null;

      if (!file) {
        return jsonResponse({ success: false, error: "no_file" }, 400);
      }

      // Validate file type (images only)
      const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
      if (!validTypes.includes(file.type)) {
        return jsonResponse({ success: false, error: "invalid_format" }, 400);
      }

      // Convert File to Buffer
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Process and store the cover
      const result = await processAndStoreCover(buffer, bookId);

      if (result.path) {
        // Update book record with new cover
        await db
          .update(books)
          .set({
            coverPath: result.path,
            coverColor: result.dominantColor,
            updatedAt: sql`(unixepoch())`,
          })
          .where(eq(books.id, bookId));

        return jsonResponse({
          success: true,
          coverPath: result.path,
          coverColor: result.dominantColor,
        });
      }

      return jsonResponse({ success: false, error: "processing_failed" }, 500);
    } catch (error) {
      console.error("Cover upload error:", error);
      return jsonResponse({ success: false, error: "upload_failed" }, 500);
    }
  }

  // POST /api/upload - upload a book file
  if (pathname === "/api/upload" && request.method === "POST") {
    try {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;

      if (!file) {
        return jsonResponse({ success: false, error: "no_file" }, 400);
      }

      // Validate file type
      const validExtensions = [".pdf", ".epub", ".mobi", ".azw", ".azw3", ".cbr", ".cbz"];
      const hasValidExtension = validExtensions.some((ext) =>
        file.name.toLowerCase().endsWith(ext),
      );

      if (!hasValidExtension) {
        return jsonResponse({ success: false, error: "invalid_format" }, 400);
      }

      // Convert File to Buffer
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Process the book
      const result = await processBook(buffer, file.name);

      if (result.success && result.bookId) {
        // Get the book to index it
        const book = await db.select().from(books).where(eq(books.id, result.bookId)).get();
        if (book) {
          await indexBookMetadata(book.id, book.title, book.authors || "[]", book.description);

          return jsonResponse({
            success: true,
            book: {
              id: book.id,
              title: book.title,
              format: book.format,
            },
          });
        }
      }

      return jsonResponse(result, result.success ? 200 : 400);
    } catch (error) {
      console.error("Upload error:", error);
      return jsonResponse(
        { success: false, error: "upload_failed" },
        500,
      );
    }
  }

  // API endpoint not found (we already verified pathname starts with /api/)
  return jsonResponse(
    {
      success: false,
      error: "Endpoint not found",
      code: "NOT_FOUND",
      endpoints: {
        search: "GET /api/search?q=<query>&limit=20&offset=0&content=false",
        list: "GET /api/books?limit=20&offset=0",
        getBook: "GET /api/books/:id",
        lookupIsbn: "GET /api/books/isbn/:isbn",
        upload: "POST /api/upload (multipart/form-data with 'file' field)",
      },
    },
    404,
  );
}

// Serve static files from data directory
async function serveStaticFile(pathname: string): Promise<Response | null> {
  // Handle /books/:id.:format requests
  if (pathname.startsWith("/books/")) {
    const filePath = resolve(process.cwd(), "data", pathname.slice(1));
    if (existsSync(filePath)) {
      const buffer = await readFile(filePath);
      const ext = pathname.split(".").pop();
      const contentType =
        {
          pdf: "application/pdf",
          epub: "application/epub+zip",
          mobi: "application/x-mobipocket-ebook",
          cbr: "application/vnd.comicbook-rar",
          cbz: "application/vnd.comicbook+zip",
        }[ext || ""] || "application/octet-stream";
      const fileName = pathname.split("/").pop() || "book";

      return new Response(buffer, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${fileName}"`,
        },
      });
    }
  }

  // Handle /covers/:id.jpg requests
  if (pathname.startsWith("/covers/")) {
    const filePath = resolve(process.cwd(), "data", pathname.slice(1));
    if (existsSync(filePath)) {
      const buffer = await readFile(filePath);
      return new Response(buffer, {
        headers: { "Content-Type": "image/jpeg" },
      });
    }
  }

  // Handle /comic/:id/page/:pageNum requests for comic book pages
  const comicPageMatch = pathname.match(
    /^\/comic\/([a-f0-9-]+)\/(cbr|cbz)\/page\/(\d+)$/,
  );
  if (comicPageMatch) {
    const [, bookId, format, pageNumStr] = comicPageMatch;
    const pageNum = parseInt(pageNumStr, 10);
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
  }

  // Handle /comic/:id/info requests for comic book metadata
  const comicInfoMatch = pathname.match(/^\/comic\/([a-f0-9-]+)\/(cbr|cbz)\/info$/);
  if (comicInfoMatch) {
    const [, bookId, format] = comicInfoMatch;
    const bookPath = resolve(process.cwd(), "data", "books", `${bookId}.${format}`);

    if (existsSync(bookPath)) {
      try {
        const buffer = await readFile(bookPath);
        const pageCount = await getComicPageCount(buffer, format as BookFormat);

        return new Response(JSON.stringify({ pageCount }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (error) {
        console.error("Error getting comic info:", error);
      }
    }

    return new Response("Comic not found", { status: 404 });
  }

  return null;
}

export default async function handler(request: Request) {
  const url = new URL(request.url);

  // Handle API requests
  const apiResponse = await handleApiRequest(
    request,
    url.pathname,
    url.searchParams,
  );
  if (apiResponse) {
    return apiResponse;
  }

  // Check for static file requests
  const staticResponse = await serveStaticFile(url.pathname);
  if (staticResponse) {
    return staticResponse;
  }

  const ssr = await import.meta.viteRsc.loadModule<
    typeof import("./entry.ssr")
  >("ssr", "index");

  return ssr.default(request, await fetchServer(request));
}
