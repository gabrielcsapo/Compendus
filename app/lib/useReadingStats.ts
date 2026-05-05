"use client";

import { useEffect, useState } from "react";
import type { StatsResponse } from "../actions/stats";

let cached: StatsResponse | null = null;
let inflight: Promise<StatsResponse | null> | null = null;
const subscribers = new Set<(stats: StatsResponse | null) => void>();

async function fetchAndPublish(): Promise<StatsResponse | null> {
  try {
    const res = await fetch("/api/stats", { credentials: "include" });
    if (!res.ok) return null;
    const data = (await res.json()) as StatsResponse;
    cached = data;
    for (const fn of subscribers) fn(data);
    return data;
  } catch {
    return null;
  }
}

function loadStats(): Promise<StatsResponse | null> {
  if (inflight) return inflight;
  inflight = fetchAndPublish().finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * Returns the latest reading stats for the current profile. Shares one
 * in-flight request across components and re-fetches on tab focus so the
 * nav-avatar progress ring reflects reading sessions that just ended.
 */
export function useReadingStats(): StatsResponse | null {
  const [stats, setStats] = useState<StatsResponse | null>(cached);

  useEffect(() => {
    let mounted = true;

    function update(next: StatsResponse | null) {
      if (mounted) setStats(next);
    }
    subscribers.add(update);

    if (!cached) loadStats();

    function onFocus() {
      loadStats();
    }
    window.addEventListener("focus", onFocus);

    return () => {
      mounted = false;
      subscribers.delete(update);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return stats;
}

/** Manually invalidate the cache and re-fetch (e.g. after a reading session ends). */
export function refreshReadingStats(): Promise<StatsResponse | null> {
  cached = null;
  inflight = null;
  return loadStats();
}
