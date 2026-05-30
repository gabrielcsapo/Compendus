import { Hono } from "hono";
import {
  getCollections,
  getCollectionsForBook,
  addBookToCollection,
  removeBookFromCollection,
  createCollection,
} from "../../app/actions/collections";

const app = new Hono();

// GET /api/collections - list all collections for the current profile
app.get("/api/collections", async (c) => {
  const profileId = c.get("profileId");
  const all = await getCollections(profileId);
  return c.json({ success: true, collections: all });
});

// POST /api/collections - create a new collection
app.post("/api/collections", async (c) => {
  const profileId = c.get("profileId");
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const name = body.name as string;
  if (!name || typeof name !== "string" || name.trim() === "") {
    return c.json({ success: false, error: "Collection name is required" }, 400);
  }

  const collection = await createCollection(
    {
      name: name.trim(),
      description: typeof body.description === "string" ? body.description : undefined,
      color: typeof body.color === "string" ? body.color : undefined,
      icon: typeof body.icon === "string" ? body.icon : undefined,
    },
    profileId,
  );
  return c.json({ success: true, collection });
});

// GET /api/books/:id/collections - collections a book belongs to
app.get("/api/books/:id/collections", async (c) => {
  const profileId = c.get("profileId");
  const id = c.req.param("id");
  const bookCollections = await getCollectionsForBook(id, profileId);
  return c.json({ success: true, collections: bookCollections });
});

// POST /api/books/:id/collections - add a book to a collection (body: { collectionId })
app.post("/api/books/:id/collections", async (c) => {
  const profileId = c.get("profileId");
  const id = c.req.param("id");
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const collectionId = body.collectionId as string;
  if (!collectionId || typeof collectionId !== "string") {
    return c.json({ success: false, error: "collectionId is required" }, 400);
  }

  const result = await addBookToCollection(id, collectionId, profileId);
  // `false` means the collection wasn't found for this profile, or the book was
  // already in it — surface the invalid-collection case as a 404.
  if (!result) {
    const current = await getCollectionsForBook(id, profileId);
    if (current.some((col) => col.id === collectionId)) {
      return c.json({ success: true });
    }
    return c.json({ success: false, error: "Collection not found" }, 404);
  }
  return c.json({ success: true });
});

// DELETE /api/books/:id/collections/:collectionId - remove a book from a collection
app.delete("/api/books/:id/collections/:collectionId", async (c) => {
  const profileId = c.get("profileId");
  const id = c.req.param("id");
  const collectionId = c.req.param("collectionId");
  await removeBookFromCollection(id, collectionId, profileId);
  return c.json({ success: true });
});

export { app as collectionsRoutes };
