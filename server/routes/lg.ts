/**
 * Learning-graph (lg_*) admin routes — Phase 0 prove-or-kill.
 *
 * Stage-by-stage endpoints (extraction is ledger-cached, so downstream stages
 * re-run cheaply while iterating prompts/thresholds) plus a phase0
 * orchestrator, a dry-run sample/benchmark (the 7B-vs-14B decision AND the
 * Phase-2 feasibility number), and the side-by-side compare surface that IS
 * the scale/kill decision gate. All LLM passes run detached on the serial
 * inference lane — poll the /status endpoints. Mounted behind /api/admin/*.
 */
import { Hono } from "hono";
import { rawDb } from "../../app/lib/db";
import { startPass, passStatus } from "../../app/lib/llm/lane";
import { ensureLgTables } from "../../app/lib/lg/schema";
import { extractTheme, sampleExtraction, extractLibrary } from "../../app/lib/lg/extract";
import { reconcileTheme, reconcileLibrary } from "../../app/lib/lg/reconcile";
import { buildThemePrereqs } from "../../app/lib/lg/prereqs";
import { compileSpine, compileSpines, validateSpine } from "../../app/lib/lg/spine";
import { nameThemes } from "../../app/lib/lg/themes";
import { runLgWorker } from "../../app/lib/lg/worker";
import { lgJourneysLive, lgBuildCurriculum } from "../../app/lib/lg/read-models";
import { LG_JOURNEY_WHERE } from "../../app/lib/lg/schema";
import { runBookClassification } from "../../app/lib/reckoning/classify";
import { ensureJourneyColumns, buildConceptCurriculum } from "../../app/lib/concept/wander";
import { ensureBookClassTable } from "../../app/lib/reckoning/classify";

const app = new Hono();

const jsonBody = async <T>(c: { req: { json: () => Promise<unknown> } }): Promise<T> => {
  try {
    return (await c.req.json()) as T;
  } catch {
    return {} as T;
  }
};

const themeIdFor = (topicId: string) => `lgt_${topicId}`;

// --- stage endpoints -------------------------------------------------------

app.post("/api/admin/lg/extract", async (c) => {
  const body = await jsonBody<{
    topicId?: string;
    scope?: "topic" | "books";
    limit?: number;
    model?: string;
  }>(c);
  if (!body.topicId) return c.json({ ok: false, error: "topicId required" }, 400);
  const { topicId, scope, limit, model } = body;
  const started = startPass("lg-extract", (status) =>
    extractTheme(topicId, { scope, limit, model }, status),
  );
  if (!started.started)
    return c.json({ ok: false, error: started.reason, status: passStatus("lg-extract") }, 409);
  return c.json({ ok: true, started: true, themeId: themeIdFor(topicId) });
});
app.get("/api/admin/lg/extract/status", (c) => c.json(passStatus("lg-extract")));

app.post("/api/admin/lg/reconcile", async (c) => {
  const body = await jsonBody<{ themeId?: string; threshold?: number; model?: string }>(c);
  if (!body.themeId) return c.json({ ok: false, error: "themeId required" }, 400);
  const { themeId, threshold, model } = body;
  const started = startPass("lg-reconcile", (status) =>
    reconcileTheme(themeId, { threshold, model }, status),
  );
  if (!started.started)
    return c.json({ ok: false, error: started.reason, status: passStatus("lg-reconcile") }, 409);
  return c.json({ ok: true, started: true });
});
app.get("/api/admin/lg/reconcile/status", (c) => c.json(passStatus("lg-reconcile")));

app.post("/api/admin/lg/prereqs", async (c) => {
  const body = await jsonBody<{ themeId?: string }>(c);
  if (!body.themeId) return c.json({ ok: false, error: "themeId required" }, 400);
  const { themeId } = body;
  const started = startPass("lg-prereqs", () => buildThemePrereqs(themeId));
  if (!started.started)
    return c.json({ ok: false, error: started.reason, status: passStatus("lg-prereqs") }, 409);
  return c.json({ ok: true, started: true });
});
app.get("/api/admin/lg/prereqs/status", (c) => c.json(passStatus("lg-prereqs")));

app.post("/api/admin/lg/compile", async (c) => {
  const body = await jsonBody<{ themeId?: string; model?: string }>(c);
  if (!body.themeId) return c.json({ ok: false, error: "themeId required" }, 400);
  const { themeId, model } = body;
  const started = startPass("lg-compile", (status) => compileSpine(themeId, { model }, status));
  if (!started.started)
    return c.json({ ok: false, error: started.reason, status: passStatus("lg-compile") }, 409);
  return c.json({ ok: true, started: true });
});
app.get("/api/admin/lg/compile/status", (c) => c.json(passStatus("lg-compile")));

// --- phase0 orchestrator: extract → reconcile → prereqs → compile ----------

app.post("/api/admin/lg/phase0", async (c) => {
  const body = await jsonBody<{
    topicId?: string;
    scope?: "topic" | "books";
    limit?: number;
    model?: string;
    threshold?: number;
  }>(c);
  if (!body.topicId) return c.json({ ok: false, error: "topicId required" }, 400);
  const { topicId, scope, limit, model, threshold } = body;
  const themeId = themeIdFor(topicId);
  const started = startPass("lg-phase0", async (status) => {
    status.note = "extract";
    const extract = await extractTheme(topicId, { scope, limit, model }, status);
    status.note = "reconcile";
    const reconcile = await reconcileTheme(themeId, { threshold, model }, status);
    status.note = "prereqs";
    const prereqs = await buildThemePrereqs(themeId);
    status.note = "compile";
    const spine = await compileSpine(themeId, { model }, status);
    status.note = "done";
    return { extract, reconcile, prereqs, spine };
  });
  if (!started.started)
    return c.json({ ok: false, error: started.reason, status: passStatus("lg-phase0") }, 409);
  return c.json({ ok: true, started: true, themeId });
});
app.get("/api/admin/lg/phase0/status", (c) => c.json(passStatus("lg-phase0")));

// --- sample / benchmark (dry run, writes nothing) ---------------------------

app.post("/api/admin/lg/sample", async (c) => {
  const body = await jsonBody<{ limit?: number; topicId?: string; model?: string }>(c);
  const { limit, topicId, model } = body;
  const started = startPass("lg-sample", (status) =>
    sampleExtraction({ limit, topicId, model }, status),
  );
  if (!started.started)
    return c.json({ ok: false, error: started.reason, status: passStatus("lg-sample") }, 409);
  return c.json({ ok: true, started: true });
});
app.get("/api/admin/lg/sample/status", (c) => c.json(passStatus("lg-sample")));

// --- Phase 2: library-scale passes -------------------------------------------

app.post("/api/admin/lg/extract-library", async (c) => {
  const body = await jsonBody<{ model?: string; limitBooks?: number }>(c);
  const started = startPass("lg-extract-library", (status) =>
    extractLibrary({ model: body.model, limitBooks: body.limitBooks }, status),
  );
  if (!started.started)
    return c.json(
      { ok: false, error: started.reason, status: passStatus("lg-extract-library") },
      409,
    );
  return c.json({ ok: true, started: true });
});
app.get("/api/admin/lg/extract-library/status", (c) => c.json(passStatus("lg-extract-library")));

app.post("/api/admin/lg/reconcile-library", async (c) => {
  const body = await jsonBody<{ threshold?: number; maxPairs?: number; model?: string }>(c);
  const started = startPass("lg-reconcile-library", (status) => reconcileLibrary(body, status));
  if (!started.started)
    return c.json(
      { ok: false, error: started.reason, status: passStatus("lg-reconcile-library") },
      409,
    );
  return c.json({ ok: true, started: true });
});
app.get("/api/admin/lg/reconcile-library/status", (c) =>
  c.json(passStatus("lg-reconcile-library")),
);

app.post("/api/admin/lg/form-themes", async (c) => {
  // On the lane so it serializes with LLM passes (the heavy work runs in the
  // lg-graph-worker; the lane slot just waits on it).
  const started = startPass("lg-form-themes", async (status) => {
    status.note = "building concept graph (worker)…";
    return runLgWorker("form-themes", {}, (info) => {
      if (typeof info.line === "string") status.note = info.line;
    });
  });
  if (!started.started)
    return c.json({ ok: false, error: started.reason, status: passStatus("lg-form-themes") }, 409);
  return c.json({ ok: true, started: true });
});
app.get("/api/admin/lg/form-themes/status", (c) => c.json(passStatus("lg-form-themes")));

app.post("/api/admin/lg/name-themes", async (c) => {
  const body = await jsonBody<{ limit?: number; model?: string }>(c);
  const started = startPass("lg-name-themes", (status) => nameThemes(body, status));
  if (!started.started)
    return c.json({ ok: false, error: started.reason, status: passStatus("lg-name-themes") }, 409);
  return c.json({ ok: true, started: true });
});
app.get("/api/admin/lg/name-themes/status", (c) => c.json(passStatus("lg-name-themes")));

app.post("/api/admin/lg/compile-batch", async (c) => {
  const body = await jsonBody<{ top?: number; model?: string }>(c);
  const top = body.top ?? 20;
  const started = startPass("lg-compile-batch", async (status) => {
    const ids = (
      rawDb
        .prepare(
          `SELECT id FROM lg_themes WHERE ${LG_JOURNEY_WHERE}
            ORDER BY nonfiction_books DESC, concept_count DESC LIMIT ?`,
        )
        .all(top) as { id: string }[]
    ).map((r) => r.id);
    return compileSpines(ids, { model: body.model }, status);
  });
  if (!started.started)
    return c.json(
      { ok: false, error: started.reason, status: passStatus("lg-compile-batch") },
      409,
    );
  return c.json({ ok: true, started: true });
});
app.get("/api/admin/lg/compile-batch/status", (c) => c.json(passStatus("lg-compile-batch")));

// The full Phase-2 pipeline. skipNaming stops before the stage that trips the
// journey cutover, leaving form-themes output inspectable via /admin/lg/themes.
app.post("/api/admin/lg/phase2", async (c) => {
  const body = await jsonBody<{
    model?: string;
    threshold?: number;
    top?: number;
    skipNaming?: boolean;
  }>(c);
  const started = startPass("lg-phase2", async (status) => {
    const stages: Record<string, unknown> = {};
    const stageNote = (n: number, label: string) => {
      status.note = `stage ${n}/6 · ${label}`;
    };

    stageNote(1, "classify remaining books");
    stages.classify = await runBookClassification({ limit: 5000 }, status);

    stageNote(2, "extract library");
    stages.extract = await extractLibrary({ model: body.model }, status);

    stageNote(3, "reconcile library");
    stages.reconcile = await reconcileLibrary(
      { threshold: body.threshold, model: body.model },
      status,
    );

    stageNote(4, "form themes (worker)");
    stages.themes = await runLgWorker("form-themes", {}, (info) => {
      if (typeof info.line === "string") status.note = `stage 4/6 · ${info.line}`;
    });

    if (body.skipNaming) {
      status.note = "stopped before naming (skipNaming) — eyeball /api/admin/lg/themes";
      return stages;
    }

    stageNote(5, "name themes");
    stages.naming = await nameThemes({ model: body.model }, status);

    stageNote(6, "compile top spines");
    const ids = (
      rawDb
        .prepare(
          `SELECT id FROM lg_themes WHERE ${LG_JOURNEY_WHERE}
            ORDER BY nonfiction_books DESC, concept_count DESC LIMIT ?`,
        )
        .all(body.top ?? 20) as { id: string }[]
    ).map((r) => r.id);
    stages.spines = await compileSpines(ids, { model: body.model }, status);

    status.note = "phase 2 complete";
    return stages;
  });
  if (!started.started)
    return c.json({ ok: false, error: started.reason, status: passStatus("lg-phase2") }, 409);
  return c.json({ ok: true, started: true });
});
app.get("/api/admin/lg/phase2/status", (c) => c.json(passStatus("lg-phase2")));

// Mid-grind observability: ledger status counts, concept growth, error samples.
app.get("/api/admin/lg/ledger", (c) => {
  ensureLgTables();
  const ledger = rawDb
    .prepare("SELECT status, COUNT(*) AS n FROM lg_passage_extractions GROUP BY status")
    .all() as Array<{ status: string; n: number }>;
  const concepts = rawDb
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN merged_into IS NULL THEN 1 ELSE 0 END) AS canonical
         FROM lg_concepts`,
    )
    .get();
  const links = rawDb
    .prepare(
      "SELECT COUNT(*) AS n, COUNT(DISTINCT passage_id) AS passages FROM lg_passage_concepts",
    )
    .get();
  const topDf = rawDb
    .prepare(
      "SELECT id, label, kind, df FROM lg_concepts WHERE merged_into IS NULL ORDER BY df DESC LIMIT 30",
    )
    .all();
  const recentErrors = rawDb
    .prepare(
      `SELECT passage_id AS passageId, reason, extracted_at AS at
         FROM lg_passage_extractions WHERE status = 'error'
        ORDER BY extracted_at DESC LIMIT 10`,
    )
    .all();
  // Growth curve: concepts linked per extraction-hour bucket (deceleration check —
  // linear-to-the-end = vocabulary drift signal).
  const growth = rawDb
    .prepare(
      `SELECT (extracted_at / 3600) * 3600 AS hour,
              SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok,
              SUM(CASE WHEN status = 'excluded' THEN 1 ELSE 0 END) AS excluded,
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
         FROM lg_passage_extractions GROUP BY hour ORDER BY hour DESC LIMIT 24`,
    )
    .all();
  return c.json({ ok: true, ledger, concepts, links, topDf, recentErrors, growthByHour: growth });
});

// All themes with gate/naming/spine state — the pre-cutover eyeball surface.
app.get("/api/admin/lg/themes", (c) => {
  ensureLgTables();
  const gatedOnly = c.req.query("gated") === "1";
  const rows = rawDb
    .prepare(
      `SELECT id, label, blurb, concept_count AS conceptCount, passage_count AS passageCount,
              nonfiction_books AS nonfictionBooks, source_topic_id AS sourceTopicId,
              (CASE WHEN ${LG_JOURNEY_WHERE} THEN 1 ELSE 0 END) AS gated,
              (CASE WHEN blurb IS NOT NULL THEN 1 ELSE 0 END) AS named,
              (SELECT COUNT(*) FROM lg_theme_spine s WHERE s.theme_id = lg_themes.id) AS spineSteps
         FROM lg_themes
        ${gatedOnly ? `WHERE ${LG_JOURNEY_WHERE}` : ""}
        ORDER BY nonfiction_books DESC, concept_count DESC LIMIT 500`,
    )
    .all();
  const count = (sql: string) => (rawDb.prepare(sql).get() as { n: number }).n;
  return c.json({
    ok: true,
    counts: {
      themes: count("SELECT COUNT(*) AS n FROM lg_themes"),
      gated: count(`SELECT COUNT(*) AS n FROM lg_themes WHERE ${LG_JOURNEY_WHERE}`),
      named: count(
        `SELECT COUNT(*) AS n FROM lg_themes WHERE ${LG_JOURNEY_WHERE} AND blurb IS NOT NULL`,
      ),
      spined: count(
        "SELECT COUNT(*) AS n FROM lg_themes WHERE EXISTS (SELECT 1 FROM lg_theme_spine s WHERE s.theme_id = lg_themes.id)",
      ),
      cutoverLive: lgJourneysLive(),
    },
    themes: rows,
  });
});

// Draft/spine curriculum for a theme — pre-cutover eyeballing (never enqueues).
app.get("/api/admin/lg/theme/:id/curriculum", (c) => {
  const cur = lgBuildCurriculum(c.req.param("id"), undefined, { noEnqueue: true });
  if (!cur) return c.json({ ok: false, error: "theme not found or empty" }, 404);
  return c.json({ ok: true, curriculum: cur });
});

// --- inspection --------------------------------------------------------------

const snip = (s: string, n = 240) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);

app.get("/api/admin/lg/theme/:id", (c) => {
  ensureLgTables();
  const themeId = c.req.param("id");
  const theme = rawDb
    .prepare(
      "SELECT id, label, blurb, nonfiction_books AS nonfictionBooks, source_topic_id AS sourceTopicId, model_id AS modelId FROM lg_themes WHERE id = ?",
    )
    .get(themeId);
  if (!theme) return c.json({ ok: false, error: "theme not found" }, 404);

  const concepts = rawDb
    .prepare(
      `SELECT c.id, c.label, c.kind, c.df,
              (SELECT GROUP_CONCAT(a.label, ' | ') FROM lg_concepts a WHERE a.merged_into = c.id) AS aliases
         FROM lg_concepts c
        WHERE c.merged_into IS NULL
          AND EXISTS (SELECT 1 FROM lg_passage_concepts pc
                        JOIN lg_theme_passages tp ON tp.passage_id = pc.passage_id AND tp.theme_id = ?
                       WHERE pc.concept_id = c.id)
        ORDER BY c.df DESC`,
    )
    .all(themeId);

  const prereqs = rawDb
    .prepare(
      `SELECT ca.label AS concept, cb.label AS requires, p.weight
         FROM lg_concept_prereqs p
         JOIN lg_concepts ca ON ca.id = p.concept_id
         JOIN lg_concepts cb ON cb.id = p.requires_concept_id
        ORDER BY p.weight DESC`,
    )
    .all();

  const steps = (
    rawDb
      .prepare(
        "SELECT step_ordinal AS ordinal, step_title AS title, step_intent AS intent, concept_ids AS cids FROM lg_theme_spine WHERE theme_id = ? ORDER BY step_ordinal",
      )
      .all(themeId) as Array<{ ordinal: number; title: string; intent: string; cids: string }>
  ).map((s) => ({
    ordinal: s.ordinal,
    title: s.title,
    intent: s.intent,
    concepts: (JSON.parse(s.cids) as string[]).map(
      (id) =>
        (
          rawDb.prepare("SELECT label FROM lg_concepts WHERE id = ?").get(id) as
            | { label: string }
            | undefined
        )?.label ?? id,
    ),
    passages: rawDb
      .prepare(
        `SELECT sp.passage_id AS passageId, sp.role, sp.rank, b.title AS bookTitle, p.text
           FROM lg_spine_passages sp
           JOIN passages p ON p.id = sp.passage_id
           JOIN books b ON b.id = p.book_id
          WHERE sp.theme_id = ? AND sp.step_ordinal = ? ORDER BY sp.rank`,
      )
      .all(themeId, s.ordinal)
      .map((r) => {
        const row = r as {
          passageId: string;
          role: string;
          rank: number;
          bookTitle: string;
          text: string;
        };
        return { ...row, text: undefined, snippet: snip(row.text) };
      }),
  }));

  const ledger = rawDb
    .prepare(
      `SELECT status, COUNT(*) AS n FROM lg_passage_extractions e
        JOIN lg_theme_passages tp ON tp.passage_id = e.passage_id AND tp.theme_id = ?
        GROUP BY status`,
    )
    .all(themeId);

  return c.json({
    ok: true,
    theme,
    concepts,
    prereqs,
    steps,
    ledger,
    validation: validateSpine(themeId),
  });
});

// --- the decision gate: side-by-side compare ---------------------------------

interface CompareColumnItem {
  bookTitle: string;
  role: string | null;
  snippet: string;
}
interface CompareStep {
  title: string;
  intent: string | null;
  items: CompareColumnItem[];
}

app.get("/api/admin/lg/compare/:topicId", (c) => {
  ensureLgTables();
  ensureJourneyColumns(); // buildConceptCurriculum assumes the derived columns exist
  ensureBookClassTable(); // ...and joins this runtime-DDL table
  const topicId = c.req.param("topicId");
  const themeId = themeIdFor(topicId);

  // Column A — today's journey: salience-ordered concept-substrate curriculum.
  const current = buildConceptCurriculum(topicId, undefined);
  const currentSteps: CompareStep[] = [];
  if (current) {
    const byModule = new Map<string, CompareColumnItem[]>();
    for (const item of current.items as Array<{
      module: string;
      bookTitle: string;
      snippet: string;
    }>) {
      const list = byModule.get(item.module) ?? [];
      list.push({ bookTitle: item.bookTitle, role: null, snippet: item.snippet });
      byModule.set(item.module, list);
    }
    for (const [module, items] of byModule)
      currentSteps.push({ title: module, intent: null, items });
  }

  // Column B — the learning-graph spine.
  const theme = rawDb
    .prepare("SELECT label, model_id AS modelId FROM lg_themes WHERE id = ?")
    .get(themeId) as { label: string | null; modelId: string | null } | undefined;
  const lgSteps: CompareStep[] = (
    rawDb
      .prepare(
        "SELECT step_ordinal AS ordinal, step_title AS title, step_intent AS intent FROM lg_theme_spine WHERE theme_id = ? ORDER BY step_ordinal",
      )
      .all(themeId) as Array<{ ordinal: number; title: string; intent: string | null }>
  ).map((s) => ({
    title: `${s.ordinal}. ${s.title}`,
    intent: s.intent,
    items: (
      rawDb
        .prepare(
          `SELECT sp.role, b.title AS bookTitle, p.text
             FROM lg_spine_passages sp
             JOIN passages p ON p.id = sp.passage_id
             JOIN books b ON b.id = p.book_id
            WHERE sp.theme_id = ? AND sp.step_ordinal = ? ORDER BY sp.rank`,
        )
        .all(themeId, s.ordinal) as Array<{ role: string; bookTitle: string; text: string }>
    ).map((r) => ({ bookTitle: r.bookTitle, role: r.role, snippet: snip(r.text) })),
  }));

  if (c.req.query("format") !== "html") {
    return c.json({ ok: true, current: { steps: currentSteps }, lg: { theme, steps: lgSteps } });
  }

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const column = (title: string, sub: string, steps: CompareStep[]) => `
    <div class="col">
      <h2>${esc(title)}</h2>
      <p class="sub">${esc(sub)}</p>
      ${
        steps.length === 0
          ? '<p class="empty">Nothing here yet.</p>'
          : steps
              .map(
                (s) => `
        <section>
          <h3>${esc(s.title)}</h3>
          ${s.intent ? `<p class="intent">${esc(s.intent)}</p>` : ""}
          ${s.items
            .map(
              (i) => `
            <article>
              <div class="meta">${i.role ? `<span class="role">${esc(i.role)}</span>` : ""}<span class="book">${esc(i.bookTitle)}</span></div>
              <p>${esc(i.snippet)}</p>
            </article>`,
            )
            .join("")}
        </section>`,
              )
              .join("")
      }
    </div>`;

  return c.html(`<!doctype html>
<meta charset="utf-8">
<title>Journey compare — ${esc(theme?.label ?? topicId)}</title>
<style>
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif; margin: 0; background: #111; color: #ddd; }
  header { padding: 16px 24px; border-bottom: 1px solid #333; }
  header h1 { margin: 0 0 4px; font-size: 18px; }
  header p { margin: 0; color: #999; font-size: 13px; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
  .col { padding: 16px 24px; min-width: 0; }
  .col + .col { border-left: 1px solid #333; }
  .col h2 { font-size: 15px; margin: 0 0 2px; }
  .sub { color: #888; font-size: 12px; margin: 0 0 16px; }
  section { margin-bottom: 20px; }
  h3 { font-size: 14px; margin: 0 0 2px; color: #9cf; }
  .intent { color: #999; font-size: 12px; margin: 0 0 8px; }
  article { border: 1px solid #2a2a2a; border-radius: 8px; padding: 8px 12px; margin: 6px 0; }
  article p { margin: 4px 0 0; color: #ccc; }
  .meta { font-size: 11px; color: #888; display: flex; gap: 8px; }
  .role { text-transform: uppercase; letter-spacing: 0.05em; color: #fb8; }
  .book { font-style: italic; }
  .empty { color: #777; }
  footer { padding: 12px 24px; border-top: 1px solid #333; color: #777; font-size: 12px; }
</style>
<header>
  <h1>${esc(theme?.label ?? topicId)}</h1>
  <p>Judge: <b>no junk</b> · <b>taught in order</b> (definitions before applications) · <b>cross-book</b> (every treating book contributes) — criterion 4, <b>recompiles</b>, is procedural: re-run phase0 with scope:"books" and diff /api/admin/lg/theme/${esc(themeId)}.</p>
</header>
<div class="cols">
  ${column("Today: salience-ordered", "cs_topics keyphrase substrate — buildConceptCurriculum", currentSteps)}
  ${column("Learning graph spine", `LLM-ingested (${esc(theme?.modelId ?? "no run yet")}) — verbatim passages slotted by role`, lgSteps)}
</div>
<footer>lg_* Phase 0 — prove-or-kill. Scale (Phase 1/2) only if the right column is clearly better.</footer>`);
});

export const lgRoutes = app;
