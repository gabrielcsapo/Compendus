"use server";

import { v4 as uuid } from "uuid";
import { db, wantedBooks, books } from "../lib/db";
import { eq, desc, sql, and, or } from "drizzle-orm";
import type { WantedBook } from "../lib/db/schema";
import type { MetadataSearchResult } from "../lib/metadata";

export async function getWantedBooks(options?: {
  status?: WantedBook["status"];
  series?: string;
  limit?: number;
}): Promise<WantedBook[]> {
  let query = db.select().from(wantedBooks).$dynamic();

  const conditions = [];
  if (options?.status) {
    conditions.push(eq(wantedBooks.status, options.status));
  }
  if (options?.series) {
    conditions.push(eq(wantedBooks.series, options.series));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  query = query.orderBy(desc(wantedBooks.priority), desc(wantedBooks.createdAt));

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  return query;
}

export async function getWantedBook(id: string): Promise<WantedBook | null> {
  const result = await db.select().from(wantedBooks).where(eq(wantedBooks.id, id)).get();
  return result || null;
}

export async function addToWantedList(
  metadata: MetadataSearchResult,
  options?: {
    status?: WantedBook["status"];
    priority?: number;
    notes?: string;
  },
): Promise<WantedBook> {
  const id = uuid();

  // Check if already in wanted list by source
  if (metadata.sourceId) {
    const existingBySource = await db
      .select()
      .from(wantedBooks)
      .where(
        and(eq(wantedBooks.source, metadata.source), eq(wantedBooks.sourceId, metadata.sourceId)),
      )
      .get();

    if (existingBySource) {
      throw new Error("Book is already in your wanted list");
    }
  }

  // Check if already in library by ISBN
  if (metadata.isbn13 || metadata.isbn10 || metadata.isbn) {
    const conditions = [];
    if (metadata.isbn13) conditions.push(eq(books.isbn13, metadata.isbn13));
    if (metadata.isbn10) conditions.push(eq(books.isbn10, metadata.isbn10));
    if (metadata.isbn) conditions.push(eq(books.isbn, metadata.isbn));

    const inLibrary = await db
      .select()
      .from(books)
      .where(or(...conditions))
      .get();

    if (inLibrary) {
      throw new Error("You already own this book");
    }
  }

  await db.insert(wantedBooks).values({
    id,
    title: metadata.title,
    subtitle: metadata.subtitle,
    authors: metadata.authors.length > 0 ? JSON.stringify(metadata.authors) : null,
    publisher: metadata.publisher,
    publishedDate: metadata.publishedDate,
    description: metadata.description,
    isbn: metadata.isbn,
    isbn13: metadata.isbn13,
    isbn10: metadata.isbn10,
    language: metadata.language,
    pageCount: metadata.pageCount,
    series: metadata.series,
    seriesNumber: metadata.seriesNumber,
    coverUrl: metadata.coverUrl,
    source: metadata.source,
    sourceId: metadata.sourceId,
    status: options?.status || "wishlist",
    priority: options?.priority || 0,
    notes: options?.notes,
  });

  return (await getWantedBook(id))!;
}

export async function updateWantedBook(
  id: string,
  data: Partial<{
    status: WantedBook["status"];
    priority: number;
    notes: string;
  }>,
): Promise<WantedBook | null> {
  await db
    .update(wantedBooks)
    .set({ ...data, updatedAt: sql`(unixepoch())` })
    .where(eq(wantedBooks.id, id));

  return getWantedBook(id);
}

export async function removeFromWantedList(id: string): Promise<boolean> {
  await db.delete(wantedBooks).where(eq(wantedBooks.id, id));
  return true;
}

export async function getWantedBooksCount(status?: WantedBook["status"]): Promise<number> {
  let query = db
    .select({ count: sql<number>`count(*)` })
    .from(wantedBooks)
    .$dynamic();

  if (status) {
    query = query.where(eq(wantedBooks.status, status));
  }

  const result = await query.get();
  return result?.count || 0;
}

export async function isBookWanted(metadata: MetadataSearchResult): Promise<boolean> {
  // Check by source ID
  if (metadata.sourceId) {
    const bySource = await db
      .select()
      .from(wantedBooks)
      .where(
        and(eq(wantedBooks.source, metadata.source), eq(wantedBooks.sourceId, metadata.sourceId)),
      )
      .get();

    if (bySource) return true;
  }

  // Check by ISBN
  if (metadata.isbn13 || metadata.isbn10) {
    const conditions = [];
    if (metadata.isbn13) conditions.push(eq(wantedBooks.isbn13, metadata.isbn13));
    if (metadata.isbn10) conditions.push(eq(wantedBooks.isbn10, metadata.isbn10));

    const byIsbn = await db
      .select()
      .from(wantedBooks)
      .where(or(...conditions))
      .get();

    if (byIsbn) return true;
  }

  return false;
}

export async function isBookOwned(metadata: MetadataSearchResult): Promise<boolean> {
  if (!metadata.isbn13 && !metadata.isbn10 && !metadata.isbn) {
    return false;
  }

  const conditions = [];
  if (metadata.isbn13) conditions.push(eq(books.isbn13, metadata.isbn13));
  if (metadata.isbn10) conditions.push(eq(books.isbn10, metadata.isbn10));
  if (metadata.isbn) conditions.push(eq(books.isbn, metadata.isbn));

  const owned = await db
    .select()
    .from(books)
    .where(or(...conditions))
    .get();

  return !!owned;
}
