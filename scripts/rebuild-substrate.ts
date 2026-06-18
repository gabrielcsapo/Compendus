/**
 * Rebuild the semantic substrate over an existing analyzed library — the
 * migration path for corpora analyzed before the embed-first reorder, and the
 * recovery tool after bulk changes. Promotes legacy f32 passage embeddings into
 * the int8 `embeddings` table, then builds kNN graph, topics, centrality,
 * bridges, roles, and centroids.
 *
 * Usage:
 *   COMPENDUS_DATA_DIR=/path/to/data pnpm tsx scripts/rebuild-substrate.ts
 *
 * (The DB is resolved as $COMPENDUS_DATA_DIR/compendus.db, like the app.)
 */
import { rebuildStructure } from "../app/lib/knowledge/substrate";
import { rawDb } from "../app/lib/db";

const t0 = Date.now();
const stats = await rebuildStructure((m) => console.log(`  ${m}`));
if (!stats) {
  console.error("No embedded passages found — run analysis first.");
  process.exit(1);
}

const topTopics = rawDb
  .prepare(
    `SELECT t.label, t.size, t.book_count AS books FROM topics t
     WHERE t.size > 0 ORDER BY t.size DESC LIMIT 12`,
  )
  .all() as { label: string | null; size: number; books: number }[];

console.log(`\nSubstrate rebuilt in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(
  `  ${stats.passages} passages · ${stats.edges} edges (${(stats.crossBookEdgeShare * 100).toFixed(1)}% cross-book) · ${stats.topicCount} topics · ${stats.bridgeCount} bridges`,
);
console.log("\nTop topics:");
for (const t of topTopics) {
  console.log(`  - [${t.size}p/${t.books}b] ${t.label ?? "(unlabeled)"}`);
}
