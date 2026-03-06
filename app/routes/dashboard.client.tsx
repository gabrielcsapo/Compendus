"use client";

import { useState, useEffect, useRef } from "react";
import { getRecentBooks } from "../actions/books";
import { ContinueReadingCarousel } from "../components/dashboard/ContinueReadingCarousel";
import { ReadingStreakCard } from "../components/dashboard/ReadingStreakCard";
import { WeeklyReadingChart } from "../components/dashboard/WeeklyReadingChart";
import { MonthlyHeatmap } from "../components/dashboard/MonthlyHeatmap";
import { TopBooksCard } from "../components/dashboard/TopBooksCard";
import { StatsDetailModal } from "../components/dashboard/StatsDetailModal";
import type { StatsResponse } from "../actions/stats";

type DashboardData = {
  continueReading: Awaited<ReturnType<typeof getRecentBooks>>;
  stats: StatsResponse | null;
};

export default function DashboardPage({
  initialContinueReading,
  initialStats,
}: {
  initialContinueReading?: Awaited<ReturnType<typeof getRecentBooks>>;
  initialStats?: StatsResponse | null;
}) {
  const [data, setData] = useState<DashboardData | null>(
    initialContinueReading
      ? { continueReading: initialContinueReading, stats: initialStats ?? null }
      : null,
  );
  const [loading, setLoading] = useState(!initialContinueReading);
  const hadInitialData = useRef(!!initialContinueReading);
  const [showStatsModal, setShowStatsModal] = useState(false);

  useEffect(() => {
    if (hadInitialData.current) {
      hadInitialData.current = false;
      return;
    }

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
                  <div
                    key={i}
                    className="flex-1 bg-surface-elevated rounded-t"
                    style={{ height: `${20 + Math.random() * 60}%` }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Top books skeleton */}
          <div className="bg-surface border border-border rounded-xl p-5 animate-pulse">
            <div className="h-4 bg-surface-elevated rounded w-20 mb-4" />
            <div className="flex gap-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex-shrink-0 w-20">
                  <div className="w-16 h-24 bg-surface-elevated rounded-md mx-auto" />
                  <div className="h-2 bg-surface-elevated rounded w-14 mx-auto mt-2" />
                </div>
              ))}
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
            onClick={() => setShowStatsModal(true)}
          />
          <div className="md:col-span-2">
            <WeeklyReadingChart days={stats.last7Days} />
          </div>
        </div>
      )}

      {/* Row 2: Top Books */}
      {stats && stats.topBooks.length > 0 && (
        <TopBooksCard
          books={stats.topBooks.slice(0, 5)}
          onViewAll={() => setShowStatsModal(true)}
        />
      )}

      {/* Row 3: Continue Reading */}
      {continueReading.length > 0 && <ContinueReadingCarousel books={continueReading} />}

      {/* Row 4: Monthly heatmap */}
      {stats && <MonthlyHeatmap dailyData={stats.last30Days} />}

      {/* Stats Detail Modal */}
      {stats && (
        <StatsDetailModal
          isOpen={showStatsModal}
          onClose={() => setShowStatsModal(false)}
          stats={stats}
        />
      )}
    </main>
  );
}
