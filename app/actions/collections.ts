"use server";

import { v4 as uuid } from "uuid";
import { db, collections, booksCollections, books } from "../lib/db";
import { eq, and, asc, sql, inArray } from "drizzle-orm";
import type { Collection, Book } from "../lib/db/schema";

export async function getCollections(profileId?: string): Promise<Collection[]> {
  if (profileId) {
    return db.select().from(collections).where(eq(collections.profileId, profileId)).orderBy(asc(collections.sortOrder));
  }
  return db.select().from(collections).orderBy(asc(collections.sortOrder));
}

export async function getCollection(id: string, profileId?: string): Promise<Collection | null> {
  const conditions = [eq(collections.id, id)];
  if (profileId) conditions.push(eq(collections.profileId, profileId));
  const result = await db.select().from(collections).where(and(...conditions)).get();
  return result || null;
}

export async function createCollection(data: {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  parentId?: string;
}, profileId?: string): Promise<Collection> {
  const id = uuid();

  // Get max sort order
  const maxOrderQuery = db
    .select({ max: sql<number>`max(sort_order)` })
    .from(collections);
  const maxOrder = profileId
    ? await maxOrderQuery.where(eq(collections.profileId, profileId)).get()
    : await maxOrderQuery.get();

  await db.insert(collections).values({
    id,
    profileId: profileId || "default",
    name: data.name,
    description: data.description,
    color: data.color,
    icon: data.icon,
    parentId: data.parentId,
    sortOrder: (maxOrder?.max || 0) + 1,
  });

  return (await getCollection(id, profileId))!;
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
  profileId?: string,
): Promise<Collection | null> {
  const conditions = [eq(collections.id, id)];
  if (profileId) conditions.push(eq(collections.profileId, profileId));

  await db
    .update(collections)
    .set({ ...data, updatedAt: sql`(unixepoch())` })
    .where(and(...conditions));

  return getCollection(id, profileId);
}

export async function deleteCollection(id: string, profileId?: string): Promise<boolean> {
  const conditions = [eq(collections.id, id)];
  if (profileId) conditions.push(eq(collections.profileId, profileId));
  await db.delete(collections).where(and(...conditions));
  return true;
}

export async function addBookToCollection(bookId: string, collectionId: string, profileId?: string): Promise<boolean> {
  // Verify collection belongs to this profile (if profileId provided)
  const collection = await getCollection(collectionId, profileId);
  if (!collection) return false;

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
  profileId?: string,
): Promise<boolean> {
  // Verify collection belongs to this profile (if profileId provided)
  const collection = await getCollection(collectionId, profileId);
  if (!collection) return false;

  await db
    .delete(booksCollections)
    .where(
      sql`${booksCollections.bookId} = ${bookId} AND ${booksCollections.collectionId} = ${collectionId}`,
    );
  return true;
}

export async function getBooksInCollection(collectionId: string, profileId?: string): Promise<Book[]> {
  // Verify collection belongs to this profile (if profileId provided)
  const collection = await getCollection(collectionId, profileId);
  if (!collection) return [];

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

export async function getCollectionsForBook(bookId: string, profileId?: string): Promise<Collection[]> {
  const collectionIds = await db
    .select({ collectionId: booksCollections.collectionId })
    .from(booksCollections)
    .where(eq(booksCollections.bookId, bookId));

  if (collectionIds.length === 0) return [];

  const conditions = [
    inArray(
      collections.id,
      collectionIds.map((c) => c.collectionId),
    ),
  ];
  if (profileId) conditions.push(eq(collections.profileId, profileId));

  return db
    .select()
    .from(collections)
    .where(and(...conditions));
}

export async function getCollectionBookCount(collectionId: string, profileId?: string): Promise<number> {
  // Verify collection belongs to this profile (if profileId provided)
  const collection = await getCollection(collectionId, profileId);
  if (!collection) return 0;

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(booksCollections)
    .where(eq(booksCollections.collectionId, collectionId))
    .get();
  return result?.count || 0;
}
