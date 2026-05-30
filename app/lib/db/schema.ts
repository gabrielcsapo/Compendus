import {
  sqliteTable,
  text,
  integer,
  real,
  blob,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Profiles table - Netflix-style user profiles
export const profiles = sqliteTable(
  "profiles",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    avatar: text("avatar"), // emoji character or relative path to uploaded image
    pinHash: text("pin_hash"), // "salt:sha256hash", null = no PIN
    isAdmin: integer("is_admin", { mode: "boolean" }).default(false),
    /** User-set daily reading goal in minutes (powers the goal ring + celebrations). */
    dailyGoalMinutes: integer("daily_goal_minutes").notNull().default(15),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [uniqueIndex("idx_profiles_name").on(table.name)],
);

// Per-user reading state for each book (replaces reading state columns on books table)
export const userBookState = sqliteTable(
  "user_book_state",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    readingProgress: real("reading_progress").default(0),
    lastReadAt: integer("last_read_at", { mode: "timestamp" }),
    lastPosition: text("last_position"), // JSON: {type, spineIndex, charOffset, progress} or {type, page, progress}
    isRead: integer("is_read", { mode: "boolean" }).default(false),
    rating: integer("rating"), // 1-5, null = unrated
    review: text("review"), // free-text, null = no review
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex("idx_ubs_profile_book").on(table.profileId, table.bookId),
    index("idx_ubs_profile").on(table.profileId),
    index("idx_ubs_book").on(table.bookId),
    index("idx_ubs_last_read").on(table.lastReadAt),
  ],
);

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
    // Format is derived from fileName extension (virtual generated column)
    format: text("format")
      .notNull()
      .generatedAlwaysAs(
        sql`CASE
          WHEN file_name LIKE '%.pdf' THEN 'pdf'
          WHEN file_name LIKE '%.epub' THEN 'epub'
          WHEN file_name LIKE '%.mobi' THEN 'mobi'
          WHEN file_name LIKE '%.azw3' THEN 'azw3'
          WHEN file_name LIKE '%.azw' THEN 'mobi'
          WHEN file_name LIKE '%.cbr' THEN 'cbr'
          WHEN file_name LIKE '%.cbz' THEN 'cbz'
          WHEN file_name LIKE '%.m4b' THEN 'm4b'
          WHEN file_name LIKE '%.mp3' THEN 'mp3'
          WHEN file_name LIKE '%.m4a' THEN 'm4a'
          ELSE 'unknown'
        END`,
      ),
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

    // Audiobook-specific fields
    duration: integer("duration"), // Duration in seconds
    narrator: text("narrator"), // Narrator name
    chapters: text("chapters"), // JSON array of AudioChapter

    // Cover image
    coverPath: text("cover_path"),
    coverColor: text("cover_color"),

    // Metadata matching
    matchSkipped: integer("match_skipped", { mode: "boolean" }).default(false),

    // Book type override - allows treating a book as a different type (e.g., epub as comic)
    bookTypeOverride: text("book_type_override"),

    // Converted EPUB (for PDF → EPUB conversion)
    convertedEpubPath: text("converted_epub_path"),
    convertedEpubSize: integer("converted_epub_size"),

    // Audiobook transcript (from Whisper transcription)
    transcriptPath: text("transcript_path"),

    // Reading state
    readingProgress: real("reading_progress").default(0),
    lastReadAt: integer("last_read_at", { mode: "timestamp" }),
    lastPosition: text("last_position"),
    isRead: integer("is_read", { mode: "boolean" }).default(false),
    rating: integer("rating"), // 1-5, null = unrated
    review: text("review"), // free-text, null = no review

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
    index("idx_books_isbn").on(table.isbn),
    index("idx_books_isbn13").on(table.isbn13),
    index("idx_books_isbn10").on(table.isbn10),
    index("idx_books_series").on(table.series),
  ],
);

// Collections table
export const collections = sqliteTable(
  "collections",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
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
    uniqueIndex("idx_collections_name_profile").on(table.name, table.profileId),
    index("idx_collections_profile").on(table.profileId),
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
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex("idx_tags_name_profile").on(table.name, table.profileId),
    index("idx_tags_profile").on(table.profileId),
  ],
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
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
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
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    index("idx_bookmarks_book").on(table.bookId),
    index("idx_bookmarks_profile").on(table.profileId),
  ],
);

// Highlights table
export const highlights = sqliteTable(
  "highlights",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
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
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    index("idx_highlights_book").on(table.bookId),
    index("idx_highlights_profile").on(table.profileId),
  ],
);

// Reading sessions table (for statistics)
export const readingSessions = sqliteTable(
  "reading_sessions",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
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
    index("idx_sessions_profile").on(table.profileId),
  ],
);

// Wanted Books table - books the user wants but doesn't own yet
export const wantedBooks = sqliteTable(
  "wanted_books",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    // Metadata from external APIs
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

    // Cover from external source (URL, not local path)
    coverUrl: text("cover_url"),

    // External source tracking
    source: text("source", { enum: ["openlibrary", "googlebooks", "metron", "manual"] }).notNull(),
    sourceId: text("source_id"),

    // Status tracking
    status: text("status", { enum: ["wishlist", "searching", "ordered"] })
      .notNull()
      .default("wishlist"),
    priority: integer("priority").default(0), // 0 = normal, 1 = high, 2 = critical
    notes: text("notes"),

    // Timestamps
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("idx_wanted_books_series").on(table.series),
    index("idx_wanted_books_status").on(table.status),
    uniqueIndex("idx_wanted_books_source").on(table.source, table.sourceId),
    index("idx_wanted_books_profile").on(table.profileId),
  ],
);

// Background jobs queue (persistent job tracking for long-running tasks)
export const backgroundJobs = sqliteTable(
  "background_jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(), // "transcribe" | "convert"
    status: text("status").notNull().default("pending"), // pending | running | completed | error
    progress: integer("progress").default(0),
    message: text("message"),
    payload: text("payload"), // JSON: job-specific input data
    result: text("result"), // JSON: result or error details
    logs: text("logs"), // Captured stdout/stderr output
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("idx_background_jobs_status").on(table.status),
    index("idx_background_jobs_created_at").on(table.createdAt),
  ],
);

// Book edits audit table (tracks every field-level change for rollback)
export const bookEdits = sqliteTable(
  "book_edits",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    profileId: text("profile_id"), // nullable - who made the edit (null for system/metadata edits)
    editGroupId: text("edit_group_id").notNull(), // Groups fields changed in same operation
    field: text("field").notNull(), // Column name that changed
    oldValue: text("old_value"), // JSON-encoded previous value (null if was empty)
    newValue: text("new_value"), // JSON-encoded new value (null if cleared)
    source: text("source").notNull(), // "web" | "ios" | "api" | "metadata"
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("idx_book_edits_book_id").on(table.bookId),
    index("idx_book_edits_group").on(table.editGroupId),
    index("idx_book_edits_created_at").on(table.createdAt),
  ],
);

// Book subjects (auto-populated from OpenLibrary/Google Books metadata)
export const bookSubjects = sqliteTable(
  "book_subjects",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
  },
  (table) => [
    uniqueIndex("idx_book_subjects_book_subject").on(table.bookId, table.subject),
    index("idx_book_subjects_subject").on(table.subject),
    index("idx_book_subjects_book").on(table.bookId),
  ],
);

// ---------------------------------------------------------------------------
// Living Library: a knowledge graph extracted from book content.
//
// Entities and relationships are library-global (shared across profiles, like
// `books`). The defining invariant: nothing enters the graph without a passage
// to back it — every mention and every relationship cites a `passages` row, so
// every connection is explainable and traceable to real source text.
// ---------------------------------------------------------------------------

/** Closed set of entity types the extractor classifies into. Extend as needed. */
export const ENTITY_TYPES = [
  "person",
  "place",
  "organization",
  "event",
  "work",
  "object",
  "invention",
  "concept",
  "theme",
  "era",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

// Passages: the provenance anchor. A contiguous chunk of book text stored with
// the same location keys the reader uses, so "jump to source" reuses existing
// reader navigation (epub: spineIndex + charOffset; pdf: page).
export const passages = sqliteTable(
  "passages",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    // Position — mirrors reader lastPosition ({spineIndex, charOffset} | {page})
    spineIndex: integer("spine_index"), // epub spine item index (null for pdf)
    page: integer("page"), // pdf page (null for epub)
    charStart: integer("char_start"), // offset within the spine item / chapter
    charEnd: integer("char_end"),
    ordinal: integer("ordinal").notNull(), // sequential order within the book
    chapterTitle: text("chapter_title"),
    text: text("text").notNull(),
    tokenCount: integer("token_count"),
    embedding: blob("embedding"), // Float32 vector (buffer); null until embedded
    embeddingModel: text("embedding_model"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("idx_passages_book").on(table.bookId),
    index("idx_passages_book_ordinal").on(table.bookId, table.ordinal),
  ],
);

// Entities: the IMMUTABLE extraction layer. One row per distinct thing GLiNER/
// YAKE extracted, keyed by a deterministic stable id (hash of type+normalized
// name). resolve() only ever INSERTS here — it never merges or deletes. Identity
// decisions (which extracted entities are "the same" canonical node, which are
// noise to hide) live entirely in `entity_canonical` below, so the graph can be
// re-clustered, re-tuned, and corrected without ever mutating this record. The
// `mention_count`/`book_count` here are a per-extraction cache; canonical-level
// counts are aggregated through the mapping (see the resolved view).
export const entities = sqliteTable(
  "entities",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: ENTITY_TYPES }).notNull(),
    canonicalName: text("canonical_name").notNull(), // surface form as extracted
    normalizedName: text("normalized_name").notNull(), // lowercased/stripped, for matching
    aliases: text("aliases"), // JSON array of alternate surface forms
    summary: text("summary"), // short generated description (optional)
    embedding: blob("embedding"), // entity-level vector for resolution / neighbors
    mentionCount: integer("mention_count").notNull().default(0),
    bookCount: integer("book_count").notNull().default(0),
    salience: real("salience"), // computed centrality, optional
    // Temporal anchoring (events / people / eras); normalized for sorting, negative = BCE
    startYear: integer("start_year"),
    endYear: integer("end_year"),
    dateText: text("date_text"), // raw, e.g. "49 BC", "c. 1450"
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("idx_entities_type").on(table.type),
    index("idx_entities_normalized").on(table.normalizedName),
    index("idx_entities_type_normalized").on(table.type, table.normalizedName),
  ],
);

// Entity canonical mapping: the derived "identity" layer (the pivot). Exactly one
// row per extracted entity. IDENTITY IS ASSERTED CONSERVATIVELY: `canonicalId`
// points at self by default and is ONLY ever pointed elsewhere by a human-pinned
// merge — automatic heuristics never assert identity (they emit candidate links,
// see entityCandidateLinks). Exact-name duplicates collapse for free at the
// extraction layer (same normalized name → same stable id), so no auto-merge is
// needed for the one case we can be certain about. `excluded` hides an extracted
// entity (e.g. classified noise) WITHOUT deleting it. `pinned` marks the human
// decision. Rebuilding identity = recomputing these rows; extraction never
// changes, so it's idempotent and fully reversible.
export const entityCanonical = sqliteTable(
  "entity_canonical",
  {
    entityId: text("entity_id")
      .primaryKey()
      .references(() => entities.id, { onDelete: "cascade" }),
    canonicalId: text("canonical_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    method: text("method").notNull().default("self"), // self | pinned (heuristics no longer merge here)
    score: real("score"), // similarity that drove a pinned merge, when applicable
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    excluded: integer("excluded", { mode: "boolean" }).notNull().default(false),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("idx_canonical_canonical").on(table.canonicalId),
    index("idx_canonical_excluded").on(table.excluded),
  ],
);

// Probable-duplicate candidate links: heuristics (person-name variants, near-
// identical name embeddings) PROPOSE that two extracted entities might be the
// same, as a graph EDGE rather than a merge. This never asserts identity — it
// surfaces "related, possibly same" suggestions in wander and is the queue a
// human promotes to a real pin. `status`: open (proposed) | confirmed (a person
// accepted it → drives a pin) | rejected (a person said no → suppress future
// proposals). Recomputed on each mapping rebuild for `open` rows; confirmed/
// rejected human verdicts are preserved.
export const entityCandidateLinks = sqliteTable(
  "entity_candidate_links",
  {
    id: text("id").primaryKey(),
    // Ordered (a < b by id) so the pair is unique regardless of discovery order.
    entityA: text("entity_a")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    entityB: text("entity_b")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    method: text("method").notNull(), // person_name | embedding
    score: real("score"), // similarity / confidence behind the proposal
    status: text("status").notNull().default("open"), // open | confirmed | rejected
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex("idx_candidate_pair").on(table.entityA, table.entityB),
    index("idx_candidate_a").on(table.entityA),
    index("idx_candidate_b").on(table.entityB),
    index("idx_candidate_status").on(table.status),
  ],
);

// Entity mentions: every occurrence of an entity, anchored to a passage.
export const entityMentions = sqliteTable(
  "entity_mentions",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    passageId: text("passage_id")
      .notNull()
      .references(() => passages.id, { onDelete: "cascade" }),
    // Denormalized for fast per-book queries (e.g. "this entity across N books")
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    surfaceText: text("surface_text").notNull(), // exact text as it appeared
    charStart: integer("char_start"), // offset within the passage
    charEnd: integer("char_end"),
    role: text("role"), // optional role (e.g. within an event)
    confidence: real("confidence"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("idx_mentions_entity").on(table.entityId),
    index("idx_mentions_passage").on(table.passageId),
    index("idx_mentions_book").on(table.bookId),
    index("idx_mentions_entity_book").on(table.entityId, table.bookId),
  ],
);

// Entity relationships: edges between entities, each backed by a passage.
// `type` is free-text (the Tier-1 set is documented in the extractor); `tier`
// records which extraction pass produced it, so we can filter by reliability.
// `description` is the short human-readable reason that powers the wander UI's
// "why this connection" label.
export const entityRelationships = sqliteTable(
  "entity_relationships",
  {
    id: text("id").primaryKey(),
    sourceEntityId: text("source_entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    targetEntityId: text("target_entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // located_in, authored, invented, influenced, critiqued, …
    description: text("description"), // short reason ("Caesar conquered Gaul")
    evidencePassageId: text("evidence_passage_id").references(() => passages.id, {
      onDelete: "set null",
    }),
    bookId: text("book_id").references(() => books.id, { onDelete: "cascade" }),
    confidence: real("confidence"),
    tier: integer("tier").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("idx_rel_source").on(table.sourceEntityId),
    index("idx_rel_target").on(table.targetEntityId),
    index("idx_rel_type").on(table.type),
  ],
);

// Per-book analysis status: tracks what's processed and enables re-runs when the
// pipeline improves (compare pipelineVersion).
export const bookAnalysis = sqliteTable(
  "book_analysis",
  {
    bookId: text("book_id")
      .primaryKey()
      .references(() => books.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"), // pending | running | completed | error
    pipelineVersion: text("pipeline_version"),
    model: text("model"),
    passageCount: integer("passage_count").notNull().default(0),
    entityCount: integer("entity_count").notNull().default(0),
    relationshipCount: integer("relationship_count").notNull().default(0),
    error: text("error"),
    analyzedAt: integer("analyzed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index("idx_book_analysis_status").on(table.status)],
);

// Images/figures extracted from a book, for later vision/OCR over figures, maps,
// and diagrams. Binaries live under data/figures/<bookId>/; storedPath is relative.
export const bookImages = sqliteTable(
  "book_images",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    // Nearest passage the figure sits in (provenance); set on best-effort basis.
    passageId: text("passage_id").references(() => passages.id, { onDelete: "set null" }),
    spineIndex: integer("spine_index"),
    ordinal: integer("ordinal").notNull(),
    charStart: integer("char_start"),
    storedPath: text("stored_path").notNull(), // relative: data/figures/<bookId>/<hash>.<ext>
    mimeType: text("mime_type").notNull(),
    alt: text("alt"),
    caption: text("caption"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("idx_book_images_book").on(table.bookId),
    index("idx_book_images_passage").on(table.passageId),
  ],
);

// Wander sessions table — activity tracking for the Living Library "wander"
// experience, mirroring reading_sessions. ideasVisited counts distinct ideas
// surfaced during the session.
export const wanderSessions = sqliteTable(
  "wander_sessions",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp" }),
    ideasVisited: integer("ideas_visited").notNull().default(1),
  },
  (table) => [
    index("idx_wander_sessions_profile").on(table.profileId),
    index("idx_wander_sessions_started").on(table.startedAt),
  ],
);

// Type exports
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type UserBookState = typeof userBookState.$inferSelect;
export type NewUserBookState = typeof userBookState.$inferInsert;
export type BookEdit = typeof bookEdits.$inferSelect;
export type NewBookEdit = typeof bookEdits.$inferInsert;
export type BackgroundJob = typeof backgroundJobs.$inferSelect;
export type NewBackgroundJob = typeof backgroundJobs.$inferInsert;
export type Book = typeof books.$inferSelect;
export type NewBook = typeof books.$inferInsert;
export type Collection = typeof collections.$inferSelect;
export type NewCollection = typeof collections.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type Bookmark = typeof bookmarks.$inferSelect;
export type Highlight = typeof highlights.$inferSelect;
export type ReadingSession = typeof readingSessions.$inferSelect;
export type WantedBook = typeof wantedBooks.$inferSelect;
export type NewWantedBook = typeof wantedBooks.$inferInsert;
export type BookSubject = typeof bookSubjects.$inferSelect;
export type Passage = typeof passages.$inferSelect;
export type NewPassage = typeof passages.$inferInsert;
export type Entity = typeof entities.$inferSelect;
export type NewEntity = typeof entities.$inferInsert;
export type EntityCanonical = typeof entityCanonical.$inferSelect;
export type NewEntityCanonical = typeof entityCanonical.$inferInsert;
export type EntityCandidateLink = typeof entityCandidateLinks.$inferSelect;
export type NewEntityCandidateLink = typeof entityCandidateLinks.$inferInsert;
export type EntityMention = typeof entityMentions.$inferSelect;
export type NewEntityMention = typeof entityMentions.$inferInsert;
export type EntityRelationship = typeof entityRelationships.$inferSelect;
export type NewEntityRelationship = typeof entityRelationships.$inferInsert;
export type BookAnalysis = typeof bookAnalysis.$inferSelect;
export type NewBookAnalysis = typeof bookAnalysis.$inferInsert;
export type BookImage = typeof bookImages.$inferSelect;
export type NewBookImage = typeof bookImages.$inferInsert;
export type WanderSession = typeof wanderSessions.$inferSelect;
export type NewWanderSession = typeof wanderSessions.$inferInsert;
