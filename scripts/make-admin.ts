#!/usr/bin/env tsx
import Database from "better-sqlite3";
import { resolve } from "path";

const DB_PATH = resolve(process.cwd(), "data", "compendus.db");
const identifier = process.argv[2]; // profile name or ID

if (!identifier) {
  console.error("Usage: pnpm make-admin <profile-name-or-id>");
  console.error("");
  console.error("Promotes a profile to admin status.");
  process.exit(1);
}

let sqlite: InstanceType<typeof Database>;
try {
  sqlite = new Database(DB_PATH);
} catch {
  console.error(`Could not open database at ${DB_PATH}`);
  console.error("Make sure you're running this from the project root directory.");
  process.exit(1);
}

// Look up by ID first, then by name (case-insensitive)
const profile = sqlite.prepare(
  "SELECT id, name, is_admin FROM profiles WHERE id = ? OR name = ? COLLATE NOCASE"
).get(identifier, identifier) as { id: string; name: string; is_admin: number } | undefined;

if (!profile) {
  console.error(`Profile not found: "${identifier}"`);
  console.error("");
  const all = sqlite.prepare("SELECT id, name, is_admin FROM profiles").all() as Array<{ id: string; name: string; is_admin: number }>;
  if (all.length === 0) {
    console.error("No profiles exist yet. Start the server and create a profile first.");
  } else {
    console.error("Available profiles:");
    for (const p of all) {
      console.error(`  ${p.name} (${p.id}) ${p.is_admin ? "[admin]" : ""}`);
    }
  }
  process.exit(1);
}

if (profile.is_admin) {
  console.log(`"${profile.name}" is already an admin.`);
  process.exit(0);
}

sqlite.prepare("UPDATE profiles SET is_admin = 1, updated_at = unixepoch() WHERE id = ?").run(profile.id);
console.log(`"${profile.name}" (${profile.id}) is now an admin.`);
sqlite.close();
