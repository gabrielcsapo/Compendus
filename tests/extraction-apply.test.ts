/**
 * Post-extraction apply contract (formerly exercised through the fabric
 * extract-entities kind): mentions persist + analysis finalizes, stale passage
 * ids no-op, and error flipping respects completed runs. Plus the transcript →
 * BookSource split and prose scoring that lived alongside those tests.
 */
import { describe, it, expect, beforeAll } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */
let rawDb: any;

beforeAll(async () => {
  ({ rawDb } = await import("../app/lib/db"));
});

describe("bookSourceFromTranscript (A1)", () => {
  it("splits sections on long pauses and caps section size", async () => {
    const { bookSourceFromTranscript } = await import("../app/lib/knowledge/book-source");
    const seg = (start: number, end: number, text: string) => ({ start, end, text });
    const src = bookSourceFromTranscript({
      segments: [
        seg(0, 2, "Chapter one begins here."),
        seg(2.5, 4, "It continues."),
        seg(10, 12, "After a long silence, a new part."), // 6s pause → new section
        seg(12.5, 14, "Which continues too."),
      ],
    });
    expect(src.sections.length).toBe(2);
    expect(src.sections[0].text).toContain("Chapter one");
    expect(src.sections[0].text).toContain("It continues.");
    expect(src.sections[1].text).toContain("new part");
    expect(src.sections[1].spineIndex).toBe(1);
    expect(src.totalCharacters).toBeGreaterThan(0);
    // Empty transcript → no sections, no crash.
    expect(bookSourceFromTranscript({ segments: [] }).sections.length).toBe(0);
  });
});

describe("applyExtraction", () => {
  const seedBook = (bookId: string, passageTexts: string[]) => {
    rawDb
      .prepare(
        "INSERT OR IGNORE INTO books (id, file_path, file_name, file_size, file_hash, mime_type, title) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        bookId,
        `data/books/${bookId}.epub`,
        `${bookId}.epub`,
        1,
        bookId,
        "application/epub+zip",
        bookId,
      );
    const ins = rawDb.prepare(
      "INSERT INTO passages (id, book_id, spine_index, ordinal, char_start, char_end, text, created_at) VALUES (?,?,?,?,?,?,?,unixepoch())",
    );
    passageTexts.forEach((t, i) => ins.run(`${bookId}-p${i}`, bookId, 0, i, 0, t.length, t));
    rawDb
      .prepare(
        "INSERT INTO book_analysis (book_id, status, pipeline_version, model) VALUES (?,'running','test','test')",
      )
      .run(bookId);
  };
  const span = (name: string, type: string, text: string) => ({
    name,
    type,
    score: 0.9,
    surfaceText: name,
    charStart: Math.max(0, text.indexOf(name)),
    charEnd: Math.max(0, text.indexOf(name)) + name.length,
  });

  it("persists mentions and finalizes the running analysis", async () => {
    const { applyExtraction } = await import("../app/lib/knowledge/extraction-apply");
    const texts = [
      "Marie Curie discovered radium while working in Paris with great care.",
      "Years later Marie Curie returned to the laboratory in Paris once more.",
    ];
    seedBook("bk-apply", texts);
    const applied = await applyExtraction({
      bookId: "bk-apply",
      passageIds: texts.map((_t, i) => `bk-apply-p${i}`),
      entities: [
        [span("Marie Curie", "person", texts[0]), span("Paris", "place", texts[0])],
        [span("Marie Curie", "person", texts[1])],
      ],
      sourceKind: "text",
    });
    expect(applied).not.toBeNull();
    const mentions = rawDb
      .prepare("SELECT COUNT(*) AS n FROM entity_mentions WHERE book_id = 'bk-apply'")
      .get();
    expect(mentions.n).toBeGreaterThanOrEqual(3);
    const status = rawDb
      .prepare(
        "SELECT status, entity_count, passage_count FROM book_analysis WHERE book_id = 'bk-apply'",
      )
      .get();
    expect(status.status).toBe("completed");
    expect(status.passage_count).toBe(2);
    expect(status.entity_count).toBeGreaterThanOrEqual(2);
  });

  it("is a no-op for stale passage ids (book re-analyzed mid-flight)", async () => {
    const { applyExtraction } = await import("../app/lib/knowledge/extraction-apply");
    seedBook("bk-stale", ["Some current passage text that stays untouched."]);
    const applied = await applyExtraction({
      bookId: "bk-stale",
      passageIds: ["bk-stale-OLD"],
      entities: [[span("Ghost", "person", "An old passage")]],
      sourceKind: "text",
    });
    expect(applied).toBeNull();
    const mentions = rawDb
      .prepare("SELECT COUNT(*) AS n FROM entity_mentions WHERE book_id = 'bk-stale'")
      .get();
    expect(mentions.n).toBe(0);
    const status = rawDb
      .prepare("SELECT status FROM book_analysis WHERE book_id = 'bk-stale'")
      .get();
    expect(status.status).toBe("running"); // newer run owns the book
  });

  it("markAnalysisErrorIfRunning flips a running analysis (but never a completed one)", async () => {
    const { markAnalysisErrorIfRunning } = await import("../app/lib/knowledge/extraction-apply");
    markAnalysisErrorIfRunning("bk-stale", "analysis crashed mid-flight");
    let row = rawDb
      .prepare("SELECT status, error FROM book_analysis WHERE book_id='bk-stale'")
      .get();
    expect(row.status).toBe("error");
    expect(row.error).toContain("crashed");
    // A completed book is left alone.
    markAnalysisErrorIfRunning("bk-apply", "too late");
    row = rawDb.prepare("SELECT status FROM book_analysis WHERE book_id='bk-apply'").get();
    expect(row.status).toBe("completed");
  });
});

describe("proseScore back-matter detection", () => {
  it("scores reading lists and publisher promo below prose", async () => {
    const { proseScore } = await import("../app/lib/knowledge/substrate");
    // Verbatim-style appendix text that previously passed the citation filter.
    const appendix =
      "APPENDIX 1 Suggested Further Reading Listed below are some books filled with useful information on food plants. " +
      "Agricultural Explorations in the Fruit and Nut Orchards of China. Frank Nicholas Meyer. 1911. USDA Bureau of Plant Industry Bulletin 204. " +
      "American Chestnut: The Life, Death, and Rebirth of a Perfect Tree. Susan Freinkel. 2007. University of California Press. " +
      "Blackberry Culture. George M. Darrow. 1918. Farmers Bulletin 643. USDA Publishing.";
    expect(proseScore(appendix, "APPENDIX 1")).toBeLessThan(0.45);
    expect(proseScore(appendix, null)).toBeLessThan(0.45); // head pattern alone suffices
    const promo =
      "OPEN ROAD MEDIA Open Road Integrated Media is a digital publisher and multimedia content company. " +
      "Videos, Archival Documents, and New Releases. Sign up for the Open Road Media newsletter and get news delivered straight to your inbox. " +
      "FIND OUT MORE AT WWW.OPENROADMEDIA.COM. Connect with us. Open Road Media Press 2014 Editions.";
    expect(proseScore(promo, null)).toBeLessThan(0.6);
    // Real prose with an incidental year stays prose.
    const prose =
      "The long afternoon light fell across the garden while she considered what the harvest had taught her about patience, " +
      "and the slow accumulation of small daily efforts across many seasons of careful, unhurried work in the soil. " +
      "It was 2007 when she first planted the orchard, and the trees had only now begun to carry real weight.";
    expect(proseScore(prose, "Chapter Three")).toBeGreaterThanOrEqual(0.6);
  });
});
