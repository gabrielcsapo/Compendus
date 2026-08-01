/**
 * Reckoning — book fiction/nonfiction classification (server-side Ollama).
 *
 * The Reckoning adjudicates cross-book CLAIMS, so it must run over nonfiction
 * only. The library's `book_subjects` metadata is empty (the OpenLibrary/Google
 * enrichment never populated it), so we can't tell fiction from nonfiction by
 * subject. Instead this pass samples a few prose passages per book and asks the
 * local LLM to decide fiction|nonfiction. Verdicts land in `cs_book_class`,
 * which `mine.ts` reads as its nonfiction allowlist — and which also gates
 * journeys, curriculum, and wander's nonfiction start.
 *
 * Run detached on the LLM lane (see server/routes/reckoning.ts); resumable —
 * books with a class row are skipped, so a restart just continues.
 */
import { rawDb } from "../db";
import { classifyBook } from "../llm/ollama";
import { tick, type PassStatus } from "../llm/lane";

/** Idempotent table creation — avoids a hand-authored drizzle migration. */
export function ensureBookClassTable(): void {
  rawDb.exec(`CREATE TABLE IF NOT EXISTS cs_book_class (
    book_id    TEXT PRIMARY KEY,
    category   TEXT NOT NULL,
    confidence REAL,
    reason     TEXT,
    model_id   TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
}

/** Best-effort first author from the books.authors JSON array column. */
function firstAuthor(authorsJson: string | null): string {
  if (!authorsJson) return "";
  try {
    const v = JSON.parse(authorsJson);
    if (Array.isArray(v) && v.length > 0) return String(v[0]);
    if (typeof v === "string") return v;
  } catch {
    return authorsJson;
  }
  return "";
}

/** Per-book counts by category (fiction / nonfiction). */
export function classifySummary(): {
  totalBooks: number;
  classified: number;
  byCategory: Record<string, number>;
} {
  ensureBookClassTable();
  const byCategory: Record<string, number> = {};
  for (const r of rawDb
    .prepare("SELECT category, COUNT(*) AS n FROM cs_book_class GROUP BY category")
    .all() as Array<{ category: string; n: number }>) {
    byCategory[r.category] = r.n;
  }
  const totalBooks = (rawDb.prepare("SELECT COUNT(*) AS n FROM books").get() as { n: number }).n;
  const classified = (byCategory.fiction ?? 0) + (byCategory.nonfiction ?? 0);
  return { totalBooks, classified, byCategory };
}

/**
 * Classify unclassified books with the local LLM, one at a time. Bounded by
 * `limit`; call repeatedly to drain the whole library. `reset` re-classifies
 * everything (drops all existing rows first).
 *
 * Each iteration is a real multi-second inference, so we yield every book.
 * A per-book failure (Ollama hiccup) is logged and skipped — the book has no
 * row, so the next run retries it.
 */
export async function runBookClassification(
  opts: { limit?: number; reset?: boolean },
  status?: PassStatus,
): Promise<{
  classified: number;
  failed: number;
  totalBooks: number;
  byCategory: Record<string, number>;
}> {
  ensureBookClassTable();
  const limit = opts?.limit ?? 3000;

  if (opts?.reset) {
    rawDb.prepare("DELETE FROM cs_book_class").run();
  }
  // Legacy fleet-era 'pending' placeholder rows would exclude their books from
  // the NOT EXISTS selection forever — purge unconditionally.
  rawDb.prepare("DELETE FROM cs_book_class WHERE category = 'pending'").run();

  const books = rawDb
    .prepare(
      `SELECT b.id AS id, b.title AS title, b.authors AS authors
         FROM books b
        WHERE NOT EXISTS (SELECT 1 FROM cs_book_class c WHERE c.book_id = b.id)
        LIMIT ?`,
    )
    .all(limit) as Array<{ id: string; title: string; authors: string | null }>;

  // A few high-salience prose passages give the model enough to judge tone.
  const sampleStmt = rawDb.prepare(
    `SELECT p.text AS text
       FROM cs_passage_salience s
       JOIN passages p ON p.id = s.passage_id
      WHERE p.book_id = ? AND s.prose >= 0.5
      ORDER BY s.salience DESC
      LIMIT 3`,
  );
  const upsert = rawDb.prepare(
    `INSERT INTO cs_book_class (book_id, category, confidence, reason, model_id, created_at)
     VALUES (?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(book_id) DO UPDATE SET
       category=excluded.category, confidence=excluded.confidence,
       reason=excluded.reason, model_id=excluded.model_id, created_at=excluded.created_at`,
  );

  if (status) status.total = books.length;
  let classified = 0;
  let failed = 0;
  for (const b of books) {
    const samples = (sampleStmt.all(b.id) as Array<{ text: string }>).map((r) => r.text);
    const sample = samples.join("\n\n").replace(/\s+/g, " ").trim().slice(0, 1600);
    try {
      const r = await classifyBook({
        title: b.title ?? "",
        author: firstAuthor(b.authors),
        sample,
      });
      upsert.run(b.id, r.category, r.confidence, r.reason.slice(0, 500), r.modelId);
      classified++;
    } catch (e) {
      failed++;
      console.warn(
        `[classify] ${(b.title ?? b.id).slice(0, 60)}: ${e instanceof Error ? e.message : e}`,
      );
    }
    if (status) {
      status.processed++;
      status.note = b.title ?? b.id;
    }
    await tick();
  }

  const summary = classifySummary();
  return { classified, failed, totalBooks: summary.totalBooks, byCategory: summary.byCategory };
}
