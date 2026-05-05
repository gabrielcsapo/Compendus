"use client";

import { useEffect, useState } from "react";
import type { StatsResponse } from "../actions/stats";
import { useReadingStats, refreshReadingStats } from "../lib/useReadingStats";
import { ReadingStreakCard } from "./dashboard/ReadingStreakCard";
import { WeeklyReadingChart } from "./dashboard/WeeklyReadingChart";
import { MonthlyHeatmap } from "./dashboard/MonthlyHeatmap";
import { TopBooksCard } from "./dashboard/TopBooksCard";
import { StatsDetailModal } from "./dashboard/StatsDetailModal";
import { GoalRing } from "./GoalRing";
import { useToast } from "./ToastContext";

const GOAL_PRESETS = [5, 10, 15, 20, 30, 45, 60, 90];

/**
 * Stats panel rendered on the Profile page. Mirrors the iOS Profile streak/stats
 * surface so behavior is consistent across platforms. Adds a daily-goal hero
 * (Duolingo-style) on top of the existing dashboard cards.
 */
export function ProfileStatsPanel({ initialStats }: { initialStats: StatsResponse | null }) {
  const live = useReadingStats();
  const [modalOpen, setModalOpen] = useState(false);
  // Prefer the live (client-cached) stats once available; fall back to the SSR copy
  // so first paint isn't empty.
  const stats = live ?? initialStats;
  const [seenStats, setSeenStats] = useState<StatsResponse | null>(stats);

  useEffect(() => {
    if (stats) setSeenStats(stats);
  }, [stats]);

  const data = seenStats;
  if (!data) return null;

  const today = data.todayMinutes;
  const goal = data.dailyGoalMinutes || 15;
  const goalReached = today >= goal;

  return (
    <section className="mt-10 space-y-8" aria-labelledby="reading-stats-heading">
      <div className="flex items-center justify-between">
        <h2 id="reading-stats-heading" className="text-xl font-semibold text-foreground">
          Reading
        </h2>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="text-sm text-foreground-muted hover:text-foreground transition-colors"
        >
          See all stats →
        </button>
      </div>

      {/* Daily goal hero (with inline editor) */}
      <div className="bg-surface border border-border rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-6">
          <GoalRing value={today} goal={goal} size={88} strokeWidth={8}>
            <div className="flex flex-col items-center justify-center text-center leading-tight">
              <span className="text-2xl font-bold tabular-nums text-foreground">{today}</span>
              <span className="text-[10px] uppercase tracking-wider text-foreground-muted">
                of {goal}m
              </span>
            </div>
          </GoalRing>
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-foreground">
              {goalReached
                ? "Daily goal complete \u{1F389}"
                : `${Math.max(0, goal - today)} min to today's goal`}
            </p>
            <p className="text-sm text-foreground-muted mt-0.5">
              {data.currentStreak > 0
                ? `${data.currentStreak}-day streak${data.streakHasFreeze ? " \u{1F6E1}" : ""} · best ${data.bestStreak}`
                : "Read today to start a streak"}
            </p>
            {data.streakHasFreeze && (
              <p className="text-xs text-foreground-muted mt-1">
                Streak protected by freeze (1 missed day forgiven)
              </p>
            )}
          </div>
        </div>
        <DailyGoalEditor currentGoal={goal} />
      </div>

      {/* Streak + weekly chart row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <ReadingStreakCard
          currentStreak={data.currentStreak}
          bestStreak={data.bestStreak}
          todayMinutes={data.todayMinutes}
          booksRead={data.booksRead}
          totalMinutes={data.totalMinutes}
          onClick={() => setModalOpen(true)}
        />
        <div className="md:col-span-2">
          <WeeklyReadingChart days={data.last7Days} />
        </div>
      </div>

      {data.topBooks.length > 0 && (
        <TopBooksCard books={data.topBooks.slice(0, 5)} onViewAll={() => setModalOpen(true)} />
      )}

      <MonthlyHeatmap dailyData={data.last30Days} />

      <StatsDetailModal isOpen={modalOpen} onClose={() => setModalOpen(false)} stats={data} />
    </section>
  );
}

function DailyGoalEditor({ currentGoal }: { currentGoal: number }) {
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  async function setGoal(minutes: number) {
    if (minutes === currentGoal || saving) return;
    setSaving(true);
    try {
      const meRes = await fetch("/api/profiles/me");
      const meData = await meRes.json();
      const profileId = meData?.profile?.id;
      if (!profileId) throw new Error("no profile");

      const res = await fetch(`/api/profiles/${profileId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dailyGoalMinutes: minutes }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "failed");

      await refreshReadingStats();
      showToast(`Daily goal set to ${minutes} minutes`, "success");
    } catch {
      showToast("Couldn't update goal", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-foreground-muted mb-2">Daily goal</p>
      <div className="flex flex-wrap gap-2">
        {GOAL_PRESETS.map((minutes) => {
          const active = minutes === currentGoal;
          return (
            <button
              key={minutes}
              type="button"
              disabled={saving}
              onClick={() => setGoal(minutes)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors disabled:opacity-50 ${
                active
                  ? "bg-primary text-white border-primary"
                  : "border-border text-foreground-muted hover:border-foreground/40 hover:text-foreground"
              }`}
            >
              {minutes}m
            </button>
          );
        })}
      </div>
    </div>
  );
}
