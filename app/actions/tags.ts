"use server";

import { v4 as uuid } from "uuid";
import { db, tags, booksTags, books } from "../lib/db";
import { eq, and, asc, sql, inArray } from "drizzle-orm";
import type { Tag, Book } from "../lib/db/schema";

export async function getTags(profileId?: string): Promise<Tag[]> {
  if (profileId) {
    return db.select().from(tags).where(eq(tags.profileId, profileId)).orderBy(asc(tags.name));
  }
  return db.select().from(tags).orderBy(asc(tags.name));
}

async function getTag(id: string, profileId?: string): Promise<Tag | null> {
  const conditions = [eq(tags.id, id)];
  if (profileId) conditions.push(eq(tags.profileId, profileId));
  const result = await db.select().from(tags).where(and(...conditions)).get();
  return result || null;
}

async function getTagByName(name: string, profileId?: string): Promise<Tag | null> {
  const conditions = [eq(tags.name, name.toLowerCase())];
  if (profileId) conditions.push(eq(tags.profileId, profileId));
  const result = await db.select().from(tags).where(and(...conditions)).get();
  return result || null;
}

async function createTag(data: { name: string; color?: string }, profileId?: string): Promise<Tag> {
  const id = uuid();
  const name = data.name.toLowerCase().trim();

  // Check if tag already exists (for this profile if provided)
  const existing = await getTagByName(name, profileId);
  if (existing) {
    return existing;
  }

  await db.insert(tags).values({
    id,
    profileId: profileId || "default",
    name,
    color: data.color,
  });

  return (await getTag(id, profileId))!;
}

async function addTagToBook(bookId: string, tagId: string): Promise<boolean> {
  try {
    await db.insert(booksTags).values({
      bookId,
      tagId,
    });
    return true;
  } catch {
    // Already exists
    return false;
  }
}

export async function addTagToBookByName(bookId: string, tagName: string, profileId?: string): Promise<Tag | null> {
  // Create or get existing tag (for this profile if provided)
  const tag = await createTag({ name: tagName }, profileId);

  // Add to book
  await addTagToBook(bookId, tag.id);

  return tag;
}

export async function removeTagFromBook(bookId: string, tagId: string, profileId?: string): Promise<boolean> {
  // Verify tag belongs to this profile (if profileId provided)
  const tag = await getTag(tagId, profileId);
  if (!tag) return false;

  await db
    .delete(booksTags)
    .where(sql`${booksTags.bookId} = ${bookId} AND ${booksTags.tagId} = ${tagId}`);
  return true;
}

export async function getBooksWithTag(tagId: string): Promise<Book[]> {
  const bookIds = await db
    .select({ bookId: booksTags.bookId })
    .from(booksTags)
    .where(eq(booksTags.tagId, tagId));

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

export async function getTagsForBook(bookId: string, profileId?: string): Promise<Tag[]> {
  const tagIds = await db
    .select({ tagId: booksTags.tagId })
    .from(booksTags)
    .where(eq(booksTags.bookId, bookId));

  if (tagIds.length === 0) return [];

  const conditions = [
    inArray(
      tags.id,
      tagIds.map((t) => t.tagId),
    ),
  ];
  if (profileId) conditions.push(eq(tags.profileId, profileId));

  return db
    .select()
    .from(tags)
    .where(and(...conditions));
}

export async function getTagsWithCounts(profileId?: string): Promise<Array<Tag & { count: number }>> {
  const allTags = await getTags(profileId);
  const counts = await db
    .select({
      tagId: booksTags.tagId,
      count: sql<number>`count(*)`,
    })
    .from(booksTags)
    .groupBy(booksTags.tagId);

  const countMap = new Map(counts.map((c) => [c.tagId, c.count]));

  return allTags.map((tag) => ({
    ...tag,
    count: countMap.get(tag.id) || 0,
  }));
}
