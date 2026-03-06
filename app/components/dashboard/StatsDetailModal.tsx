"use client";

import { useState } from "react";
import type { StatsResponse } from "../../actions/stats";

type TabId = "today" | "month" | "year";

interface StatsDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  stats: StatsResponse;
}

function formatTime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

const TABS: { id: TabId; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "month", label: "This Month" },
  { id: "year", label: "This Year" },
];

const HOUR_LABELS: Record<number, string> = {
  0: "12a",
  6: "6a",
  12: "12p",
  18: "6p",
};

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatAuthors(authors: string | null): string {
  if (!authors) return "";
  try {
    const parsed = JSON.parse(authors);
    return Array.isArray(parsed) ? parsed.join(", ") : authors;
  } catch {
    return authors;
  }
}

function getStatsGrid(tab: TabId, stats: StatsResponse) {
  switch (tab) {
    case "today":
      return [
        { label: "Total Time", value: formatTime(stats.today.minutes) },
        { label: "Sessions", value: String(stats.today.sessions) },
        { label: "Pages Read", value: String(stats.today.pagesRead) },
        { label: "Books", value: String(stats.today.booksTouched) },
      ];
    case "month":
      return [
        { label: "Total Time", value: formatTime(stats.thisMonth.minutes) },
        { label: "Sessions", value: String(stats.thisMonth.sessions) },
        { label: "Avg/Day", value: `${stats.thisMonth.avgDailyMinutes}m` },
        { label: "Books", value: String(stats.thisMonth.booksTouched) },
      ];
    case "year":
      return [
        { label: "Total Time", value: formatTime(stats.thisYear.minutes) },
        { label: "Sessions", value: String(stats.thisYear.sessions) },
        { label: "Finished", value: String(stats.thisYear.booksFinished) },
        { label: "Best Streak", value: `${stats.thisYear.bestStreak}d` },
      ];
  }
}

function getChartBars(tab: TabId, stats: StatsResponse) {
  switch (tab) {
    case "today":
      return stats.todayHourly.map((h) => ({
        key: String(h.hour),
        label: HOUR_LABELS[h.hour] ?? "",
        minutes: h.minutes,
      }));
    case "month":
      return stats.thisMonthDaily.map((d) => ({
        key: d.date,
        label: String(new Date(d.date + "T00:00:00").getDate()),
        minutes: d.minutes,
      }));
    case "year":
      return stats.thisYearMonthly.map((m) => ({
        key: String(m.month),
        label: MONTH_LABELS[m.month - 1],
        minutes: m.minutes,
      }));
  }
}

export function StatsDetailModal({ isOpen, onClose, stats }: StatsDetailModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>("today");

  if (!isOpen) return null;

  const gridStats = getStatsGrid(activeTab, stats);
  const bars = getChartBars(activeTab, stats);
  const maxMinutes = Math.max(1, ...bars.map((b) => b.minutes));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative bg-surface border border-border rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold text-foreground">Reading Stats</h2>
          <button
            onClick={onClose}
            className="text-foreground-muted hover:text-foreground transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-border px-6 shrink-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-foreground-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 p-6 space-y-6">
          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3">
            {gridStats.map((stat) => (
              <div
                key={stat.label}
                className="bg-surface-elevated border border-border rounded-lg p-4"
              >
                <div className="text-xs text-foreground-muted mb-1">{stat.label}</div>
                <div className="text-xl font-bold text-foreground">{stat.value}</div>
              </div>
            ))}
          </div>

          {/* Activity chart */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Activity</h3>
            <div className="bg-surface-elevated border border-border rounded-lg p-4">
              <div className="flex items-end gap-[2px] h-28 overflow-x-auto">
                {bars.map((bar) => (
                  <div
                    key={bar.key}
                    className="flex-1 min-w-[12px] flex flex-col items-center justify-end h-full"
                  >
                    <div className="w-full flex items-end justify-center flex-1">
                      <div
                        className={`w-full max-w-5 rounded-t transition-all ${bar.minutes > 0 ? "bg-primary" : "bg-border/50"}`}
                        style={{
                          height: `${bar.minutes > 0 ? Math.max(8, (bar.minutes / maxMinutes) * 100) : 4}%`,
                        }}
                        title={`${bar.minutes}m`}
                      />
                    </div>
                    {bar.label && (
                      <span className="text-[8px] text-foreground-muted mt-1 leading-none">
                        {bar.label}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Top books */}
          {stats.topBooks.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3">Most Read Books</h3>
              <div className="space-y-2">
                {stats.topBooks.map((book, index) => (
                  <div
                    key={book.bookId}
                    className="flex items-center gap-3 p-3 rounded-lg border border-border"
                  >
                    <div className="w-6 h-6 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center shrink-0">
                      {index + 1}
                    </div>
                    <div className="w-10 h-14 rounded overflow-hidden bg-surface-elevated border border-border shrink-0">
                      {book.coverUrl ? (
                        <img
                          src={book.coverUrl}
                          alt={book.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[8px] text-foreground-muted px-0.5 leading-tight">
                          {book.title.slice(0, 6)}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">
                        {book.title}
                      </div>
                      {book.authors && (
                        <div className="text-xs text-foreground-muted truncate">
                          {formatAuthors(book.authors)}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold text-foreground">
                        {formatTime(book.minutes)}
                      </div>
                      <div className="text-[10px] text-foreground-muted">
                        {book.sessionCount} {book.sessionCount === 1 ? "session" : "sessions"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
