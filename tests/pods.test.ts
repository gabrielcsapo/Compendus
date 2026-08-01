import { beforeAll, describe, expect, it } from "vitest";

let rawDb: typeof import("../app/lib/db").rawDb;
let db: typeof import("../app/lib/db").db;
let books: typeof import("../app/lib/db").books;
let passages: typeof import("../app/lib/db").passages;
let getPodSession: typeof import("../app/lib/learning/pods").getPodSession;
let answerPodQuestion: typeof import("../app/lib/learning/pods").answerPodQuestion;
let listPods: typeof import("../app/lib/learning/pods").listPods;
let searchPods: typeof import("../app/lib/learning/pods").searchPods;
let podPassageRelevance: typeof import("../app/lib/learning/pods").podPassageRelevance;
let isTeachablePodPassage: typeof import("../app/lib/learning/pods").isTeachablePodPassage;
let isPodContentChapter: typeof import("../app/lib/learning/pods").isPodContentChapter;
let isQualityPodTitle: typeof import("../app/lib/learning/pods").isQualityPodTitle;
let podSourceStatement: typeof import("../app/lib/learning/pods").podSourceStatement;
let conceptSearchJourneys: typeof import("../app/lib/concept/wander").conceptSearchJourneys;

const POD_ID = "lgth_pods-contract-test";
const DUPLICATE_POD_ID = "lgth_pods-contract-duplicate";
const BAD_TITLE_POD_ID = "lgth_pods-contract-bad-title";
const PROFILE_ID = "pods-test-profile";
const claims = [
  "Deliberate practice improves a skill through focused feedback.",
  // Deliberately duplicated across a different concept and source. It must not
  // become visually identical distractor text.
  "Deliberate practice improves a skill through focused feedback.",
  "Spacing study sessions strengthens long-term memory retrieval.",
  "Reflection turns experience into reusable understanding.",
];

const passageText = (index: number) =>
  `This source passage ${index} explains a learning principle for learning better in the author's own words. ` +
  "It gives enough context for a reader to understand why the principle matters, how it changes daily practice, and when the idea should be applied carefully. " +
  "The final sentence provides a concrete conclusion for later recall.";

beforeAll(async () => {
  ({ rawDb, db, books, passages } = await import("../app/lib/db"));
  const { ensureLgTables } = await import("../app/lib/lg/schema");
  const { ensureBookClassTable } = await import("../app/lib/reckoning/classify");
  const { ensureJourneyColumns } = await import("../app/lib/concept/wander");
  ensureLgTables();
  ensureBookClassTable();
  ensureJourneyColumns();
  ({
    getPodSession,
    answerPodQuestion,
    listPods,
    searchPods,
    podPassageRelevance,
    isTeachablePodPassage,
    isPodContentChapter,
    isQualityPodTitle,
    podSourceStatement,
  } = await import("../app/lib/learning/pods"));
  ({ conceptSearchJourneys } = await import("../app/lib/concept/wander"));

  rawDb
    .prepare(
      "INSERT INTO profiles (id, name, created_at, updated_at) VALUES (?, ?, unixepoch(), unixepoch())",
    )
    .run(PROFILE_ID, "Pods Test");

  for (let index = 0; index < 4; index++) {
    const bookId = `pods-book-${index}`;
    const passageId = `pods-passage-${index}`;
    db.insert(books)
      .values({
        id: bookId,
        filePath: `data/books/${bookId}.epub`,
        fileName: `${bookId}.epub`,
        fileSize: 1,
        fileHash: bookId,
        mimeType: "application/epub+zip",
        title: `Pods Book ${index}`,
      })
      .run();
    db.insert(passages)
      .values({
        id: passageId,
        bookId,
        spineIndex: index,
        ordinal: index,
        charStart: 10,
        charEnd: 310,
        text: passageText(index),
        tokenCount: 55,
      })
      .run();
    rawDb
      .prepare(
        `INSERT INTO lg_concepts (id, label, kind, df, model_id)
         VALUES (?, ?, 'idea', ?, 'test')`,
      )
      .run(`pods-concept-${index}`, `Principle ${index}`, 10 - index);
    rawDb
      .prepare(
        `INSERT INTO lg_passage_concepts
           (passage_id, concept_id, role, claim, confidence, model_id)
         VALUES (?, ?, 'definition', ?, 0.9, 'test')`,
      )
      .run(passageId, `pods-concept-${index}`, claims[index]);
    rawDb
      .prepare(
        `INSERT INTO cs_passage_salience (passage_id, novelty, prose, salience)
         VALUES (?, 0.8, 0.9, 0.72)`,
      )
      .run(passageId);
    rawDb
      .prepare("INSERT INTO cs_book_class (book_id, category) VALUES (?, 'nonfiction')")
      .run(bookId);
  }

  db.insert(books)
    .values({
      id: "pods-junk-book",
      filePath: "data/books/pods-junk-book.epub",
      fileName: "pods-junk-book.epub",
      fileSize: 1,
      fileHash: "pods-junk-book",
      mimeType: "application/epub+zip",
      title: "Unrelated Field Notes",
    })
    .run();
  db.insert(passages)
    .values({
      id: "pods-junk-passage",
      bookId: "pods-junk-book",
      spineIndex: 0,
      ordinal: 0,
      charStart: 0,
      charEnd: 400,
      text:
        "Mormon crickets migrate across dry rangelands in enormous groups during the summer. " +
        "Their movement changes local vegetation and attracts predators across the surrounding habitat. " +
        "Researchers observe these seasonal migrations to understand population cycles and ecological pressure.",
      tokenCount: 52,
    })
    .run();

  rawDb
    .prepare(
      `INSERT INTO lg_themes
         (id, label, blurb, nonfiction_books, concept_count, passage_count, model_id)
       VALUES (?, 'Learning Better', 'A grounded learning pod.', 4, 6, 4, 'test')`,
    )
    .run(POD_ID);
  // Cross the learning-graph cutover threshold so listPods exercises the LG
  // summary path. Dummy themes need no curriculum for this read-model test.
  const insertTheme = rawDb.prepare(
    `INSERT INTO lg_themes
       (id, label, blurb, nonfiction_books, concept_count, passage_count, model_id)
     VALUES (?, ?, 'Test blurb', 2, 6, 0, 'test')`,
  );
  for (let index = 0; index < 9; index++) {
    insertTheme.run(`lgth_dummy-${index}`, `Dummy ${index}`);
  }
  rawDb
    .prepare(
      `INSERT INTO lg_theme_spine
         (theme_id, step_ordinal, step_title, step_intent, concept_ids, model_id)
       VALUES (?, 1, 'Core principles', 'Compare the sources.', '[]', 'test')`,
    )
    .run(POD_ID);
  const insertSlot = rawDb.prepare(
    `INSERT INTO lg_spine_passages
       (theme_id, step_ordinal, passage_id, role, rank)
     VALUES (?, 1, ?, 'definition', ?)`,
  );
  for (let index = 0; index < 4; index++) {
    insertSlot.run(POD_ID, `pods-passage-${index}`, index);
  }
  insertSlot.run(POD_ID, "pods-junk-passage", 4);

  const insertReadyTheme = rawDb.prepare(
    `INSERT INTO lg_themes
       (id, label, blurb, nonfiction_books, concept_count, passage_count, model_id)
     VALUES (?, ?, 'A grounded learning pod.', 3, 6, 3, 'test')`,
  );
  const insertReadySpine = rawDb.prepare(
    `INSERT INTO lg_theme_spine
       (theme_id, step_ordinal, step_title, step_intent, concept_ids, model_id)
     VALUES (?, 1, 'Core principles', 'Compare the sources.', '[]', 'test')`,
  );
  for (const [id, label] of [
    [DUPLICATE_POD_ID, "Learning Better"],
    [BAD_TITLE_POD_ID, "learning better"],
  ]) {
    insertReadyTheme.run(id, label);
    insertReadySpine.run(id);
    insertSlot.run(id, "pods-passage-0", 0);
    insertSlot.run(id, "pods-passage-2", 1);
    insertSlot.run(id, "pods-passage-3", 2);
  }

  rawDb
    .prepare(
      `INSERT INTO lg_themes
         (id, label, blurb, nonfiction_books, concept_count, passage_count, model_id)
       VALUES ('lgth-underfilled', 'Learning Better', 'A grounded learning pod.', 2, 4, 2, 'test')`,
    )
    .run();
  rawDb
    .prepare(
      `INSERT INTO lg_theme_spine
         (theme_id, step_ordinal, step_title, step_intent, concept_ids, model_id)
       VALUES ('lgth-underfilled', 1, 'Learning basics', 'Compare sources.', '[]', 'test')`,
    )
    .run();
  insertSlot.run("lgth-underfilled", "pods-passage-0", 0);
  insertSlot.run("lgth-underfilled", "pods-passage-1", 1);

  rawDb
    .prepare(
      `INSERT INTO cs_topics
         (id, label, size, book_count, nonfiction_books, display_label, fleet_label, fleet_blurb)
       VALUES ('cs-learning-principles', 'study, memory', 6, 4, 4,
               'study, memory', 'Learning Principles', 'Focused principles for learning well')`,
    )
    .run();
  for (let index = 0; index < 4; index++) {
    rawDb
      .prepare("INSERT INTO cs_passage_topics (passage_id, topic_id) VALUES (?, ?)")
      .run(`pods-passage-${index}`, "cs-learning-principles");
  }

  rawDb
    .prepare(
      `INSERT INTO cs_topics
         (id, label, size, book_count, nonfiction_books, display_label, fleet_label, fleet_blurb)
       VALUES ('cs-audio-processing', 'speech transforms', 6, 3, 3,
               'speech transforms', 'Audio Processing', 'Extracting and processing audio sources')`,
    )
    .run();
});

describe("Pods question contract", () => {
  it("reports actual passage counts rather than concept counts", () => {
    const summary = listPods({ ids: [POD_ID] }).pods[0];
    expect(summary.passageCount).toBe(4);
    expect(summary.passageCount).not.toBe(6);
    expect(summary.bookCount).toBe(4);
    expect(summary.questionCount).toBeGreaterThan(0);
  });

  it("only lists and searches Pods that can open a verified session", () => {
    expect(listPods({ ids: [POD_ID, "lgth-underfilled"] }).pods.map((pod) => pod.id)).toEqual([
      POD_ID,
    ]);
    expect(searchPods("Learning Better").map((pod) => pod.id)).toEqual([POD_ID]);
    expect(listPods({ limit: 80 }).pods.filter((pod) => pod.title === "Learning Better")).toEqual([
      expect.objectContaining({ id: POD_ID }),
    ]);
    expect(listPods({ ids: [BAD_TITLE_POD_ID] }).pods).toEqual([]);
  });

  it("builds deterministic, unambiguous, source-grounded questions", () => {
    const first = getPodSession(POD_ID, PROFILE_ID);
    const second = getPodSession(POD_ID, PROFILE_ID);
    expect(first).toEqual(second);
    expect(first?.items).toHaveLength(4);
    expect(first?.questions.length).toBeGreaterThan(0);

    for (const question of first!.questions) {
      expect(new Set(question.choices.map((choice) => choice.text.toLocaleLowerCase())).size).toBe(
        question.choices.length,
      );
      expect(question.evidence.passageId).toBeTruthy();
      expect(
        first!.items.find((item) => item.passageId === question.evidence.passageId)?.snippet,
      ).toContain(question.evidence.excerpt);
      expect(question.choices.some((choice) => choice.text === question.evidence.excerpt)).toBe(
        true,
      );
      const source = rawDb
        .prepare("SELECT text FROM passages WHERE id = ?")
        .get(question.evidence.passageId) as { text: string };
      expect(source.text).toContain(question.evidence.excerpt);
    }
  });

  it("filters stale, high-quality prose that is unrelated to the Pod", () => {
    const session = getPodSession(POD_ID, PROFILE_ID)!;
    expect(session.items).toHaveLength(4);
    expect(session.items.map((item) => item.passageId)).not.toContain("pods-junk-passage");
    expect(
      podPassageRelevance("Audio Processing", "Extracting and processing audio data", {
        bookTitle: "Unrelated Field Notes",
        chapterTitle: "Seasonal migration",
        text: "Mormon crickets migrate across rangelands. Researchers track their population cycles.",
      }).relevant,
    ).toBe(false);
    expect(
      podPassageRelevance("Audio Processing", "Extracting and processing audio data", {
        bookTitle: "Practical Audio Processing",
        chapterTitle: "Cleaning recordings",
        text: "Audio processing removes noise from a recording while preserving the speaker's voice.",
      }).relevant,
    ).toBe(true);
  });

  it("rejects structural artifacts, front matter, and underfilled sessions", () => {
    expect(
      isTeachablePodPassage(
        "The dataset entry '/downloads/LibriSpeech/dev-clean/1272/file.flac' has 'id': '1272-0' and 'text': 'A SAMPLE'. This serialized record is followed by configuration values and more generated metadata. It is not a readable explanation for a learner.",
        0.9,
      ),
    ).toBe(false);
    expect(
      isTeachablePodPassage(
        "Praise for Alexander Hamilton. This magnificent and enthralling biography is essential reading for every citizen. The reviewer recommends it warmly and celebrates the author's storytelling across hundreds of pages.",
        0.9,
      ),
    ).toBe(false);
    expect(
      isTeachablePodPassage(
        "Colophon. The bird on the cover is a coconut lorikeet, a relative of parakeets and parrots. This decorative note describes the jacket illustration and production details for this edition.",
        0.9,
      ),
    ).toBe(false);
    expect(
      isTeachablePodPassage(
        "Welcome. Thank you for supporting this early edition with your purchase. This material will be updated during production and provides access to future chapters and companion files.",
        0.9,
      ),
    ).toBe(false);
    expect(
      isTeachablePodPassage(
        "Rogers, Richard and Sabine Niederer (2019) The Politics of Social Media Manipulation, The Hague: Ministry of Internal Affairs. Sommer, Will (2018) Instagram Is the New Home for Political Influence Campaigns, Washington: Daily Beast.",
        0.9,
      ),
    ).toBe(false);
    expect(isPodContentChapter("ref")).toBe(false);
    expect(isPodContentChapter("Colophon")).toBe(false);
    expect(isPodContentChapter("References")).toBe(false);
    expect(isPodContentChapter("B18784_Index_RN")).toBe(false);
    expect(isPodContentChapter("A useful chapter")).toBe(true);
    expect(
      podSourceStatement(
        "Chapter 5 Evolution of question-answering system from information retrieval DOI: 10.1201/9781003244332-5 5.1 Introduction It was 1960 when scientists first felt the need to connect their computers and share completed work.",
      ),
    ).toBe(
      "It was 1960 when scientists first felt the need to connect their computers and share completed work.",
    );
    expect(isQualityPodTitle("Natural Language Processing")).toBe(true);
    expect(isQualityPodTitle("Project Setup")).toBe(true);
    expect(isQualityPodTitle("well positioned, Enron could deliver, handsomely rewarded")).toBe(
      false,
    );
    expect(isQualityPodTitle("Doing Something Smart Stupid")).toBe(false);
    expect(isQualityPodTitle("First Place Growth")).toBe(false);
    expect(isQualityPodTitle("Four Year Retrospectives")).toBe(false);
    expect(getPodSession("lgth-underfilled", PROFILE_ID)).toBeNull();
  });

  it("searches the same visible concept-fallback title shown on Pod cards", () => {
    expect(conceptSearchJourneys("audio processing").map((pod) => pod.id)).toContain(
      "cs-audio-processing",
    );
    expect(conceptSearchJourneys("AUDIO PROCESSING").map((pod) => pod.id)).toContain(
      "cs-audio-processing",
    );
    expect(conceptSearchJourneys("speech transforms").map((pod) => pod.id)).toContain(
      "cs-audio-processing",
    );
    expect(conceptSearchJourneys("%")).toEqual([]);
  });

  it("builds grounded questions for concept-fallback Pods too", () => {
    const session = getPodSession("cs-learning-principles", PROFILE_ID)!;
    expect(session.source).toBe("concept-fallback");
    expect(session.questions.length).toBeGreaterThan(0);
    for (const question of session.questions) {
      expect(question.choices.some((choice) => choice.text === question.evidence.excerpt)).toBe(
        true,
      );
    }
  });

  it("grades against the choices that were compiled and rejects fabricated IDs", () => {
    const session = getPodSession(POD_ID, PROFILE_ID)!;
    const question = session.questions.find(
      (candidate) => candidate.evidence.passageId === "pods-passage-0",
    )!;
    const correctChoice = question.choices.find(
      (choice) => choice.text === question.evidence.excerpt,
    )!;
    const wrongChoice = question.choices.find((choice) => choice.id !== correctChoice.id)!;
    const attemptCount = () =>
      (
        rawDb
          .prepare("SELECT COUNT(*) AS count FROM pod_quiz_attempts WHERE profile_id = ?")
          .get(PROFILE_ID) as { count: number }
      ).count;

    expect(
      answerPodQuestion({
        podId: POD_ID,
        questionId: question.id,
        selectedChoiceId: "fabricated-choice",
        profileId: PROFILE_ID,
      }),
    ).toBeNull();
    expect(attemptCount()).toBe(0);

    expect(
      answerPodQuestion({
        podId: POD_ID,
        questionId: question.id,
        selectedChoiceId: correctChoice.id,
        profileId: PROFILE_ID,
      })?.correct,
    ).toBe(true);
    expect(
      answerPodQuestion({
        podId: POD_ID,
        questionId: question.id,
        selectedChoiceId: wrongChoice.id,
        profileId: PROFILE_ID,
      })?.correct,
    ).toBe(false);
    expect(attemptCount()).toBe(2);

    const restoredQuestion = getPodSession(POD_ID, PROFILE_ID)!.questions.find(
      (candidate) => candidate.id === question.id,
    )!;
    expect(restoredQuestion.savedAnswer).toEqual({
      selectedChoiceId: correctChoice.id,
      result: {
        correct: true,
        feedback: "That matches the source.",
        evidence: question.evidence,
      },
    });
    expect(
      getPodSession(POD_ID)!.questions.find((candidate) => candidate.id === question.id)!
        .savedAnswer,
    ).toBeNull();

    const retryAttemptId = "stable-client-attempt";
    const retry = () =>
      answerPodQuestion({
        podId: POD_ID,
        revision: session.revision,
        questionId: question.id,
        selectedChoiceId: wrongChoice.id,
        attemptId: retryAttemptId,
        profileId: PROFILE_ID,
      });
    expect(retry()?.correct).toBe(false);
    expect(retry()?.correct).toBe(false);
    expect(attemptCount()).toBe(3);
    expect(
      answerPodQuestion({
        podId: POD_ID,
        revision: "stale-revision",
        questionId: question.id,
        selectedChoiceId: wrongChoice.id,
        profileId: PROFILE_ID,
      }),
    ).toBeNull();
    expect(attemptCount()).toBe(3);
  });
});
