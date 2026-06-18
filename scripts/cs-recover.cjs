#!/usr/bin/env node
/**
 * Recover the concept-substrate DB bloat that wedged the box.
 *
 * The incremental edge-builder grew cs_concept_edges to millions of rows (every
 * concept co-occurrence pair × 3 indexes), and synchronous SQLite work on that
 * table now blocks better-sqlite3's single thread — which also runs the web
 * server — so the app stops serving at low CPU. This checkpoints the WAL and
 * drops the (regenerable) edge table. Concepts / passage_concepts / ingested
 * bookkeeping are PRESERVED, so the ~1,480 books already ingested stay intact.
 *
 * Run where better-sqlite3 + the DB live (e.g. inside the container):
 *   node scripts/cs-recover.cjs                 # default /app/data/compendus.db
 *   node scripts/cs-recover.cjs /path/to.db     # explicit path
 *   node scripts/cs-recover.cjs --vacuum        # also reclaim OS disk (slow)
 *
 * If it errors "database is locked", Stop the app/container first, then re-run.
 */
const Database = require("better-sqlite3");

const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const dbPath = arg || process.env.DB_PATH || "/app/data/compendus.db";
const doVacuum = process.argv.includes("--vacuum");

console.log("[recover] opening", dbPath);
const db = new Database(dbPath);
db.pragma("busy_timeout = 120000"); // wait up to 2min for any lock

const count = (t) => {
  try {
    return db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
  } catch (e) {
    return `(n/a: ${e.message})`;
  }
};

console.log(
  "[recover] BEFORE — edges:",
  count("cs_concept_edges"),
  "concepts:",
  count("cs_concepts"),
  "ingested:",
  count("cs_ingested"),
);

console.log(
  "[recover] checkpoint(TRUNCATE):",
  JSON.stringify(db.pragma("wal_checkpoint(TRUNCATE)")),
);
db.exec("DROP TABLE IF EXISTS cs_concept_edges");
console.log("[recover] dropped cs_concept_edges");
console.log(
  "[recover] checkpoint(TRUNCATE):",
  JSON.stringify(db.pragma("wal_checkpoint(TRUNCATE)")),
);

if (doVacuum) {
  console.log("[recover] VACUUM (slow, needs ~2x disk)…");
  db.exec("VACUUM");
  console.log("[recover] vacuum done");
}

console.log("[recover] AFTER — concepts:", count("cs_concepts"), "ingested:", count("cs_ingested"));
db.close();
console.log("[recover] DONE — restart the app; concepts & ingest bookkeeping preserved.");
