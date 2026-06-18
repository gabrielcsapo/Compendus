/**
 * Incremental concept ingest — the hot path that replaces the embedding +
 * GLiNER + kNN grind. Per book: extract concepts (YAKE), bump global concept
 * document-frequencies and co-occurrence counts, and store sequential-novelty
 * salience. O(passages × keyphrase) ≈ ms/book, ~MB of RAM — no global rebuild,
 * no embeddings, so it cannot OOM the box.
 */
import { rawDb, db } from "../db";
import { extractConcepts, proseScore, sequentialNovelty } from "./pipeline";

const sel = {
  alreadyIngested: rawDb.prepare("SELECT 1 FROM cs_ingested WHERE book_id = ?"),
  passages: rawDb.prepare("SELECT id, text FROM passages WHERE book_id = ? ORDER BY ordinal"),
};
const ins = {
  pc: rawDb.prepare(
    "INSERT OR IGNORE INTO cs_passage_concepts (passage_id, concept_id) VALUES (?, ?)",
  ),
  concept: rawDb.prepare(
    "INSERT INTO cs_concepts (id, display, df) VALUES (?, ?, 1) ON CONFLICT(id) DO UPDATE SET df = df + 1",
  ),
  salience: rawDb.prepare(
    `INSERT INTO cs_passage_salience (passage_id, novelty, prose, salience) VALUES (?, ?, ?, ?)
     ON CONFLICT(passage_id) DO UPDATE SET novelty = excluded.novelty, prose = excluded.prose, salience = excluded.salience`,
  ),
  book: rawDb.prepare(
    `INSERT INTO cs_ingested (book_id, passage_count, ingested_at) VALUES (?, ?, unixepoch())
     ON CONFLICT(book_id) DO UPDATE SET passage_count = excluded.passage_count, ingested_at = excluded.ingested_at`,
  ),
};

export interface IngestResult {
  bookId: string;
  passages: number;
  skipped: boolean;
}

const CHUNK = 400; // passages per transaction — yield to the event loop between chunks

/** Ingest one book's concepts. Idempotent: skips books already ingested. */
export async function ingestBook(bookId: string): Promise<IngestResult> {
  if (sel.alreadyIngested.get(bookId)) return { bookId, passages: 0, skipped: true };
  const rows = sel.passages.all(bookId) as { id: string; text: string }[];
  if (rows.length === 0) {
    ins.book.run(bookId, 0);
    return { bookId, passages: 0, skipped: false };
  }
  const novelty = sequentialNovelty(rows.map((r) => r.text));

  for (let start = 0; start < rows.length; start += CHUNK) {
    const end = Math.min(rows.length, start + CHUNK);
    db.transaction(() => {
      for (let i = start; i < end; i++) {
        const row = rows[i];
        const cs = extractConcepts(row.text);
        const norms = [...new Set(cs.map((c) => c.normalized))];
        const display = new Map(cs.map((c) => [c.normalized, c.display]));
        for (const c of norms) {
          // Only bump df the first time this passage links this concept (idempotent).
          if (ins.pc.run(row.id, c).changes > 0) ins.concept.run(c, display.get(c) ?? c);
        }
        // Co-occurrence edges are NOT written here — incrementally maintaining a
        // pair table per passage exploded cs_concept_edges to 4.5M rows and wedged
        // the box (synchronous SQLite blocking the single web thread). The graph
        // is now derived on demand from cs_passage_concepts in graph.ts.
        const prose = proseScore(row.text);
        ins.salience.run(row.id, novelty[i], prose, novelty[i] * prose);
      }
    });
    if (end < rows.length) await new Promise((res) => setImmediate(res)); // keep the loop free
  }
  ins.book.run(bookId, rows.length);

  return { bookId, passages: rows.length, skipped: false };
}

/** Backfill every not-yet-ingested book. Returns per-run totals. */
export async function ingestAllBooks(
  onProgress?: (p: { books: number; total: number; passages: number }) => void,
): Promise<{ books: number; passages: number }> {
  const books = rawDb
    .prepare(
      "SELECT id FROM books WHERE id NOT IN (SELECT book_id FROM cs_ingested) ORDER BY created_at",
    )
    .all() as { id: string }[];
  let passages = 0;
  let done = 0;
  for (const b of books) {
    const r = await ingestBook(b.id);
    passages += r.passages;
    if (++done % 5 === 0) onProgress?.({ books: done, total: books.length, passages });
  }
  onProgress?.({ books: done, total: books.length, passages });
  return { books: done, passages };
}

export function conceptIngestStats(): { books: number; concepts: number; passages: number } {
  const one = (q: string) => (rawDb.prepare(q).get() as { n: number }).n;
  return {
    books: one("SELECT COUNT(*) AS n FROM cs_ingested"),
    concepts: one("SELECT COUNT(*) AS n FROM cs_concepts"),
    passages: one("SELECT COUNT(*) AS n FROM cs_passage_salience"),
  };
}
