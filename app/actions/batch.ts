"use server";

import { db, books, booksTags, tags } from "../lib/db";
import type { Book, Tag } from "../lib/db/schema";
import { eq, asc, sql } from "drizzle-orm";
import { updateBook } from "../actions/books";
import { addTagToBookByName, removeTagFromBook } from "../actions/tags";

interface BatchBookUpdate {
  id: string;
  data?: Partial<{
    title: string;
    series: string;
    seriesNumber: string;
    authors: string;
    bookTypeOverride: string | null;
    language: string;
  }>;
  addTags?: string[];
  removeTags?: string[];
}

export async function batchUpdateBooks(
  updates: BatchBookUpdate[],
): Promise<{ updated: number; errors: string[] }> {
  let updated = 0;
  const errors: string[] = [];

  for (const update of updates) {
    try {
      // Update book fields if data is provided
      if (update.data && Object.keys(update.data).length > 0) {
        const result = await updateBook(update.id, update.data);
        if (!result) {
          errors.push(`Book ${update.id}: not found`);
          continue;
        }
      }

      // Add tags
      if (update.addTags && update.addTags.length > 0) {
        for (const tagName of update.addTags) {
          await addTagToBookByName(update.id, tagName);
        }
      }

      // Remove tags
      if (update.removeTags && update.removeTags.length > 0) {
        for (const tagId of update.removeTags) {
          await removeTagFromBook(update.id, tagId);
        }
      }

      updated++;
    } catch (error) {
      errors.push(
        `Book ${update.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { updated, errors };
}

export async function getDistinctSeries(): Promise<string[]> {
  const results = await db
    .selectDistinct({ series: books.series })
    .from(books)
    .where(sql`${books.series} IS NOT NULL`)
    .orderBy(asc(books.series));

  return results.map((r) => r.series).filter((s): s is string => s !== null);
}

export async function getDistinctAuthors(): Promise<string[]> {
  const results = await db
    .select({ authors: books.authors })
    .from(books)
    .where(sql`${books.authors} IS NOT NULL`);

  const authorSet = new Set<string>();
  for (const row of results) {
    if (!row.authors) continue;
    try {
      const parsed = JSON.parse(row.authors);
      if (Array.isArray(parsed)) {
        for (const a of parsed) {
          if (typeof a === "string" && a.trim()) {
            authorSet.add(a.trim());
          }
        }
      }
    } catch {
      // skip unparseable
    }
  }

  return Array.from(authorSet).sort((a, b) => a.localeCompare(b));
}

export async function getAllBooksWithTags(): Promise<{
  books: Book[];
  bookTags: Record<string, Tag[]>;
}> {
  // Load all books ordered by title
  const allBooks = await db
    .select()
    .from(books)
    .orderBy(asc(books.title));

  // Load all book-tag associations joined with tags
  const allBookTags = await db
    .select({
      bookId: booksTags.bookId,
      tagId: tags.id,
      tagProfileId: tags.profileId,
      tagName: tags.name,
      tagColor: tags.color,
      tagCreatedAt: tags.createdAt,
    })
    .from(booksTags)
    .innerJoin(tags, eq(booksTags.tagId, tags.id));

  // Build the bookTags map
  const bookTagsMap: Record<string, Tag[]> = {};
  for (const row of allBookTags) {
    if (!bookTagsMap[row.bookId]) {
      bookTagsMap[row.bookId] = [];
    }
    bookTagsMap[row.bookId].push({
      id: row.tagId,
      profileId: row.tagProfileId,
      name: row.tagName,
      color: row.tagColor,
      createdAt: row.tagCreatedAt,
    });
  }

  return { books: allBooks, bookTags: bookTagsMap };
}
