"use server";

import { v4 as uuid } from "uuid";
import { db, wantedBooks, books } from "../lib/db";
import { eq, desc, sql, and, or } from "drizzle-orm";
import type { WantedBook } from "../lib/db/schema.js";
import type { MetadataSearchResult } from "../lib/metadata/index.js";

export async function getWantedBooks(options?: {
  status?: WantedBook["status"];
  series?: string;
  limit?: number;
  filterOwned?: boolean; // Default true - removes books now in library
}, profileId?: string): Promise<{ books: WantedBook[]; removed: number }> {
  const filterOwned = options?.filterOwned !== false;

  let query = db.select().from(wantedBooks).$dynamic();

  const conditions = [];
  if (profileId) {
    conditions.push(eq(wantedBooks.profileId, profileId));
  }
  if (options?.status) {
    conditions.push(eq(wantedBooks.status, options.status));
  }
  if (options?.series) {
    conditions.push(eq(wantedBooks.series, options.series));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  query = query.orderBy(
    desc(wantedBooks.priority),
    desc(wantedBooks.createdAt),
  );

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const allBooks = await query;

  if (!filterOwned) {
    return { books: allBooks, removed: 0 };
  }

  // Filter out books that are now in the library
  const idsToRemove: string[] = [];
  const filteredBooks: WantedBook[] = [];

  for (const book of allBooks) {
    let isOwned = false;

    // First try matching by ISBN (most accurate)
    const isbnConditions = [];
    if (book.isbn13) isbnConditions.push(eq(books.isbn13, book.isbn13));
    if (book.isbn10) isbnConditions.push(eq(books.isbn10, book.isbn10));
    if (book.isbn) isbnConditions.push(eq(books.isbn, book.isbn));

    if (isbnConditions.length > 0) {
      const owned = await db
        .select({ id: books.id })
        .from(books)
        .where(or(...isbnConditions))
        .get();
      isOwned = !!owned;
    }

    // Fallback: match by exact title (case-insensitive)
    if (!isOwned && book.title) {
      const ownedByTitle = await db
        .select({ id: books.id })
        .from(books)
        .where(sql`lower(${books.title}) = lower(${book.title})`)
        .get();
      isOwned = !!ownedByTitle;
    }

    if (isOwned) {
      idsToRemove.push(book.id);
    } else {
      filteredBooks.push(book);
    }
  }

  // Remove owned books from wishlist
  for (const id of idsToRemove) {
    await db.delete(wantedBooks).where(eq(wantedBooks.id, id));
  }

  return { books: filteredBooks, removed: idsToRemove.length };
}

async function getWantedBook(id: string, profileId?: string): Promise<WantedBook | null> {
  const conditions = [eq(wantedBooks.id, id)];
  if (profileId) {
    conditions.push(eq(wantedBooks.profileId, profileId));
  }
  const result = await db
    .select()
    .from(wantedBooks)
    .where(and(...conditions))
    .get();
  return result || null;
}

export async function addToWantedList(
  metadata: MetadataSearchResult,
  options?: {
    status?: WantedBook["status"];
    priority?: number;
    notes?: string;
  },
  profileId?: string,
): Promise<WantedBook> {
  const id = uuid();

  // Check if already in wanted list by source
  if (metadata.sourceId) {
    const sourceConditions = [
      eq(wantedBooks.source, metadata.source),
      eq(wantedBooks.sourceId, metadata.sourceId),
    ];
    if (profileId) {
      sourceConditions.push(eq(wantedBooks.profileId, profileId));
    }

    const existingBySource = await db
      .select()
      .from(wantedBooks)
      .where(and(...sourceConditions))
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
    profileId: profileId!,
    title: metadata.title,
    subtitle: metadata.subtitle,
    authors:
      metadata.authors.length > 0 ? JSON.stringify(metadata.authors) : null,
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

  return (await getWantedBook(id, profileId))!;
}

export async function updateWantedBook(
  id: string,
  data: Partial<{
    status: WantedBook["status"];
    priority: number;
    notes: string;
  }>,
  profileId?: string,
): Promise<WantedBook | null> {
  const conditions = [eq(wantedBooks.id, id)];
  if (profileId) {
    conditions.push(eq(wantedBooks.profileId, profileId));
  }

  await db
    .update(wantedBooks)
    .set({ ...data, updatedAt: sql`(unixepoch())` })
    .where(and(...conditions));

  return getWantedBook(id, profileId);
}

export async function removeFromWantedList(id: string, profileId?: string): Promise<boolean> {
  const conditions = [eq(wantedBooks.id, id)];
  if (profileId) {
    conditions.push(eq(wantedBooks.profileId, profileId));
  }
  await db.delete(wantedBooks).where(and(...conditions));
  return true;
}

export async function clearWantedList(profileId?: string): Promise<number> {
  if (profileId) {
    const result = await db.delete(wantedBooks).where(eq(wantedBooks.profileId, profileId)).returning({ id: wantedBooks.id });
    return result.length;
  }
  const result = await db.delete(wantedBooks).returning({ id: wantedBooks.id });
  return result.length;
}

export async function isBookWanted(
  metadata: MetadataSearchResult,
  profileId?: string,
): Promise<boolean> {
  // Check by source ID
  if (metadata.sourceId) {
    const sourceConditions = [
      eq(wantedBooks.source, metadata.source),
      eq(wantedBooks.sourceId, metadata.sourceId),
    ];
    if (profileId) {
      sourceConditions.push(eq(wantedBooks.profileId, profileId));
    }

    const bySource = await db
      .select()
      .from(wantedBooks)
      .where(and(...sourceConditions))
      .get();

    if (bySource) return true;
  }

  // Check by ISBN
  if (metadata.isbn13 || metadata.isbn10) {
    const conditions = [];
    if (metadata.isbn13)
      conditions.push(eq(wantedBooks.isbn13, metadata.isbn13));
    if (metadata.isbn10)
      conditions.push(eq(wantedBooks.isbn10, metadata.isbn10));

    if (profileId) {
      const byIsbn = await db
        .select()
        .from(wantedBooks)
        .where(and(or(...conditions), eq(wantedBooks.profileId, profileId)))
        .get();

      if (byIsbn) return true;
    } else {
      const byIsbn = await db
        .select()
        .from(wantedBooks)
        .where(or(...conditions))
        .get();

      if (byIsbn) return true;
    }
  }

  return false;
}

export async function isBookOwned(
  metadata: MetadataSearchResult,
): Promise<boolean> {
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
