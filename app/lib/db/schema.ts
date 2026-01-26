import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Books table
export const books = sqliteTable(
  "books",
  {
    id: text("id").primaryKey(),

    // File information
    filePath: text("file_path").notNull(),
    fileName: text("file_name").notNull(),
    fileSize: integer("file_size").notNull(),
    fileHash: text("file_hash").notNull(),
    format: text("format", { enum: ["pdf", "epub", "mobi", "cbr", "cbz"] }).notNull(),
    mimeType: text("mime_type").notNull(),

    // Metadata
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    authors: text("authors"), // JSON array
    publisher: text("publisher"),
    publishedDate: text("published_date"),
    description: text("description"),
    isbn: text("isbn"),
    isbn13: text("isbn13"),
    isbn10: text("isbn10"),
    language: text("language"),
    pageCount: integer("page_count"),
    series: text("series"),
    seriesNumber: text("series_number"),

    // Cover image
    coverPath: text("cover_path"),
    coverColor: text("cover_color"),

    // Metadata matching
    matchSkipped: integer("match_skipped", { mode: "boolean" }).default(false),

    // Reading state
    readingProgress: real("reading_progress").default(0),
    lastReadAt: integer("last_read_at", { mode: "timestamp" }),
    lastPosition: text("last_position"),

    // Timestamps
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    importedAt: integer("imported_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("idx_books_title").on(table.title),
    index("idx_books_format").on(table.format),
    index("idx_books_created_at").on(table.createdAt),
    index("idx_books_last_read_at").on(table.lastReadAt),
    uniqueIndex("idx_books_file_hash").on(table.fileHash),
  ],
);

// Collections table
export const collections = sqliteTable(
  "collections",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    color: text("color"),
    icon: text("icon"),
    sortOrder: integer("sort_order").default(0),
    parentId: text("parent_id"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("idx_collections_parent").on(table.parentId),
    uniqueIndex("idx_collections_name").on(table.name),
  ],
);

// Books to Collections junction table
export const booksCollections = sqliteTable(
  "books_collections",
  {
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    addedAt: integer("added_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("idx_bc_book").on(table.bookId),
    index("idx_bc_collection").on(table.collectionId),
  ],
);

// Tags table
export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    color: text("color"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [uniqueIndex("idx_tags_name").on(table.name)],
);

// Books to Tags junction table
export const booksTags = sqliteTable(
  "books_tags",
  {
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    addedAt: integer("added_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index("idx_bt_book").on(table.bookId), index("idx_bt_tag").on(table.tagId)],
);

// Bookmarks table
export const bookmarks = sqliteTable(
  "bookmarks",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    position: text("position").notNull(),
    title: text("title"),
    note: text("note"),
    color: text("color"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index("idx_bookmarks_book").on(table.bookId)],
);

// Highlights table
export const highlights = sqliteTable(
  "highlights",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    startPosition: text("start_position").notNull(),
    endPosition: text("end_position").notNull(),
    text: text("text").notNull(),
    note: text("note"),
    color: text("color").default("#ffff00"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index("idx_highlights_book").on(table.bookId)],
);

// Reading sessions table (for statistics)
export const readingSessions = sqliteTable(
  "reading_sessions",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp" }),
    pagesRead: integer("pages_read"),
    startPosition: text("start_position"),
    endPosition: text("end_position"),
  },
  (table) => [
    index("idx_sessions_book").on(table.bookId),
    index("idx_sessions_started").on(table.startedAt),
  ],
);

// Type exports
export type Book = typeof books.$inferSelect;
export type NewBook = typeof books.$inferInsert;
export type Collection = typeof collections.$inferSelect;
export type NewCollection = typeof collections.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type Bookmark = typeof bookmarks.$inferSelect;
export type Highlight = typeof highlights.$inferSelect;
export type ReadingSession = typeof readingSessions.$inferSelect;
