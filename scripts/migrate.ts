import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";

const DB_PATH = resolve(process.cwd(), "data", "compendus.db");

// Ensure data directory exists
mkdirSync(dirname(DB_PATH), { recursive: true });

console.log(`Database path: ${DB_PATH}`);

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");

const db = drizzle(sqlite);

// Run Drizzle migrations
console.log("Running Drizzle migrations...");
migrate(db, { migrationsFolder: "./app/lib/db/migrations" });

// Create FTS5 virtual tables (not supported by Drizzle schema)
console.log("Setting up FTS5 full-text search tables...");

sqlite.exec(`
  -- Full-text search virtual table for book metadata
  CREATE VIRTUAL TABLE IF NOT EXISTS books_fts USING fts5(
    book_id UNINDEXED,
    title,
    authors,
    description,
    tokenize='porter unicode61 remove_diacritics 2'
  );

  -- Full-text search virtual table for book content
  CREATE VIRTUAL TABLE IF NOT EXISTS book_content_fts USING fts5(
    book_id UNINDEXED,
    chapter_index UNINDEXED,
    chapter_title,
    content,
    tokenize='porter unicode61 remove_diacritics 2'
  );
`);

// Add new columns (safe to run multiple times)
console.log("Adding new columns...");
const columnsToAdd = [
  { name: "isbn10", type: "TEXT" },
  { name: "series", type: "TEXT" },
  { name: "series_number", type: "TEXT" },
];

for (const col of columnsToAdd) {
  try {
    sqlite.exec(`ALTER TABLE books ADD COLUMN ${col.name} ${col.type}`);
    console.log(`  Added column: ${col.name}`);
  } catch (e: unknown) {
    // Column already exists - this is fine
    if (e instanceof Error && e.message.includes("duplicate column")) {
      console.log(`  Column ${col.name} already exists`);
    } else {
      throw e;
    }
  }
}

console.log("Migration completed successfully!");
sqlite.close();
