import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  db,
  userBookState,
  highlights,
  bookmarks,
  readingSessions,
} from "../../app/lib/db";
import { requireProfile } from "../middleware/profile";

const app = new Hono();

// Drizzle with mode:"timestamp" may return Date objects or raw unix-second numbers.
// These helpers handle both cases safely.
function tsToISO(value: Date | number): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(value * 1000).toISOString();
}

function tsToISOOrNull(value: Date | number | null): string | null {
  if (value === null || value === undefined) return null;
  return tsToISO(value);
}

function tsToUnixSeconds(value: Date | number): number {
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  return value;
}

// All sync routes require a profile
app.use("/api/sync/*", requireProfile);

// --- Reading Progress ---

// GET /api/sync/reading-progress — Get all reading progress for current profile
app.get("/api/sync/reading-progress", (c) => {
  const profileId = c.get("profileId");
  const since = c.req.query("since");

  let query = db
    .select()
    .from(userBookState)
    .where(eq(userBookState.profileId, profileId));

  const results = query.all().filter((row) => {
    if (since) {
      const sinceTs = Math.floor(new Date(since).getTime() / 1000);
      return tsToUnixSeconds(row.updatedAt) > sinceTs;
    }
    return true;
  });

  return c.json({
    success: true,
    data: results.map((row) => ({
      bookId: row.bookId,
      readingProgress: row.readingProgress,
      lastPosition: row.lastPosition,
      lastReadAt: tsToISOOrNull(row.lastReadAt),
      isRead: row.isRead ?? false,
      rating: row.rating,
      review: row.review,
      updatedAt: tsToISO(row.updatedAt),
    })),
  });
});

// PUT /api/sync/reading-progress — Upsert reading progress for a book
app.put("/api/sync/reading-progress", async (c) => {
  const profileId = c.get("profileId");
  const body = await c.req.json<{
    bookId: string;
    readingProgress?: number;
    lastPosition?: string;
    lastReadAt?: string;
    isRead?: boolean;
    rating?: number | null;
    review?: string | null;
    updatedAt?: string;
  }>();

  if (!body.bookId) {
    return c.json(
      { success: false, error: "bookId is required", code: "VALIDATION" },
      400,
    );
  }

  const existing = db
    .select()
    .from(userBookState)
    .where(
      and(
        eq(userBookState.profileId, profileId),
        eq(userBookState.bookId, body.bookId),
      ),
    )
    .get();

  // Conflict resolution: if client sends updatedAt, check if server is newer
  if (existing && body.updatedAt) {
    const clientTs = Math.floor(new Date(body.updatedAt).getTime() / 1000);
    const serverTs = tsToUnixSeconds(existing.updatedAt);
    if (serverTs > clientTs) {
      // Server is newer, return server state
      return c.json({
        success: true,
        conflict: true,
        data: {
          bookId: existing.bookId,
          readingProgress: existing.readingProgress,
          lastPosition: existing.lastPosition,
          isRead: existing.isRead ?? false,
          rating: existing.rating,
          review: existing.review,
        },
      });
    }
  }

  const now = new Date();

  try {
    if (existing) {
      const updates: Record<string, unknown> = { updatedAt: now };
      if (body.readingProgress !== undefined)
        updates.readingProgress = body.readingProgress;
      if (body.lastPosition !== undefined)
        updates.lastPosition = body.lastPosition;
      if (body.lastReadAt !== undefined)
        updates.lastReadAt = new Date(body.lastReadAt);
      if (body.isRead !== undefined) updates.isRead = body.isRead;
      if (body.rating !== undefined) updates.rating = body.rating;
      if (body.review !== undefined) updates.review = body.review;

      db.update(userBookState)
        .set(updates)
        .where(eq(userBookState.id, existing.id))
        .run();
    } else {
      db.insert(userBookState)
        .values({
          id: randomUUID(),
          profileId,
          bookId: body.bookId,
          readingProgress: body.readingProgress ?? 0,
          lastPosition: body.lastPosition ?? null,
          lastReadAt: body.lastReadAt ? new Date(body.lastReadAt) : null,
          isRead: body.isRead ?? false,
          rating: body.rating ?? null,
          review: body.review ?? null,
          updatedAt: now,
        })
        .run();
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("FOREIGN KEY")) {
      return c.json(
        { success: false, error: "Book not found on server", code: "FK_VIOLATION" },
        404,
      );
    }
    throw e;
  }

  return c.json({ success: true });
});

// --- Highlights ---

// GET /api/sync/highlights — Get highlights for current profile
app.get("/api/sync/highlights", (c) => {
  const profileId = c.get("profileId");
  const bookId = c.req.query("bookId");
  const since = c.req.query("since");

  let conditions = [eq(highlights.profileId, profileId)];
  if (bookId) {
    conditions.push(eq(highlights.bookId, bookId));
  }

  const results = db
    .select()
    .from(highlights)
    .where(and(...conditions))
    .all()
    .filter((row) => {
      if (since) {
        const sinceTs = Math.floor(new Date(since).getTime() / 1000);
        return tsToUnixSeconds(row.updatedAt) > sinceTs;
      }
      return true;
    });

  return c.json({
    success: true,
    data: results.map((row) => ({
      id: row.id,
      bookId: row.bookId,
      startPosition: row.startPosition,
      endPosition: row.endPosition,
      text: row.text,
      note: row.note,
      color: row.color,
      createdAt: tsToISO(row.createdAt),
      updatedAt: tsToISO(row.updatedAt),
      deletedAt: tsToISOOrNull(row.deletedAt),
    })),
  });
});

// POST /api/sync/highlights — Batch upsert highlights
app.post("/api/sync/highlights", async (c) => {
  const profileId = c.get("profileId");
  const body = await c.req.json<{
    highlights: Array<{
      id: string;
      bookId: string;
      startPosition: string;
      endPosition: string;
      text: string;
      note?: string | null;
      color?: string;
      createdAt?: string;
      updatedAt?: string;
      deletedAt?: string | null;
    }>;
  }>();

  const now = new Date();

  for (const h of body.highlights) {
    try {
      const existing = db
        .select()
        .from(highlights)
        .where(eq(highlights.id, h.id))
        .get();

      if (existing) {
        // Conflict check
        if (h.updatedAt) {
          const clientTs = Math.floor(new Date(h.updatedAt).getTime() / 1000);
          const serverTs = tsToUnixSeconds(existing.updatedAt);
          if (serverTs > clientTs) continue; // Server is newer, skip
        }

        db.update(highlights)
          .set({
            startPosition: h.startPosition,
            endPosition: h.endPosition,
            text: h.text,
            note: h.note ?? null,
            color: h.color ?? existing.color,
            updatedAt: now,
            deletedAt: h.deletedAt ? new Date(h.deletedAt) : null,
          })
          .where(eq(highlights.id, h.id))
          .run();
      } else {
        db.insert(highlights)
          .values({
            id: h.id,
            profileId,
            bookId: h.bookId,
            startPosition: h.startPosition,
            endPosition: h.endPosition,
            text: h.text,
            note: h.note ?? null,
            color: h.color ?? "#ffff00",
            createdAt: h.createdAt ? new Date(h.createdAt) : now,
            updatedAt: now,
            deletedAt: h.deletedAt ? new Date(h.deletedAt) : null,
          })
          .run();
      }
    } catch (e: unknown) {
      // Skip FK violations (book doesn't exist on server)
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("FOREIGN KEY")) throw e;
    }
  }

  return c.json({ success: true });
});

// DELETE /api/sync/highlights/:id — Soft-delete a highlight
app.delete("/api/sync/highlights/:id", (c) => {
  const profileId = c.get("profileId");
  const highlightId = c.req.param("id");

  const existing = db
    .select()
    .from(highlights)
    .where(and(eq(highlights.id, highlightId), eq(highlights.profileId, profileId)))
    .get();

  if (!existing) {
    return c.json(
      { success: false, error: "Highlight not found", code: "NOT_FOUND" },
      404,
    );
  }

  db.update(highlights)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(highlights.id, highlightId))
    .run();

  return c.json({ success: true });
});

// --- Bookmarks ---

// GET /api/sync/bookmarks — Get bookmarks for current profile
app.get("/api/sync/bookmarks", (c) => {
  const profileId = c.get("profileId");
  const bookId = c.req.query("bookId");
  const since = c.req.query("since");

  let conditions = [eq(bookmarks.profileId, profileId)];
  if (bookId) {
    conditions.push(eq(bookmarks.bookId, bookId));
  }

  const results = db
    .select()
    .from(bookmarks)
    .where(and(...conditions))
    .all()
    .filter((row) => {
      if (since) {
        const sinceTs = Math.floor(new Date(since).getTime() / 1000);
        return tsToUnixSeconds(row.updatedAt) > sinceTs;
      }
      return true;
    });

  return c.json({
    success: true,
    data: results.map((row) => ({
      id: row.id,
      bookId: row.bookId,
      position: row.position,
      title: row.title,
      note: row.note,
      color: row.color,
      createdAt: tsToISO(row.createdAt),
      updatedAt: tsToISO(row.updatedAt),
      deletedAt: tsToISOOrNull(row.deletedAt),
    })),
  });
});

// POST /api/sync/bookmarks — Batch upsert bookmarks
app.post("/api/sync/bookmarks", async (c) => {
  const profileId = c.get("profileId");
  const body = await c.req.json<{
    bookmarks: Array<{
      id: string;
      bookId: string;
      position: string;
      title?: string | null;
      note?: string | null;
      color?: string | null;
      createdAt?: string;
      updatedAt?: string;
      deletedAt?: string | null;
    }>;
  }>();

  const now = new Date();

  for (const b of body.bookmarks) {
    try {
      const existing = db
        .select()
        .from(bookmarks)
        .where(eq(bookmarks.id, b.id))
        .get();

      if (existing) {
        if (b.updatedAt) {
          const clientTs = Math.floor(new Date(b.updatedAt).getTime() / 1000);
          const serverTs = tsToUnixSeconds(existing.updatedAt);
          if (serverTs > clientTs) continue;
        }

        db.update(bookmarks)
          .set({
            position: b.position,
            title: b.title ?? existing.title,
            note: b.note ?? existing.note,
            color: b.color ?? existing.color,
            updatedAt: now,
            deletedAt: b.deletedAt ? new Date(b.deletedAt) : null,
          })
          .where(eq(bookmarks.id, b.id))
          .run();
      } else {
        db.insert(bookmarks)
          .values({
            id: b.id,
            profileId,
            bookId: b.bookId,
            position: b.position,
            title: b.title ?? null,
            note: b.note ?? null,
            color: b.color ?? null,
            createdAt: b.createdAt ? new Date(b.createdAt) : now,
            updatedAt: now,
            deletedAt: b.deletedAt ? new Date(b.deletedAt) : null,
          })
          .run();
      }
    } catch (e: unknown) {
      // Skip FK violations (book doesn't exist on server)
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("FOREIGN KEY")) throw e;
    }
  }

  return c.json({ success: true });
});

// DELETE /api/sync/bookmarks/:id — Soft-delete a bookmark
app.delete("/api/sync/bookmarks/:id", (c) => {
  const profileId = c.get("profileId");
  const bookmarkId = c.req.param("id");

  const existing = db
    .select()
    .from(bookmarks)
    .where(and(eq(bookmarks.id, bookmarkId), eq(bookmarks.profileId, profileId)))
    .get();

  if (!existing) {
    return c.json(
      { success: false, error: "Bookmark not found", code: "NOT_FOUND" },
      404,
    );
  }

  db.update(bookmarks)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(bookmarks.id, bookmarkId))
    .run();

  return c.json({ success: true });
});

// --- Reading Sessions ---

// GET /api/sync/reading-sessions — Get reading sessions for current profile
app.get("/api/sync/reading-sessions", (c) => {
  const profileId = c.get("profileId");
  const bookId = c.req.query("bookId");
  const since = c.req.query("since");

  let conditions = [eq(readingSessions.profileId, profileId)];
  if (bookId) {
    conditions.push(eq(readingSessions.bookId, bookId));
  }

  const results = db
    .select()
    .from(readingSessions)
    .where(and(...conditions))
    .all()
    .filter((row) => {
      if (since) {
        const sinceTs = Math.floor(new Date(since).getTime() / 1000);
        return tsToUnixSeconds(row.startedAt) > sinceTs;
      }
      return true;
    });

  return c.json({
    success: true,
    data: results.map((row) => ({
      id: row.id,
      bookId: row.bookId,
      startedAt: tsToISO(row.startedAt),
      endedAt: tsToISOOrNull(row.endedAt),
      pagesRead: row.pagesRead,
      startPosition: row.startPosition,
      endPosition: row.endPosition,
    })),
  });
});

// POST /api/sync/reading-sessions — Batch insert reading sessions (dedupe by ID)
app.post("/api/sync/reading-sessions", async (c) => {
  const profileId = c.get("profileId");
  const body = await c.req.json<{
    sessions: Array<{
      id: string;
      bookId: string;
      startedAt: string;
      endedAt?: string | null;
      pagesRead?: number | null;
      startPosition?: string | null;
      endPosition?: string | null;
    }>;
  }>();

  for (const s of body.sessions) {
    try {
      // Skip if already exists (dedupe by ID)
      const existing = db
        .select()
        .from(readingSessions)
        .where(eq(readingSessions.id, s.id))
        .get();

      if (existing) continue;

      db.insert(readingSessions)
        .values({
          id: s.id,
          profileId,
          bookId: s.bookId,
          startedAt: new Date(s.startedAt),
          endedAt: s.endedAt ? new Date(s.endedAt) : null,
          pagesRead: s.pagesRead ?? null,
          startPosition: s.startPosition ?? null,
          endPosition: s.endPosition ?? null,
        })
        .run();
    } catch (e: unknown) {
      // Skip FK violations (book doesn't exist on server)
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("FOREIGN KEY")) throw e;
    }
  }

  return c.json({ success: true });
});

export { app as syncRoutes };
