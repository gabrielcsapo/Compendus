"use server";

/**
 * Server actions for the web's substrate surfaces (wander v2, journeys,
 * trails). These are the web client's path to the same lib functions the HTTP
 * routes wrap for iOS — one implementation, two transports. Profile comes from
 * the request cookie (resolveProfileId), exactly like the rest of app/actions.
 */
import { randomUUID } from "node:crypto";
import { rawDb } from "../lib/db";
import { resolveProfileId } from "../lib/profile";
import {
  getStop,
  startRandom,
  startFromQuery,
  startFromBook,
  type WanderStop,
} from "../lib/knowledge/wander2";
import { substrateReady } from "../lib/knowledge/atlas";
import {
  listConceptJourneyTopics,
  buildConceptCurriculum,
  conceptAdjacentTopics,
  conceptSearchJourneys,
} from "../lib/concept/wander";

export async function wanderStart(opts: {
  query?: string;
  bookId?: string;
}): Promise<WanderStop | null> {
  if (!substrateReady()) return null;
  const profileId = resolveProfileId();
  let passageId: string | null = null;
  if (opts.query?.trim()) passageId = await startFromQuery(opts.query.trim());
  else if (opts.bookId) passageId = startFromBook(opts.bookId);
  else passageId = startRandom();
  return passageId ? getStop(passageId, { profileId }) : null;
}

export async function wanderStop(
  passageId: string,
  visited: string[] = [],
): Promise<WanderStop | null> {
  return getStop(passageId, { visited: visited.slice(-200), profileId: resolveProfileId() });
}

export async function getJourneyTopics(opts: { limit?: number; offset?: number; ids?: string[] }) {
  // Cutover: journeys now read the concept substrate (cs_topics) instead of the
  // old embedding/GLiNER topics. Same shape the UI expects (id/label/size/bookCount).
  return listConceptJourneyTopics(opts);
}

export async function getRealms() {
  // Realm clustering isn't part of the concept substrate yet — empty bar, topics
  // still render. (Old path: listRealms(resolveProfileId()).)
  return [];
}

export async function searchJourneys(q: string) {
  if (!q.trim()) return [];
  // Search the concept substrate so results resolve to the same topics the list
  // and detail use (the old atlas search returned legacy topic ids that 404'd).
  return conceptSearchJourneys(q.trim());
}

export async function getJourney(topicId: string) {
  const profileId = resolveProfileId();
  // Concept-substrate journey detail — fixes the substrate mismatch where the old
  // buildCurriculum looked a cs_topics id up in the legacy `topics` table.
  return {
    curriculum: buildConceptCurriculum(topicId, profileId),
    adjacent: conceptAdjacentTopics(topicId),
  };
}

export async function saveTrail(
  path: string[],
  title?: string,
): Promise<{ id: string; title: string } | null> {
  const profileId = resolveProfileId();
  if (!profileId || path.length === 0) return null;
  const id = randomUUID();
  const trailTitle = title?.trim().slice(0, 120) || `Trail of ${path.length} ideas`;
  rawDb
    .prepare("INSERT INTO trails (id, profile_id, title, path_json) VALUES (?, ?, ?, ?)")
    .run(id, profileId, trailTitle, JSON.stringify(path.slice(0, 500)));
  return { id, title: trailTitle };
}
