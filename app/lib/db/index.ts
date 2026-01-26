import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "fs";
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

// Export raw sqlite for FTS operations
export const rawDb = sqlite;

// Export types
export * from "./schema";
