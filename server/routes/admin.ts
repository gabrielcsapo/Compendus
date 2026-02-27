import { Hono } from "hono";
import { resolve } from "path";
import { BOOKS_DIR } from "../../app/lib/storage";
import { streamFileResponse } from "../lib/file-serving";

const app = new Hono();

// GET /api/admin/preview/:filename - Preview an orphaned file from the books directory
app.get("/api/admin/preview/:filename", async (c) => {
  const filename = c.req.param("filename");

  // Security: only allow simple filenames (no path traversal)
  if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    return c.json({ error: "Invalid filename" }, 400);
  }

  const filePath = resolve(BOOKS_DIR, filename);

  // Double-check the resolved path is still within BOOKS_DIR
  if (!filePath.startsWith(BOOKS_DIR)) {
    return c.json({ error: "Invalid filename" }, 400);
  }

  return streamFileResponse(c, filePath, {
    cacheControl: "no-cache",
  });
});

export const adminRoutes = app;
