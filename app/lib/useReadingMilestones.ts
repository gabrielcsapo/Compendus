"use client";

import { useEffect, useRef } from "react";
import { useReadingStats } from "./useReadingStats";
import { useToast } from "../components/ToastContext";

const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 200, 365];

const STORAGE = {
  // We only celebrate the daily-goal once per day; the key embeds today's date.
  dailyGoalCelebratedFor: "compendus.celebrated.dailyGoal", // value: "YYYY-MM-DD"
  highestStreakCelebrated: "compendus.celebrated.streak", // value: number
  highestBooksCelebrated: "compendus.celebrated.booksRead", // value: number
};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function safeRead(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeWrite(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage may be unavailable (private mode, embed). Fail silently —
    // worst case we re-celebrate next session.
  }
}

/**
 * Watches the user's reading stats and fires celebration toasts on milestones.
 * Mount once near the app root.
 *
 * Triggers (each fires at most once per relevant unit):
 *  - **Daily goal hit** — first time today's minutes cross the goal, once per day
 *  - **Streak milestone** — at 3 / 7 / 14 / 30 / 60 / 100 / 200 / 365 days
 *  - **Book finished** — every increment of the booksRead count
 *
 * Persistence is in localStorage so reloads or page changes don't replay the
 * same celebration. On first run after install we treat the current values as
 * the baseline (no instant celebration storm for a returning user).
 */
export function useReadingMilestones() {
  const stats = useReadingStats();
  const { showCelebration } = useToast();
  const initialized = useRef(false);

  useEffect(() => {
    if (!stats) return;

    // First sighting of stats — establish a baseline so we don't fire a
    // pile of celebrations for already-achieved milestones on app load.
    if (!initialized.current) {
      initialized.current = true;

      if (safeRead(STORAGE.highestStreakCelebrated) === null) {
        const highest = STREAK_MILESTONES.filter((m) => stats.currentStreak >= m).pop() ?? 0;
        safeWrite(STORAGE.highestStreakCelebrated, String(highest));
      }
      if (safeRead(STORAGE.highestBooksCelebrated) === null) {
        safeWrite(STORAGE.highestBooksCelebrated, String(stats.booksRead));
      }
      if (
        safeRead(STORAGE.dailyGoalCelebratedFor) === null &&
        stats.todayMinutes >= stats.dailyGoalMinutes
      ) {
        // User opened a fresh session already past today's goal — don't pop.
        safeWrite(STORAGE.dailyGoalCelebratedFor, todayKey());
      }
      return;
    }

    // --- Daily goal hit ---
    if (
      stats.todayMinutes >= stats.dailyGoalMinutes &&
      safeRead(STORAGE.dailyGoalCelebratedFor) !== todayKey()
    ) {
      safeWrite(STORAGE.dailyGoalCelebratedFor, todayKey());
      showCelebration({
        title: "Daily goal complete!",
        message: `You read ${stats.todayMinutes} minutes today. Keep that streak going.`,
        emoji: "\u{1F389}",
      });
    }

    // --- Streak milestone ---
    const lastStreak = parseInt(safeRead(STORAGE.highestStreakCelebrated) ?? "0", 10);
    const justHit = STREAK_MILESTONES.find((m) => stats.currentStreak >= m && lastStreak < m);
    if (justHit) {
      safeWrite(STORAGE.highestStreakCelebrated, String(justHit));
      showCelebration({
        title: `${justHit}-day streak!`,
        message:
          justHit >= 100
            ? "That's a serious habit. We're proud."
            : justHit >= 30
              ? "A whole month of daily reading. Beautiful."
              : justHit >= 7
                ? "A full week of reading every day. Keep going."
                : "Three days in a row — momentum is real.",
        emoji: "\u{1F525}",
      });
    }

    // --- Book finished ---
    const lastBooks = parseInt(
      safeRead(STORAGE.highestBooksCelebrated) ?? String(stats.booksRead),
      10,
    );
    if (stats.booksRead > lastBooks) {
      safeWrite(STORAGE.highestBooksCelebrated, String(stats.booksRead));
      const finishedCount = stats.booksRead - lastBooks;
      showCelebration({
        title: finishedCount === 1 ? "Book finished" : `${finishedCount} books finished`,
        message: `That's #${stats.booksRead} on your shelf.`,
        emoji: "\u{1F4DA}",
      });
    }
  }, [stats, showCelebration]);
}
