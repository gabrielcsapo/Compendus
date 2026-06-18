/**
 * Fabric kind contracts for the C2/S5/A1 work: curriculum-scaffold (Tier B
 * scaffolding with Rule-2 validation + apply), tts-render-trail (audio wander
 * artifact + trail pinning), and the audiobook transcript → BookSource path.
 */
import { describe, it, expect, beforeAll } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */
let fabric: any, rawDb: any;

beforeAll(async () => {
  fabric = await import("../app/lib/fabric");
  await import("../app/lib/fabric/kinds");
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

describe("curriculum-scaffold kind (C2)", () => {
  const payload = {
    curriculumId: "cur-1",
    topicId: "top-1",
    topicLabel: "Composting",
    module: "Part 1",
    items: [
      {
        ordinal: 1,
        role: "definition",
        bookTitle: "Book A",
        text: "Compost is decomposed organic matter.",
      },
      { ordinal: 2, role: "example", bookTitle: "Book B", text: "A kitchen compost bin example." },
    ],
  };

  it("validates ordinal coverage and length caps", () => {
    const def = fabric.getKind("curriculum-scaffold");
    expect(
      def.validate(payload, {
        title: "Composting, from the ground up",
        transitions: [
          { ordinal: 1, text: "Start with how Book A defines compost itself." },
          { ordinal: 2, text: "Now a concrete kitchen-scale example from Book B." },
        ],
      }).ok,
    ).toBe(true);
    expect(
      def.validate(payload, {
        title: "T",
        transitions: [
          { ordinal: 1, text: "Long enough transition sentence." },
          { ordinal: 2, text: "Another long enough transition." },
        ],
      }).ok,
    ).toBe(false); // title too short
    expect(
      def.validate(payload, {
        title: "A reasonable title",
        transitions: [{ ordinal: 1, text: "Only one transition provided here." }],
      }).ok,
    ).toBe(false); // missing ordinal 2
    expect(
      def.validate(payload, {
        title: "A reasonable title",
        transitions: [
          { ordinal: 1, text: "short" },
          { ordinal: 2, text: "Long enough transition sentence." },
        ],
      }).ok,
    ).toBe(false); // transition too short
  });

  it("apply writes transitions and names the curriculum from module 1", () => {
    rawDb
      .prepare(
        "INSERT INTO curricula (id, topic_id, profile_id, title, builder, built_at, version) VALUES ('cur-1','top-1',NULL,'Study path','encoder',unixepoch(),1)",
      )
      .run();
    rawDb
      .prepare(
        "INSERT INTO curriculum_items (curriculum_id, ordinal, passage_id, module, role, transition) VALUES ('cur-1',1,'p1','Part 1','definition','old'),('cur-1',2,'p2','Part 1','example','old')",
      )
      .run();
    const def = fabric.getKind("curriculum-scaffold");
    def.apply(
      payload,
      {
        title: "Composting, from the ground up",
        transitions: [
          { ordinal: 1, text: "Start with how Book A defines compost itself." },
          { ordinal: 2, text: "Now a concrete kitchen-scale example from Book B." },
        ],
      },
      { modelId: "device/macos-26" },
    );
    const cur = rawDb.prepare("SELECT title, builder FROM curricula WHERE id='cur-1'").get();
    expect(cur.title).toBe("Composting, from the ground up");
    expect(cur.builder).toBe("device");
    const item = rawDb
      .prepare("SELECT transition FROM curriculum_items WHERE curriculum_id='cur-1' AND ordinal=2")
      .get();
    expect(item.transition).toContain("kitchen-scale");
  });
});

describe("tts-render-trail kind (S5)", () => {
  const HASH = "a".repeat(64);
  const payload = {
    trailId: "trail-1",
    voiceIndex: 0,
    segments: [{ passageId: "p1", text: "Some narration text." }],
  };

  it("validates artifact hash and duration/sample agreement", () => {
    const def = fabric.getKind("tts-render-trail");
    expect(
      def.validate(payload, { artifactHash: HASH, durationSec: 2, sampleCount: 48000 }).ok,
    ).toBe(true);
    expect(
      def.validate(payload, { artifactHash: "nope", durationSec: 2, sampleCount: 48000 }).ok,
    ).toBe(false);
    expect(
      def.validate(payload, { artifactHash: HASH, durationSec: 10, sampleCount: 48000 }).ok,
    ).toBe(false); // 48000 samples ≈ 2s, not 10s
  });

  it("apply pins the artifact onto the trail (and fails for unknown trails)", () => {
    rawDb
      .prepare(
        "INSERT OR IGNORE INTO profiles (id, name, created_at, updated_at) VALUES ('prof-t','T',unixepoch(),unixepoch())",
      )
      .run();
    rawDb
      .prepare(
        "INSERT INTO trails (id, profile_id, title, path_json) VALUES ('trail-1','prof-t','Trail','[\"p1\"]')",
      )
      .run();
    const def = fabric.getKind("tts-render-trail");
    def.apply(
      payload,
      { artifactHash: HASH, durationSec: 2, sampleCount: 48000 },
      { modelId: "kokoro" },
    );
    const row = rawDb.prepare("SELECT audio_hash FROM trails WHERE id='trail-1'").get();
    expect(row.audio_hash).toBe(HASH);
    expect(() =>
      def.apply(
        { ...payload, trailId: "missing" },
        { artifactHash: HASH, durationSec: 2, sampleCount: 48000 },
        { modelId: "kokoro" },
      ),
    ).toThrow(/not found/);
  });
});

describe("extract-entities kind (fire-and-continue)", () => {
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

  it("apply persists mentions and finalizes the running analysis", async () => {
    const texts = [
      "Marie Curie discovered radium while working in Paris with great care.",
      "Years later Marie Curie returned to the laboratory in Paris once more.",
    ];
    seedBook("bk-fleet", texts);
    const def = fabric.getKind("extract-entities");
    const payload = {
      bookId: "bk-fleet",
      sourceKind: "text",
      resultContract: 2,
      passageIds: texts.map((_t, i) => `bk-fleet-p${i}`),
    };
    const result = {
      entities: [
        [span("Marie Curie", "person", texts[0]), span("Paris", "place", texts[0])],
        [span("Marie Curie", "person", texts[1])],
      ],
    };
    expect(def.validate(payload, result).ok).toBe(true);
    await def.apply(payload, result, { modelId: "fleet/test" });
    const mentions = rawDb
      .prepare("SELECT COUNT(*) AS n FROM entity_mentions WHERE book_id = 'bk-fleet'")
      .get();
    expect(mentions.n).toBeGreaterThanOrEqual(3);
    const status = rawDb
      .prepare(
        "SELECT status, entity_count, passage_count FROM book_analysis WHERE book_id = 'bk-fleet'",
      )
      .get();
    expect(status.status).toBe("completed");
    expect(status.passage_count).toBe(2);
    expect(status.entity_count).toBeGreaterThanOrEqual(2);
  });

  it("apply is a no-op for stale passage ids (book re-analyzed mid-flight)", async () => {
    seedBook("bk-stale", ["Some current passage text that stays untouched."]);
    const def = fabric.getKind("extract-entities");
    const payload = {
      bookId: "bk-stale",
      sourceKind: "text",
      resultContract: 2,
      passageIds: ["bk-stale-OLD"],
    };
    await def.apply(
      payload,
      { entities: [[span("Ghost", "person", "An old passage")]] },
      { modelId: "fleet/test" },
    );
    const mentions = rawDb
      .prepare("SELECT COUNT(*) AS n FROM entity_mentions WHERE book_id = 'bk-stale'")
      .get();
    expect(mentions.n).toBe(0);
    const status = rawDb
      .prepare("SELECT status FROM book_analysis WHERE book_id = 'bk-stale'")
      .get();
    expect(status.status).toBe("running"); // newer run owns the book
  });

  it("onFailed flips a running analysis to error (but never a completed one)", () => {
    const def = fabric.getKind("extract-entities");
    def.onFailed({ bookId: "bk-stale" }, "lease expired after 5 attempts");
    let row = rawDb
      .prepare("SELECT status, error FROM book_analysis WHERE book_id='bk-stale'")
      .get();
    expect(row.status).toBe("error");
    expect(row.error).toContain("lease expired");
    // A completed book is left alone.
    def.onFailed({ bookId: "bk-fleet" }, "too late");
    row = rawDb.prepare("SELECT status FROM book_analysis WHERE book_id='bk-fleet'").get();
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

describe("realm-label kind", () => {
  const KEY = "b".repeat(64);
  const payload = {
    realmKey: KEY,
    topics: [{ label: "composting", books: ["Mini Farming"] }],
    samples: ["Compost is decomposed organic matter."],
  };

  it("validates label/blurb shape", () => {
    const def = fabric.getKind("realm-label");
    expect(
      def.validate(payload, {
        label: "Gardening & Growing",
        blurb: "Soil, seasons, and the patient work of growing food.",
      }).ok,
    ).toBe(true);
    expect(def.validate(payload, { label: "G", blurb: "Long enough blurb here." }).ok).toBe(false);
    expect(
      def.validate(payload, {
        label: "A way too long sentence pretending to be a section sign",
        blurb: "Long enough blurb here.",
      }).ok,
    ).toBe(false);
    expect(def.validate(payload, { label: "Gardening", blurb: "short" }).ok).toBe(false);
    expect(
      def.validate(
        { ...payload, realmKey: "nope" },
        { label: "Gardening", blurb: "Long enough blurb here." },
      ).ok,
    ).toBe(false);
  });

  it("apply upserts the authored name", () => {
    const def = fabric.getKind("realm-label");
    def.apply(
      payload,
      { label: "Gardening & Growing", blurb: "Soil, seasons, and patience." },
      { modelId: "device/macos-26" },
    );
    let row = rawDb.prepare("SELECT label, blurb FROM realm_labels WHERE realm_key = ?").get(KEY);
    expect(row.label).toBe("Gardening & Growing");
    def.apply(
      payload,
      { label: "The Garden Wing", blurb: "Everything that grows, across your shelves." },
      { modelId: "device/macos-26" },
    );
    row = rawDb.prepare("SELECT label FROM realm_labels WHERE realm_key = ?").get(KEY);
    expect(row.label).toBe("The Garden Wing");
  });
});

describe("topic-label kind", () => {
  const KEY = "c".repeat(64);
  const payload = {
    topicKey: KEY,
    books: ["Alexander Hamilton"],
    samples: ["Throughout his affair with Burr, Hamilton evinced ambivalence about dueling."],
  };

  it("validates road-name shape", () => {
    const def = fabric.getKind("topic-label");
    expect(
      def.validate(payload, {
        label: "The Duel at Weehawken",
        blurb: "Hamilton, Burr, and the code of honor.",
      }).ok,
    ).toBe(true);
    expect(
      def.validate(payload, {
        label: "A very long meandering sentence that is not a title",
        blurb: "Long enough blurb.",
      }).ok,
    ).toBe(false);
    expect(
      def.validate(
        { ...payload, samples: [] },
        { label: "The Duel", blurb: "Long enough blurb here." },
      ).ok,
    ).toBe(false);
  });

  it("apply upserts by content key", () => {
    const def = fabric.getKind("topic-label");
    def.apply(
      payload,
      { label: "The Duel at Weehawken", blurb: "Hamilton, Burr, and honor." },
      { modelId: "device/macos-26" },
    );
    const row = rawDb.prepare("SELECT label FROM topic_labels WHERE topic_key = ?").get(KEY);
    expect(row.label).toBe("The Duel at Weehawken");
  });
});
