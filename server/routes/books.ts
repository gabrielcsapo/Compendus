import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { apiListBooks, apiGetBook, apiLookupByIsbn } from "../../app/lib/api/search";
import { updateBook } from "../../app/actions/books";
import { db, bookEdits } from "../../app/lib/db";
import {
  getTags,
  getTagsForBook,
  addTagToBookByName,
  removeTagFromBook,
} from "../../app/actions/tags";

const app = new Hono();

// GET /api/books - list all books
app.get("/api/books", async (c) => {
  const limit = parseInt(c.req.query("limit") || "20", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const type = c.req.query("type") as "ebook" | "audiobook" | "comic" | undefined;
  const orderBy = c.req.query("orderBy") as "title" | "createdAt" | undefined;
  const order = c.req.query("order") as "asc" | "desc" | undefined;
  const series = c.req.query("series");

  const baseUrl = new URL(c.req.url).origin;
  const result = await apiListBooks(
    { limit, offset, type: type || undefined, orderBy: orderBy || undefined, order: order || undefined, series: series || undefined },
    baseUrl,
  );
  return c.json(result, result.success ? 200 : 400);
});

// GET /api/books/isbn/:isbn - lookup by ISBN (must be before :id route)
app.get("/api/books/isbn/:isbn", async (c) => {
  const isbn = c.req.param("isbn");
  const baseUrl = new URL(c.req.url).origin;
  const result = await apiLookupByIsbn(isbn, baseUrl);
  return c.json(result, result.success ? 200 : 404);
});

// GET /api/books/:id - get book by ID
app.get("/api/books/:id", async (c) => {
  const id = c.req.param("id");
  const baseUrl = new URL(c.req.url).origin;
  const result = await apiGetBook(id, baseUrl);
  return c.json(result, result.success ? 200 : 404);
});

// PUT /api/books/:id - update book metadata
app.put("/api/books/:id", async (c) => {
  const id = c.req.param("id");
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const source = (body.source as string) || "api";
  if (!["web", "ios", "api", "metadata"].includes(source)) {
    return c.json({ success: false, error: "Invalid source" }, 400);
  }

  const editableFields = [
    "title", "subtitle", "authors", "publisher", "publishedDate",
    "description", "isbn", "language", "pageCount", "series",
    "seriesNumber", "bookTypeOverride", "isRead", "rating", "review",
  ];
  const updates: Record<string, unknown> = {};

  for (const field of editableFields) {
    if (field in body) {
      let value = body[field];
      // Normalize: iOS sends authors as string[], server expects JSON string
      if (field === "authors" && Array.isArray(value)) {
        value = JSON.stringify(value);
      }
      // Normalize empty strings to null
      if (typeof value === "string" && value.trim() === "") {
        value = null;
      }
      updates[field] = value;
    }
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ success: false, error: "No editable fields provided" }, 400);
  }

  const updated = await updateBook(
    id,
    updates as Parameters<typeof updateBook>[1],
    source as "web" | "ios" | "api" | "metadata",
  );
  if (!updated) {
    return c.json({ success: false, error: "Book not found" }, 404);
  }

  const baseUrl = new URL(c.req.url).origin;
  const result = await apiGetBook(id, baseUrl);
  return c.json(result, 200);
});

// GET /api/books/:id/edits - get edit history for a book
app.get("/api/books/:id/edits", async (c) => {
  const id = c.req.param("id");
  const limit = parseInt(c.req.query("limit") || "50", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const edits = await db
    .select()
    .from(bookEdits)
    .where(eq(bookEdits.bookId, id))
    .orderBy(desc(bookEdits.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ success: true, edits, total: edits.length, limit, offset });
});

// GET /api/tags - list all tags
app.get("/api/tags", async (c) => {
  const allTags = await getTags();
  return c.json({ success: true, tags: allTags });
});

// GET /api/books/:id/tags - get tags for a book
app.get("/api/books/:id/tags", async (c) => {
  const id = c.req.param("id");
  const bookTags = await getTagsForBook(id);
  return c.json({ success: true, tags: bookTags });
});

// POST /api/books/:id/tags - add tag to book by name
app.post("/api/books/:id/tags", async (c) => {
  const id = c.req.param("id");
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const name = body.name as string;
  if (!name || typeof name !== "string" || name.trim() === "") {
    return c.json({ success: false, error: "Tag name is required" }, 400);
  }

  const tag = await addTagToBookByName(id, name.trim());
  if (!tag) {
    return c.json({ success: false, error: "Failed to add tag" }, 500);
  }

  return c.json({ success: true, tag });
});

// DELETE /api/books/:id/tags/:tagId - remove tag from book
app.delete("/api/books/:id/tags/:tagId", async (c) => {
  const id = c.req.param("id");
  const tagId = c.req.param("tagId");
  await removeTagFromBook(id, tagId);
  return c.json({ success: true });
});

export { app as booksRoutes };
