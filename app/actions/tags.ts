"use server";

import { v4 as uuid } from "uuid";
import { db, tags, booksTags, books } from "../lib/db";
import { eq, asc, sql, inArray } from "drizzle-orm";
import type { Tag, Book } from "../lib/db/schema";

export async function getTags(): Promise<Tag[]> {
  return db.select().from(tags).orderBy(asc(tags.name));
}

export async function getTag(id: string): Promise<Tag | null> {
  const result = await db.select().from(tags).where(eq(tags.id, id)).get();
  return result || null;
}

export async function getTagByName(name: string): Promise<Tag | null> {
  const result = await db.select().from(tags).where(eq(tags.name, name.toLowerCase())).get();
  return result || null;
}

export async function createTag(data: { name: string; color?: string }): Promise<Tag> {
  const id = uuid();
  const name = data.name.toLowerCase().trim();

  // Check if tag already exists
  const existing = await getTagByName(name);
  if (existing) {
    return existing;
  }

  await db.insert(tags).values({
    id,
    name,
    color: data.color,
  });

  return (await getTag(id))!;
}

export async function updateTag(
  id: string,
  data: Partial<{ name: string; color: string }>,
): Promise<Tag | null> {
  const updateData: Record<string, unknown> = {};
  if (data.name) updateData.name = data.name.toLowerCase().trim();
  if (data.color) updateData.color = data.color;

  await db.update(tags).set(updateData).where(eq(tags.id, id));

  return getTag(id);
}

export async function deleteTag(id: string): Promise<boolean> {
  await db.delete(tags).where(eq(tags.id, id));
  return true;
}

export async function addTagToBook(bookId: string, tagId: string): Promise<boolean> {
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

export async function addTagToBookByName(bookId: string, tagName: string): Promise<Tag | null> {
  // Create or get existing tag
  const tag = await createTag({ name: tagName });

  // Add to book
  await addTagToBook(bookId, tag.id);

  return tag;
}

export async function removeTagFromBook(bookId: string, tagId: string): Promise<boolean> {
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

export async function getTagsForBook(bookId: string): Promise<Tag[]> {
  const tagIds = await db
    .select({ tagId: booksTags.tagId })
    .from(booksTags)
    .where(eq(booksTags.bookId, bookId));

  if (tagIds.length === 0) return [];

  return db
    .select()
    .from(tags)
    .where(
      inArray(
        tags.id,
        tagIds.map((t) => t.tagId),
      ),
    );
}

export async function getTagBookCount(tagId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(booksTags)
    .where(eq(booksTags.tagId, tagId))
    .get();
  return result?.count || 0;
}

export async function getTagsWithCounts(): Promise<Array<Tag & { count: number }>> {
  const allTags = await getTags();
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
