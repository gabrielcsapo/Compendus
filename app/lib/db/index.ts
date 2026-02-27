import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import * as schema from "./schema";

// Database path - relative to project root
const DB_PATH = resolve(process.cwd(), "data", "compendus.db");

// Ensure data directory exists
mkdirSync(dirname(DB_PATH), { recursive: true });

// Create SQLite connection
const sqlite = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
sqlite.pragma("journal_mode = WAL");

// Create Drizzle instance
export const db = drizzle(sqlite, { schema });

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
