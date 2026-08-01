"use server";

/**
 * Server actions for the web's substrate surfaces (Wander, Pods,
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
  adjacentPods,
  answerPodQuestion,
  getPodSession,
  listPods,
  searchPods,
} from "../lib/learning/pods";

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
  const result = listPods(opts);
  return {
    total: result.total,
    topics: result.pods.map((pod) => ({
      id: pod.id,
      label: pod.title,
      size: pod.passageCount,
      bookCount: pod.bookCount,
    })),
  };
}

export async function getRealms() {
  // Realm clustering isn't part of the concept substrate yet — empty bar, topics
  // still render. (Old path: listRealms(resolveProfileId()).)
  return [];
}

export async function searchJourneys(q: string) {
  return searchPods(q).map((pod) => ({
    id: pod.id,
    label: pod.title,
    size: pod.passageCount,
    bookCount: pod.bookCount,
  }));
}

export async function getJourney(topicId: string) {
  const session = getPodSession(topicId, resolveProfileId());
  return {
    curriculum: session
      ? {
          id: session.id,
          topicId: session.podId,
          title: session.title,
          builder: "pods-compat",
          items: session.items,
        }
      : null,
    adjacent: adjacentPods(topicId).map((pod) => ({
      id: pod.id,
      label: pod.title,
      size: pod.passageCount,
      bookCount: pod.bookCount,
    })),
  };
}

/** Shared web actions for the new Pods vocabulary and richer contract. */
export async function getPods(opts: { limit?: number; offset?: number; ids?: string[] }) {
  return listPods(opts);
}

export async function findPods(query: string) {
  return searchPods(query);
}

export async function getPod(podId: string) {
  return {
    session: getPodSession(podId, resolveProfileId()),
    adjacent: adjacentPods(podId),
  };
}

export async function answerPod(
  podId: string,
  revision: string,
  questionId: string,
  selectedChoiceId: string,
  attemptId: string,
) {
  return answerPodQuestion({
    podId,
    revision,
    questionId,
    selectedChoiceId,
    attemptId,
    profileId: resolveProfileId(),
  });
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
