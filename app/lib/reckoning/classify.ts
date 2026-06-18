/**
 * Reckoning — book fiction/nonfiction classification (the fleet-offloaded step).
 *
 * The Reckoning adjudicates cross-book CLAIMS, so it must run over nonfiction
 * only. The library's `book_subjects` metadata is empty (the OpenLibrary/Google
 * enrichment never populated it), so we can't tell fiction from nonfiction by
 * subject. Instead a one-time fleet job classifies every book: the box samples
 * a few prose passages per book and enqueues a `classify-book` job; an idle Mac
 * with a local LLM decides fiction|nonfiction and posts it back. The verdicts
 * land in `cs_book_class`, which `mine.ts` reads as its nonfiction allowlist.
 *
 * No model inference happens here — this module only samples text, enqueues
 * work, and reports progress. The classification itself is the fleet's job.
 */
import { rawDb } from "../db";
import { enqueueWork } from "../fabric";

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

/** Hand control back to the event loop so the box keeps answering requests. */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Per-book counts by category (fiction / nonfiction / pending). */
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
 * Enqueue `classify-book` fleet jobs for books that don't yet have a class row.
 * Inserts a 'pending' placeholder per book so repeated calls don't double-enqueue
 * in-flight work. Bounded by `limit`; call repeatedly to drain the whole library.
 * Async + yields so enqueuing thousands of jobs doesn't block the web thread.
 */
export async function enqueueBookClassification(opts?: {
  limit?: number;
  reset?: boolean;
}): Promise<{
  enqueued: number;
  totalBooks: number;
  classified: number;
  byCategory: Record<string, number>;
}> {
  ensureBookClassTable();
  const limit = opts?.limit ?? 1000;

  // reset: re-issue still-pending jobs so they pick up the current requirements
  // (e.g. after broadening the runtime from ollama-judge to llm so iOS can help).
  // Drops only un-leased queued jobs + their pending placeholders; classified
  // books and in-flight leases are untouched.
  if (opts?.reset) {
    rawDb
      .prepare("DELETE FROM work_items WHERE kind = 'classify-book' AND status = 'queued'")
      .run();
    rawDb.prepare("DELETE FROM cs_book_class WHERE category = 'pending'").run();
  }

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
  const placeholder = rawDb.prepare(
    `INSERT OR IGNORE INTO cs_book_class (book_id, category, confidence, created_at)
     VALUES (?, 'pending', NULL, unixepoch())`,
  );

  let enqueued = 0;
  for (const b of books) {
    if (++enqueued % 100 === 0) await tick();
    const samples = (sampleStmt.all(b.id) as Array<{ text: string }>).map((r) => r.text);
    const sample = samples.join("\n\n").replace(/\s+/g, " ").trim().slice(0, 1600);
    placeholder.run(b.id);
    enqueueWork({
      project: "compendus",
      kind: "classify-book",
      payload: { bookId: b.id, title: b.title ?? "", author: firstAuthor(b.authors), sample },
      // Generic local-LLM runtime: Mac (Ollama) and iOS (Foundation Models) both
      // advertise "llm", so any capable device in the fleet can classify.
      requirements: { runtimes: ["llm"] },
    });
  }

  return { enqueued, ...classifySummary() };
}
