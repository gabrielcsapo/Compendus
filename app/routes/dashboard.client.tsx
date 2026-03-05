"use client";

import { useState, useEffect } from "react";
import { getRecentBooks } from "../actions/books";
import { ContinueReadingCarousel } from "../components/dashboard/ContinueReadingCarousel";
import { ReadingStreakCard } from "../components/dashboard/ReadingStreakCard";
import { WeeklyReadingChart } from "../components/dashboard/WeeklyReadingChart";
import { MonthlyHeatmap } from "../components/dashboard/MonthlyHeatmap";

type StatsResponse = {
  totalMinutes: number;
  booksRead: number;
  currentStreak: number;
  bestStreak: number;
  todayMinutes: number;
  last7Days: { date: string; minutes: number }[];
  last30Days: { date: string; minutes: number }[];
  topBooks: { bookId: string; minutes: number; title: string; authors: string | null; coverUrl: string | null }[];
};

type DashboardData = {
  continueReading: Awaited<ReturnType<typeof getRecentBooks>>;
  stats: StatsResponse | null;
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [continueReading, statsRes] = await Promise.all([
        getRecentBooks(10),
        fetch("/api/stats")
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);

      if (!cancelled) {
        setData({ continueReading, stats: statsRes });
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || !data) {
    return (
      <main className="container my-8 px-6 mx-auto">
        {/* Skeleton */}
        <div className="space-y-8">
          {/* Stats skeleton */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="bg-surface border border-border rounded-xl p-5 h-48 animate-pulse">
              <div className="h-4 bg-surface-elevated rounded w-24 mb-4" />
              <div className="h-10 bg-surface-elevated rounded w-16 mb-3" />
              <div className="h-3 bg-surface-elevated rounded w-40" />
            </div>
            <div className="md:col-span-2 bg-surface border border-border rounded-xl p-5 h-48 animate-pulse">
              <div className="h-4 bg-surface-elevated rounded w-20 mb-4" />
              <div className="flex items-end gap-2 h-24">
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="flex-1 bg-surface-elevated rounded-t" style={{ height: `${20 + Math.random() * 60}%` }} />
                ))}
              </div>
            </div>
          </div>

          {/* Continue reading skeleton */}
          <div>
            <div className="h-5 bg-surface-elevated rounded w-40 mb-4 animate-pulse" />
            <div className="flex gap-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex-shrink-0 w-28">
                  <div className="aspect-[2/3] bg-surface-elevated rounded-lg animate-pulse" />
                  <div className="h-3 bg-surface-elevated rounded w-20 mt-2 animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    );
  }

  const { continueReading, stats } = data;

  return (
    <main className="container my-8 px-6 mx-auto space-y-10">
      <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>

      {/* Row 1: Stats cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <ReadingStreakCard
            currentStreak={stats.currentStreak}
            bestStreak={stats.bestStreak}
            todayMinutes={stats.todayMinutes}
            booksRead={stats.booksRead}
            totalMinutes={stats.totalMinutes}
          />
          <div className="md:col-span-2">
            <WeeklyReadingChart days={stats.last7Days} />
          </div>
        </div>
      )}

      {/* Row 2: Continue Reading */}
      {continueReading.length > 0 && (
        <ContinueReadingCarousel books={continueReading} />
      )}

      {/* Row 3: Monthly heatmap */}
      {stats && <MonthlyHeatmap dailyData={stats.last30Days} />}
    </main>
  );
}
