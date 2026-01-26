"use server";

import { v4 as uuid } from "uuid";
import { db, collections, booksCollections, books } from "../lib/db";
import { eq, asc, sql, inArray } from "drizzle-orm";
import type { Collection, Book } from "../lib/db/schema";

export async function getCollections(): Promise<Collection[]> {
  return db.select().from(collections).orderBy(asc(collections.sortOrder));
}

export async function getCollection(id: string): Promise<Collection | null> {
  const result = await db.select().from(collections).where(eq(collections.id, id)).get();
  return result || null;
}

export async function createCollection(data: {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  parentId?: string;
}): Promise<Collection> {
  const id = uuid();

  // Get max sort order
  const maxOrder = await db
    .select({ max: sql<number>`max(sort_order)` })
    .from(collections)
    .get();

  await db.insert(collections).values({
    id,
    name: data.name,
    description: data.description,
    color: data.color,
    icon: data.icon,
    parentId: data.parentId,
    sortOrder: (maxOrder?.max || 0) + 1,
  });

  return (await getCollection(id))!;
}

export async function updateCollection(
  id: string,
  data: Partial<{
    name: string;
    description: string;
    color: string;
    icon: string;
    sortOrder: number;
    parentId: string;
  }>,
): Promise<Collection | null> {
  await db
    .update(collections)
    .set({ ...data, updatedAt: sql`(unixepoch())` })
    .where(eq(collections.id, id));

  return getCollection(id);
}

export async function deleteCollection(id: string): Promise<boolean> {
  await db.delete(collections).where(eq(collections.id, id));
  return true;
}

export async function addBookToCollection(bookId: string, collectionId: string): Promise<boolean> {
  try {
    await db.insert(booksCollections).values({
      bookId,
      collectionId,
    });
    return true;
  } catch {
    // Already exists
    return false;
  }
}

export async function removeBookFromCollection(
  bookId: string,
  collectionId: string,
): Promise<boolean> {
  await db
    .delete(booksCollections)
    .where(
      sql`${booksCollections.bookId} = ${bookId} AND ${booksCollections.collectionId} = ${collectionId}`,
    );
  return true;
}

export async function getBooksInCollection(collectionId: string): Promise<Book[]> {
  const bookIds = await db
    .select({ bookId: booksCollections.bookId })
    .from(booksCollections)
    .where(eq(booksCollections.collectionId, collectionId));

  if (bookIds.length === 0) return [];

  return db
    .select()
    .from(books)
    .where(
      inArray(
        books.id,
        bookIds.map((b) => b.bookId),
      ),
    );
}

export async function getCollectionsForBook(bookId: string): Promise<Collection[]> {
  const collectionIds = await db
    .select({ collectionId: booksCollections.collectionId })
    .from(booksCollections)
    .where(eq(booksCollections.bookId, bookId));

  if (collectionIds.length === 0) return [];

  return db
    .select()
    .from(collections)
    .where(
      inArray(
        collections.id,
        collectionIds.map((c) => c.collectionId),
      ),
    );
}

export async function getCollectionBookCount(collectionId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(booksCollections)
    .where(eq(booksCollections.collectionId, collectionId))
    .get();
  return result?.count || 0;
}
