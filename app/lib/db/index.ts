import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import * as schema from "./schema";

// Database path. COMPENDUS_DATA_DIR overrides the data root (used by tests to
// point at a throwaway dir); defaults to <cwd>/data in dev/prod.
const DATA_ROOT = process.env.COMPENDUS_DATA_DIR || resolve(process.cwd(), "data");
const DB_PATH = resolve(DATA_ROOT, "compendus.db");

// Ensure data directory exists
mkdirSync(dirname(DB_PATH), { recursive: true });

// Create SQLite connection
const sqlite = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
sqlite.pragma("journal_mode = WAL");

// Substrate rebuilds run on a worker thread with its own connection; without a
// busy timeout, a write collision throws SQLITE_BUSY instead of waiting.
sqlite.pragma("busy_timeout = 30000");

// Enforce foreign keys so onDelete:cascade actually fires (off by default in
// SQLite). Without this, deleting a row leaves orphaned children — e.g. deleting
// passages left dangling entity_mentions, corrupting the knowledge graph on re-run.
sqlite.pragma("foreign_keys = ON");

// Page cache: SQLite's default is ~2MB, laughably small for a DB with 100k+
// passage/embedding rows — hot queries (lease polls, analysis sweeps) were
// hitting disk constantly. Negative value = KB, so -16000 = 16MB per
// connection (main + workers ≈ 48MB worst case, fine in the container).
sqlite.pragma("cache_size = -16000");

// Memory-mapped reads: sequential scans (corpus vector loads, neighbor table
// reads) go through the page cache without read() syscalls. 64MB window —
// mmap is shared between connections, costs address space not RSS.
sqlite.pragma("mmap_size = 67108864");

// Create Drizzle instance
export const db = drizzle(sqlite, { schema });

// Export raw sqlite instance for complex raw SQL queries (CTEs, window functions)
export const rawDb = sqlite;

// Run migrations automatically on startup
// In production builds, import.meta.dirname points to dist/rsc/assets/ but migrations
// are at dist/rsc/migrations/. Try multiple locations to find migrations.
const migrationsPaths = [
  resolve(import.meta.dirname, "migrations"),
  resolve(import.meta.dirname, "..", "migrations"),
  resolve(process.cwd(), "app/lib/db/migrations"),
];
const migrationsFolder = migrationsPaths.find((p) => existsSync(resolve(p, "meta")));
if (migrationsFolder) {
  try {
    migrate(db, { migrationsFolder });
  } catch (err) {
    console.error("[DB] Migration failed:", err);
  }
} else {
  console.warn("[DB] No migrations folder found, tried:", migrationsPaths);
}

// Export types
export * from "./schema";
