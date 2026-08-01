/**
 * Reckoning — tension adjudication (server-side Ollama).
 *
 * mine.ts fills cs_tension_candidates with cross-book passage pairs that share
 * a subject; this pass asks the local LLM to decide each pair's relationship
 * (agree/contradict/qualify/neutral) with VERBATIM grounded spans. Grounding is
 * enforced inside judgeTension (retry → snap-to-source → downgrade-to-neutral),
 * so a non-neutral verdict always quotes real substrings of the passages.
 *
 * Rows go candidate → judged in one step. A per-pair failure leaves the row
 * 'candidate', so the pass is resumable; run detached on the LLM lane.
 */
import { rawDb } from "../db";
import { judgeTension } from "../llm/ollama";
import { tick, type PassStatus } from "../llm/lane";

/** Parse the stored JSON `shared` column into a string[] (best-effort). */
function parseShared(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

export async function runTensionJudging(
  opts: { limit?: number },
  status?: PassStatus,
): Promise<{ judged: number; failed: number; skipped: number; byVerdict: Record<string, number> }> {
  const limit = opts?.limit ?? 100;

  // Fleet-era rows stuck in 'queued' (enqueued to devices that no longer exist)
  // would otherwise be orphaned forever — fold them back into the candidate pool.
  rawDb
    .prepare("UPDATE cs_tension_candidates SET status = 'candidate' WHERE status = 'queued'")
    .run();

  const rows = rawDb
    .prepare(
      `SELECT id, passage_a, passage_b, shared
       FROM cs_tension_candidates
       WHERE status = 'candidate'
       ORDER BY heuristic_score DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{ id: string; passage_a: string; passage_b: string; shared: string }>;

  const getText = rawDb.prepare("SELECT text FROM passages WHERE id = ?");
  const applyVerdict = rawDb.prepare(
    `UPDATE cs_tension_candidates
     SET status = 'judged', verdict = ?, tension = ?, stance_question = ?, span_a = ?, span_b = ?, judged_at = unixepoch()
     WHERE id = ?`,
  );

  if (status) status.total = rows.length;
  let judged = 0;
  let failed = 0;
  let skipped = 0;
  const byVerdict: Record<string, number> = {};
  for (const row of rows) {
    const a = getText.get(row.passage_a) as { text: string } | undefined;
    const b = getText.get(row.passage_b) as { text: string } | undefined;
    if (!a?.text || !b?.text) {
      skipped++; // pair whose passages vanished (re-ingest minted new ids)
      if (status) status.processed++;
      continue;
    }
    try {
      const r = await judgeTension({
        subject: parseShared(row.shared).join(", "),
        textA: a.text,
        textB: b.text,
      });
      applyVerdict.run(r.verdict, r.tension, r.stanceQuestion, r.spanA, r.spanB, row.id);
      byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
      judged++;
    } catch (e) {
      failed++;
      console.warn(`[judge] ${row.id}: ${e instanceof Error ? e.message : e}`);
    }
    if (status) {
      status.processed++;
      status.note = row.id;
    }
    await tick();
  }

  return { judged, failed, skipped, byVerdict };
}
