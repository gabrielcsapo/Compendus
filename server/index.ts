import { Hono } from "hono";
import { cors } from "hono/cors";
import { compress } from "hono/compress";
import { etag } from "hono/etag";
import { createMiddleware } from "hono/factory";
import { randomUUID } from "crypto";

import { profileMiddleware, requireExplicitProfile, requireAdmin } from "./middleware/profile";
import { profileRoutes } from "./routes/profiles";
import { syncRoutes } from "./routes/sync";
import { searchRoutes } from "./routes/search";
import { booksRoutes } from "./routes/books";
import { collectionsRoutes } from "./routes/collections";
import { seriesRoutes } from "./routes/series";
import { uploadRoutes } from "./routes/upload";
import { coverRoutes } from "./routes/cover";
import { wishlistRoutes } from "./routes/wishlist";
import { jobsRoutes } from "./routes/jobs";
import { readerRoutes } from "./routes/reader";
import { convertRoutes } from "./routes/convert";
import { transcribeRoutes } from "./routes/transcribe";
import { editorRoutes } from "./routes/editor";
import { assetsRoutes } from "./routes/assets";
import { libraryRoutes } from "./routes/library";
import { adminRoutes } from "./routes/admin";
import { statsRoutes } from "./routes/stats";
import { exploreRoutes } from "./routes/explore";
import { knowledgeRoutes } from "./routes/knowledge";
import { substrateRoutes } from "./routes/substrate";
import { conceptRoutes } from "./routes/concept";
import { reckoningRoutes } from "./routes/reckoning";
import { lgRoutes } from "./routes/lg";
import { downloadRoutes } from "./routes/downloads";
import { generateMissingThumbnails } from "../app/lib/processing/cover";

const app = new Hono();

// Give local development and production diagnostics the same lightweight
// vocabulary. This intentionally records no profile or reading data: it only
// exposes an opaque request ID and the server's handler duration.
const requestMetricsMiddleware = createMiddleware(async (c, next) => {
  const requestId = c.req.header("X-Request-Id") || randomUUID();
  const startedAt = performance.now();

  await next();

  const durationMs = Math.max(0, performance.now() - startedAt);
  c.header("X-Request-Id", requestId);
  c.header("Server-Timing", `app;dur=${durationMs.toFixed(1)}`);
});

// Pre-compiled regex for static asset detection (used in profileGateMiddleware)
const STATIC_ASSET_RE = /\.\w+$/;

// Global CORS middleware
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "X-Profile-Id", "X-Request-Id"],
    exposeHeaders: [
      "ETag",
      "Server-Timing",
      "X-Request-Id",
      "X-Artifact-SHA256",
      "X-Artifact-Version",
      "Content-Range",
    ],
    credentials: true,
  }),
);

app.use("*", requestMetricsMiddleware);

// Global profile middleware (reads profile from header/cookie, never blocks)
app.use("*", profileMiddleware);

/**
 * Profile gate: redirect to /profiles if no profile is selected.
 * Skips API routes, static assets, flight router internals, and the profiles page itself.
 */
export const profileGateMiddleware = createMiddleware(async (c, next) => {
  const path = new URL(c.req.url).pathname;

  // Skip: API routes, static assets, flight router internals, profiles page
  if (
    path.startsWith("/api/") ||
    path.startsWith("/_flight/") ||
    path.startsWith("/profiles") ||
    path.startsWith("/about") ||
    path.startsWith("/docs") ||
    // Static assets (files with extensions)
    STATIC_ASSET_RE.test(path) ||
    // Asset routes (books, covers, avatars, comics, mobi-images)
    path.startsWith("/books/") ||
    path.startsWith("/covers/") ||
    path.startsWith("/avatars/") ||
    path.startsWith("/comic/") ||
    path.startsWith("/mobi-images/")
  ) {
    return next();
  }

  // If no profile is selected, redirect to profile picker
  if (!c.get("profileId")) {
    return c.redirect("/profiles", 302);
  }

  return next();
});

app.use("*", profileGateMiddleware);

// Compression for API responses only (not binary file streams like audio/books/covers)
app.use("/api/*", compress());

// ETag support for API routes (conditional 304 responses)
app.use("/api/*", etag());

// Profile routes (public — no profile required for listing/selecting)
app.route("/", profileRoutes);

// Deny API access by default unless the caller supplied a valid profile
// credential. Public profile discovery/selection routes are mounted above this
// boundary; every API route mounted below it inherits the explicit guard.
app.use("/api/*", requireExplicitProfile);

// Raw/downloadable content is protected separately because it lives outside
// the /api namespace as well as under it.
app.use("/api/downloads/*", requireExplicitProfile);
app.use("/books/*", requireExplicitProfile);
app.use("/book/*", requireExplicitProfile);
app.use("/comic/*", requireExplicitProfile);
app.use("/mobi-images/*", requireExplicitProfile);

// Admin-only routes
app.use("/api/upload", requireAdmin);
app.use("/api/upload/*", requireAdmin);
app.use("/api/upload-multifile", requireAdmin);
app.use("/api/admin", requireAdmin);
app.use("/api/admin/*", requireAdmin);
app.use("/api/books/:id/file", requireAdmin);

// Sync routes (require an explicit profile through the default API boundary)
app.route("/", syncRoutes);

app.route("/", searchRoutes);
app.route("/", booksRoutes);
app.route("/", collectionsRoutes);
app.route("/", seriesRoutes);
app.route("/", coverRoutes);
app.route("/", uploadRoutes);
app.route("/", jobsRoutes);
app.route("/", wishlistRoutes);
app.route("/", readerRoutes);
app.route("/", downloadRoutes);
app.route("/", convertRoutes);
app.route("/", transcribeRoutes);
app.route("/", editorRoutes);
app.route("/", libraryRoutes);
app.route("/", adminRoutes);
app.route("/", statsRoutes);
app.route("/", exploreRoutes);
app.route("/", knowledgeRoutes);
app.route("/", substrateRoutes);
app.route("/", conceptRoutes);
app.route("/", reckoningRoutes);
app.route("/", lgRoutes);

// Static asset routes
app.route("/", assetsRoutes);

// Generate thumbnails for any existing covers that don't have them yet
generateMissingThumbnails().catch((err) =>
  console.warn("[thumbnails] Failed to generate missing thumbnails:", err),
);

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
        wishlistByIsbn:
          "POST /api/wishlist/isbn/:isbn (JSON body: {status?, priority?, notes?, title?, author?})",
        readerPdfPage: "GET /api/reader/:bookId/pdf-page/:pageNum?scale=2.0 (returns PNG)",
        readerResource: "GET /api/reader/:bookId/resource/* (returns EPUB embedded resources)",
        convertToEpub: "POST /api/books/:id/convert-to-epub (converts PDF to EPUB)",
        epubStatus: "GET /api/books/:id/epub-status (check conversion status)",
        transcribe: "POST /api/books/:id/transcribe (transcribe audiobook with Whisper)",
        transcript: "GET /api/books/:id/transcript (get transcript JSON)",
        transcriptStatus: "GET /api/books/:id/transcript-status (check transcript status)",
        updateBook: "PUT /api/books/:id (JSON body: {title?, authors?, ...})",
        bookEdits: "GET /api/books/:id/edits?limit=50&offset=0",
        tags: "GET /api/tags",
        bookTags: "GET /api/books/:id/tags",
        addTag: "POST /api/books/:id/tags (JSON body: {name})",
        removeTag: "DELETE /api/books/:id/tags/:tagId",
        library: "GET /api/library?offset=0&sort=recent&type=ebook&format=epub",
        stats: "GET /api/stats",
      },
    },
    404,
  );
});

export { app };
