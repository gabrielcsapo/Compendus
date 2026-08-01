import { beforeAll, describe, expect, it } from "vitest";

let rawDb: typeof import("../app/lib/db").rawDb;
let choosePassageTheme: typeof import("../app/lib/lg/themes").choosePassageTheme;
let refreshThemeConcepts: typeof import("../app/lib/lg/schema").refreshThemeConcepts;

beforeAll(async () => {
  ({ rawDb } = await import("../app/lib/db"));
  const schema = await import("../app/lib/lg/schema");
  schema.ensureLgTables();
  refreshThemeConcepts = schema.refreshThemeConcepts;
  ({ choosePassageTheme } = await import("../app/lib/lg/themes"));
});

describe("learning-graph passage theme admission", () => {
  it("accepts substantial majority support", () => {
    expect(choosePassageTheme(new Map([["theme-a", 2]]))).toBe("theme-a");
    expect(
      choosePassageTheme(
        new Map([
          ["theme-a", 3],
          ["theme-b", 1],
          ["theme-c", 1],
        ]),
      ),
    ).toBe("theme-a");
  });

  it("refuses fewer than two supporting home concepts", () => {
    expect(choosePassageTheme(new Map([["theme-a", 1]]))).toBeNull();
  });

  it("refuses ties and zero runner-up margin", () => {
    expect(
      choosePassageTheme(
        new Map([
          ["theme-a", 2],
          ["theme-b", 2],
        ]),
      ),
    ).toBeNull();
  });

  it("refuses a plurality that is not a majority", () => {
    expect(
      choosePassageTheme(
        new Map([
          ["theme-a", 2],
          ["theme-b", 1],
          ["theme-c", 1],
        ]),
      ),
    ).toBeNull();
  });
});

describe("learning-graph theme concept inventory", () => {
  it("persists only canonical concepts whose home is the theme", () => {
    rawDb
      .prepare(
        `INSERT INTO books
           (id, file_path, file_name, file_size, file_hash, mime_type, title)
         VALUES ('lg-theme-book', 'lg-theme-book.epub', 'lg-theme-book.epub', 1,
                 'lg-theme-book', 'application/epub+zip', 'Theme Test Book')`,
      )
      .run();
    rawDb
      .prepare(
        `INSERT INTO passages (id, book_id, ordinal, text)
         VALUES ('lg-theme-passage', 'lg-theme-book', 0, 'A focused test passage.')`,
      )
      .run();
    rawDb
      .prepare(
        `INSERT INTO lg_themes (id, label) VALUES ('theme-home', 'Home Theme'),
                                                       ('theme-foreign', 'Foreign Theme')`,
      )
      .run();
    rawDb
      .prepare(
        `INSERT INTO lg_concepts (id, label, kind, df, model_id)
         VALUES ('home-low', 'Home Low', 'idea', 2, 'test'),
                ('home-high', 'Home High', 'idea', 8, 'test'),
                ('foreign', 'Foreign', 'idea', 20, 'test'),
                ('merged-home', 'Merged Home', 'idea', 30, 'test')`,
      )
      .run();
    rawDb
      .prepare("UPDATE lg_concepts SET merged_into = 'home-high' WHERE id = 'merged-home'")
      .run();
    rawDb
      .prepare(
        `INSERT INTO lg_concept_themes (concept_id, theme_id)
         VALUES ('home-low', 'theme-home'), ('home-high', 'theme-home'),
                ('foreign', 'theme-foreign'), ('merged-home', 'theme-home')`,
      )
      .run();
    rawDb
      .prepare(
        `INSERT INTO lg_passage_concepts (passage_id, concept_id, role, model_id)
         VALUES ('lg-theme-passage', 'home-low', 'definition', 'test'),
                ('lg-theme-passage', 'home-high', 'definition', 'test'),
                ('lg-theme-passage', 'foreign', 'definition', 'test'),
                ('lg-theme-passage', 'merged-home', 'definition', 'test')`,
      )
      .run();
    rawDb
      .prepare(
        `INSERT INTO lg_theme_passages (theme_id, passage_id)
         VALUES ('theme-home', 'lg-theme-passage')`,
      )
      .run();

    expect(refreshThemeConcepts("theme-home")).toEqual(["home-high", "home-low"]);
    expect(
      rawDb
        .prepare(
          `SELECT concept_ids AS conceptIds, concept_count AS conceptCount,
                  passage_count AS passageCount
             FROM lg_themes WHERE id = 'theme-home'`,
        )
        .get(),
    ).toEqual({
      conceptIds: JSON.stringify(["home-high", "home-low"]),
      conceptCount: 2,
      passageCount: 1,
    });
  });
});
