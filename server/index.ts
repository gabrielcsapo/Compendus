import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";

import { searchRoutes } from "./routes/search";
import { booksRoutes } from "./routes/books";
import { uploadRoutes } from "./routes/upload";
import { coverRoutes } from "./routes/cover";
import { wishlistRoutes } from "./routes/wishlist";
import { jobsRoutes } from "./routes/jobs";
import { readerRoutes } from "./routes/reader";
import { convertRoutes } from "./routes/convert";
import { assetsRoutes } from "./routes/assets";

const app = new Hono();

// Global CORS middleware
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

// API routes
app.route("/", searchRoutes);
app.route("/", booksRoutes);
app.route("/", coverRoutes);
app.route("/", uploadRoutes);
app.route("/", jobsRoutes);
app.route("/", wishlistRoutes);
app.route("/", readerRoutes);
app.route("/", convertRoutes);

// Static asset routes
app.route("/", assetsRoutes);

// 404 for unmatched API routes
app.all("/api/*", (c) => {
  return c.json(
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
        wishlistByIsbn: "POST /api/wishlist/isbn/:isbn (JSON body: {status?, priority?, notes?, title?, author?})",
        readerPdfPage: "GET /api/reader/:bookId/pdf-page/:pageNum?scale=2.0 (returns PNG)",
        readerResource: "GET /api/reader/:bookId/resource/* (returns EPUB embedded resources)",
        convertToEpub: "POST /api/books/:id/convert-to-epub (converts PDF to EPUB)",
        epubStatus: "GET /api/books/:id/epub-status (check conversion status)",
      },
    },
    404,
  );
});

const PORT = parseInt(process.env.API_PORT || "3001", 10);
console.log(`[API Server] Starting on port ${PORT}`);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[API Server] Listening on http://localhost:${info.port}`);
});

export { app };
