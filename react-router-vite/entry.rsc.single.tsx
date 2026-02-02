import { fetchServer } from "./entry.rsc";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { existsSync } from "fs";
import { eq } from "drizzle-orm";
import { apiSearchBooks, apiLookupByIsbn, apiGetBook, apiListBooks } from "../app/lib/api/search";
import { getComicPage, getComicPageCount } from "../app/lib/processing/comic";
import { extractEpubResource } from "../app/lib/processing/epub";
import { processBook } from "../app/lib/processing";
import { getBookFilePath } from "../app/lib/storage";
import { processAndStoreCover } from "../app/lib/processing/cover";
import { indexBookMetadata } from "../app/lib/search/indexer";
import { db, books } from "../app/lib/db";
import { sql } from "drizzle-orm";
import type { BookFormat } from "../app/lib/types";
import { lookupByISBN, lookupGoogleBooksByISBN } from "../app/lib/metadata";
import { addToWantedList, getWantedBooks } from "../app/actions/wanted";
import { renderPdfPage } from "../app/lib/reader/pdf-renderer";

// CORS headers for public API
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

    const result = await apiSearchBooks(query, { limit, offset, searchContent }, baseUrl);
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
      const validExtensions = [
        ".pdf",
        ".epub",
        ".mobi",
        ".azw",
        ".azw3",
        ".cbr",
        ".cbz",
        ".m4b",
        ".m4a",
        ".mp3",
      ];
      const hasValidExtension = validExtensions.some((ext) =>
        file.name.toLowerCase().endsWith(ext),
      );

      if (!hasValidExtension) {
        return jsonResponse({ success: false, error: "invalid_format" }, 400);
      }

      // Extract optional metadata overrides from form data
      const metadata: Record<string, unknown> = {};
      const metadataFields = [
        "title",
        "isbn",
        "isbn13",
        "isbn10",
        "publisher",
        "publishedDate",
        "description",
        "language",
      ];
      for (const field of metadataFields) {
        const value = formData.get(field);
        if (value && typeof value === "string") {
          metadata[field] = value;
        }
      }
      // Handle authors as JSON array
      const authorsStr = formData.get("authors");
      if (authorsStr && typeof authorsStr === "string") {
        try {
          metadata.authors = JSON.parse(authorsStr);
        } catch {
          metadata.authors = [authorsStr];
        }
      }
      // Handle pageCount as number
      const pageCountStr = formData.get("pageCount");
      if (pageCountStr && typeof pageCountStr === "string") {
        metadata.pageCount = parseInt(pageCountStr, 10);
      }

      // Convert File to Buffer
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Process the book with metadata overrides
      const result = await processBook(buffer, file.name, {
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });

      if (result.success && result.bookId) {
        // Get the book to index it
        const book = await db.select().from(books).where(eq(books.id, result.bookId)).get();
        if (book) {
          await indexBookMetadata(book.id, book.title, book.subtitle, book.authors || "[]", book.description);

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
      return jsonResponse({ success: false, error: "upload_failed" }, 500);
    }
  }

  // GET /api/wishlist - get wishlist items
  if (pathname === "/api/wishlist" && request.method === "GET") {
    try {
      const status = searchParams.get("status") as "wishlist" | "searching" | "ordered" | null;
      const series = searchParams.get("series");
      const limitParam = searchParams.get("limit");
      const limit = limitParam ? parseInt(limitParam, 10) : undefined;

      // getWantedBooks now handles filtering out owned books automatically
      const result = await getWantedBooks({
        status: status || undefined,
        series: series || undefined,
        limit,
      });

      return jsonResponse({
        success: true,
        total: result.books.length,
        removed: result.removed,
        books: result.books.map((book) => ({
          id: book.id,
          title: book.title,
          subtitle: book.subtitle,
          authors: book.authors ? JSON.parse(book.authors) : [],
          publisher: book.publisher,
          publishedDate: book.publishedDate,
          description: book.description,
          isbn: book.isbn,
          isbn13: book.isbn13,
          isbn10: book.isbn10,
          language: book.language,
          pageCount: book.pageCount,
          series: book.series,
          seriesNumber: book.seriesNumber,
          coverUrl: book.coverUrl,
          status: book.status,
          priority: book.priority,
          notes: book.notes,
          source: book.source,
          createdAt: book.createdAt?.toISOString(),
        })),
      });
    } catch (error) {
      console.error("Wishlist get error:", error);
      return jsonResponse(
        {
          success: false,
          error: "Failed to retrieve wishlist",
          code: "WISHLIST_ERROR",
        },
        500,
      );
    }
  }

  // POST /api/wishlist/isbn/:isbn - add book to wishlist by ISBN
  const wishlistIsbnMatch = pathname.match(/^\/api\/wishlist\/isbn\/(.+)$/);
  if (wishlistIsbnMatch && request.method === "POST") {
    try {
      const isbn = wishlistIsbnMatch[1].replace(/[-\s]/g, "");

      // Validate ISBN format (10 or 13 digits)
      if (!/^(\d{10}|\d{13})$/.test(isbn)) {
        return jsonResponse(
          {
            success: false,
            error: "Invalid ISBN format. Must be 10 or 13 digits.",
            code: "INVALID_ISBN",
          },
          400,
        );
      }

      // Parse request body early to check for fallback title/author
      let bodyData: {
        status?: "wishlist" | "searching" | "ordered";
        priority?: number;
        notes?: string;
        title?: string;
        author?: string;
      } = {};
      try {
        const contentType = request.headers.get("content-type");
        if (contentType?.includes("application/json")) {
          const body = await request.json();
          if (body.status) bodyData.status = body.status;
          if (body.priority !== undefined) bodyData.priority = body.priority;
          if (body.notes) bodyData.notes = body.notes;
          if (body.title) bodyData.title = body.title;
          if (body.author) bodyData.author = body.author;
        }
      } catch {
        // Ignore body parsing errors, use defaults
      }

      // Look up book metadata from external sources
      // Try Google Books first for better covers, then Open Library
      let metadata = await lookupGoogleBooksByISBN(isbn);

      if (!metadata) {
        metadata = await lookupByISBN(isbn);
      }

      // If no metadata found, check for fallback title/author
      if (!metadata) {
        if (bodyData.title) {
          // Create manual metadata entry with provided title and optional author
          metadata = {
            title: bodyData.title,
            subtitle: null,
            authors: bodyData.author ? [bodyData.author] : [],
            publisher: null,
            publishedDate: null,
            description: null,
            pageCount: null,
            isbn: isbn,
            isbn13: isbn.length === 13 ? isbn : null,
            isbn10: isbn.length === 10 ? isbn : null,
            language: "en",
            subjects: [],
            series: null,
            seriesNumber: null,
            coverUrl: null,
            coverUrlHQ: null,
            coverUrls: [],
            source: "manual" as const,
            sourceId: `manual-${isbn}`,
          };
        } else {
          return jsonResponse(
            {
              success: false,
              error:
                "Book not found. Could not find metadata for this ISBN. You can provide 'title' and optionally 'author' in the request body to add it manually.",
              code: "BOOK_NOT_FOUND",
            },
            404,
          );
        }
      }

      // Build options from parsed body
      const options: {
        status?: "wishlist" | "searching" | "ordered";
        priority?: number;
        notes?: string;
      } = {};
      if (bodyData.status) options.status = bodyData.status;
      if (bodyData.priority !== undefined) options.priority = bodyData.priority;
      if (bodyData.notes) options.notes = bodyData.notes;

      // Add to wanted list
      const wantedBook = await addToWantedList(metadata, options);

      return jsonResponse({
        success: true,
        book: {
          id: wantedBook.id,
          title: wantedBook.title,
          authors: wantedBook.authors ? JSON.parse(wantedBook.authors) : [],
          isbn: wantedBook.isbn,
          isbn13: wantedBook.isbn13,
          isbn10: wantedBook.isbn10,
          coverUrl: wantedBook.coverUrl,
          status: wantedBook.status,
          priority: wantedBook.priority,
          source: wantedBook.source,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to add book to wishlist";

      // Handle specific error cases
      if (message.includes("already in your wanted list")) {
        return jsonResponse({ success: false, error: message, code: "ALREADY_IN_WISHLIST" }, 409);
      }
      if (message.includes("already own this book")) {
        return jsonResponse({ success: false, error: message, code: "ALREADY_OWNED" }, 409);
      }

      console.error("Wishlist add error:", error);
      return jsonResponse({ success: false, error: message, code: "WISHLIST_ERROR" }, 500);
    }
  }

  // ============================================
  // READER BINARY ENDPOINTS (kept for binary responses)
  // ============================================

  // GET /api/reader/:bookId/pdf-page/:pageNum - Render PDF page as image
  const pdfPageMatch = pathname.match(/^\/api\/reader\/([a-f0-9-]+)\/pdf-page\/(\d+)$/);
  if (pdfPageMatch && request.method === "GET") {
    try {
      const bookId = pdfPageMatch[1];
      const pageNumber = parseInt(pdfPageMatch[2], 10);
      const scale = parseFloat(searchParams.get("scale") || "2.0");

      // Get book to find the file
      const book = await db.query.books.findFirst({
        where: eq(books.id, bookId),
      });

      if (!book || book.format !== "pdf") {
        return new Response("PDF not found", { status: 404 });
      }

      // Read PDF file
      const pdfPath = resolve("data", "books", `${bookId}.pdf`);
      if (!existsSync(pdfPath)) {
        return new Response("PDF file not found", { status: 404 });
      }

      const buffer = await readFile(pdfPath);
      const pngBuffer = await renderPdfPage(buffer, bookId, pageNumber, scale);

      // Convert Buffer to Uint8Array for Response
      const uint8Array = new Uint8Array(pngBuffer);

      return new Response(uint8Array, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch (error) {
      console.error("PDF page render error:", error);
      return new Response("Failed to render PDF page", { status: 500 });
    }
  }

  // GET /api/reader/:bookId/resource/* - Serve embedded resources from EPUB files
  const epubResourceMatch = pathname.match(/^\/api\/reader\/([a-f0-9-]+)\/resource\/(.+)$/);
  if (epubResourceMatch && request.method === "GET") {
    try {
      const bookId = epubResourceMatch[1];
      const resourcePath = decodeURIComponent(epubResourceMatch[2]);

      // Get book to find the file
      const book = await db.query.books.findFirst({
        where: eq(books.id, bookId),
      });

      if (!book || book.format !== "epub") {
        return new Response("Not found", { status: 404 });
      }

      // Read EPUB file
      const filePath = getBookFilePath(bookId, "epub");
      const buffer = await readFile(filePath);

      // Extract resource from EPUB
      const resource = await extractEpubResource(buffer, resourcePath);

      if (!resource) {
        return new Response("Resource not found", { status: 404 });
      }

      return new Response(new Uint8Array(resource.data), {
        headers: {
          "Content-Type": resource.mimeType,
          "Cache-Control": "public, max-age=86400",
        },
      });
    } catch (error) {
      console.error("EPUB resource error:", error);
      return new Response("Error loading resource", { status: 500 });
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
        uploadCover: "POST /api/books/:id/cover (multipart/form-data with 'cover' field)",
        wishlist: "GET /api/wishlist?status=<status>&series=<series>&limit=<limit>",
        wishlistByIsbn:
          "POST /api/wishlist/isbn/:isbn (JSON body: {status?, priority?, notes?, title?, author?})",
        readerPdfPage: "GET /api/reader/:bookId/pdf-page/:pageNum?scale=2.0 (returns PNG)",
        readerResource: "GET /api/reader/:bookId/resource/* (returns EPUB embedded resources)",
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
          m4b: "audio/mp4",
          m4a: "audio/mp4",
          mp3: "audio/mpeg",
        }[ext || ""] || "application/octet-stream";

      return new Response(buffer, {
        headers: {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=3600",
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

  // Handle /mobi-images/:bookId/:filename requests (images extracted by mobi-parser)
  // Also supports legacy /mobi-images/:filename for backwards compatibility
  if (pathname.startsWith("/mobi-images/")) {
    const pathParts = pathname.slice("/mobi-images/".length).split("/");
    let filePath: string;

    if (pathParts.length >= 2) {
      // New format: /mobi-images/{bookId}/{filename}
      const [bookId, ...rest] = pathParts;
      const filename = rest.join("/");
      filePath = resolve(process.cwd(), "images", bookId, filename);
    } else {
      // Legacy format: /mobi-images/{filename} - serve from shared directory
      const filename = pathParts[0];
      filePath = resolve(process.cwd(), "images", filename);
    }

    if (existsSync(filePath)) {
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
    }
  }

  // Handle /comic/:id/page/:pageNum requests for comic book pages
  const comicPageMatch = pathname.match(/^\/comic\/([a-f0-9-]+)\/(cbr|cbz)\/page\/(\d+)$/);
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

  // Handle /book/:id/* requests for EPUB internal resources (images, css, etc.)
  // These requests come from relative URLs in EPUB content rendered in iframes
  const epubResourceMatch = pathname.match(/^\/book\/([a-f0-9-]+)\/(.+)$/);
  if (epubResourceMatch) {
    const [, bookId, resourcePath] = epubResourceMatch;

    // Skip if this looks like a route (e.g., /book/:id/read)
    if (resourcePath === "read" || resourcePath === "edit") {
      return null;
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
  }

  return null;
}

export default async function handler(request: Request) {
  const url = new URL(request.url);

  // don't handle rsc requests
  const isRsc = url.pathname.includes(".manifest") || url.pathname.includes(".rsc");
  if (!isRsc) {
    // Handle API requests
    const apiResponse = await handleApiRequest(request, url.pathname, url.searchParams);
    if (apiResponse) {
      return apiResponse;
    }

    // Check for static file requests
    const staticResponse = await serveStaticFile(url.pathname);
    if (staticResponse) {
      return staticResponse;
    }
  }

  const ssr = await import.meta.viteRsc.loadModule<typeof import("./entry.ssr")>("ssr", "index");

  return ssr.default(request, await fetchServer(request));
}
