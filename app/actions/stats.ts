"use server";

import { db, readingSessions, userBookState, books } from "../lib/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { resolveProfileId } from "../lib/profile";

export type StatsResponse = {
  totalMinutes: number;
  booksRead: number;
  currentStreak: number;
  bestStreak: number;
  todayMinutes: number;
  last7Days: { date: string; minutes: number }[];
  last30Days: { date: string; minutes: number }[];
  topBooks: {
    bookId: string;
    minutes: number;
    sessionCount: number;
    title: string;
    authors: string | null;
    coverUrl: string | null;
  }[];
  today: {
    minutes: number;
    sessions: number;
    pagesRead: number;
    booksTouched: number;
  };
  thisMonth: {
    minutes: number;
    sessions: number;
    avgDailyMinutes: number;
    booksTouched: number;
  };
  thisYear: {
    minutes: number;
    sessions: number;
    booksFinished: number;
    bestStreak: number;
  };
  todayHourly: { hour: number; minutes: number }[];
  thisMonthDaily: { date: string; minutes: number }[];
  thisYearMonthly: { month: number; minutes: number }[];
};

function toMs(value: Date | number): number {
  if (value instanceof Date) return value.getTime();
  return value * 1000;
}

function toDateKey(value: Date | number): string {
  return new Date(toMs(value)).toISOString().slice(0, 10);
}

export async function getReadingStats(): Promise<StatsResponse | null> {
  const profileId = resolveProfileId();
  if (!profileId) return null;

  // All completed sessions for this profile
  const allSessions = db
    .select()
    .from(readingSessions)
    .where(eq(readingSessions.profileId, profileId))
    .all()
    .filter((s) => s.endedAt != null);

  // Total reading time (all time)
  const totalMinutes = Math.round(
    allSessions.reduce((sum, s) => {
      const durationMs = toMs(s.endedAt!) - toMs(s.startedAt);
      return sum + Math.max(0, durationMs) / 60000;
    }, 0),
  );

  // Books read count
  const booksReadResult = db
    .select({ count: sql<number>`count(*)` })
    .from(userBookState)
    .where(and(eq(userBookState.profileId, profileId), eq(userBookState.isRead, true)))
    .get();
  const booksRead = booksReadResult?.count ?? 0;

  // Daily reading minutes for last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  thirtyDaysAgo.setHours(0, 0, 0, 0);

  const recentSessions = allSessions.filter((s) => toMs(s.startedAt) >= thirtyDaysAgo.getTime());

  // Bucket sessions by day
  const dailyMap = new Map<string, number>();
  for (const s of recentSessions) {
    const day = toDateKey(s.startedAt);
    const mins = Math.max(0, toMs(s.endedAt!) - toMs(s.startedAt)) / 60000;
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + mins);
  }

  // Build ordered last-30-days array
  const last30Days: { date: string; minutes: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    last30Days.push({ date: key, minutes: Math.round(dailyMap.get(key) ?? 0) });
  }

  // Last 7 days
  const last7Days = last30Days.slice(-7);

  // Today's minutes
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayMinutes = Math.round(dailyMap.get(todayKey) ?? 0);

  // Streak calculation from all sessions
  const allReadingDays = new Set(allSessions.map((s) => toDateKey(s.startedAt)));

  // Current streak: count consecutive days backward from today
  let currentStreak = 0;
  for (let i = 0; i <= allReadingDays.size; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (allReadingDays.has(key)) {
      currentStreak++;
    } else if (i > 0) {
      break;
    }
  }

  // Best streak
  const sortedDays = [...allReadingDays].sort();
  let bestStreak = 0;
  let runStreak = 0;
  let prevDate: Date | null = null;
  for (const dayStr of sortedDays) {
    const d = new Date(dayStr + "T00:00:00");
    if (prevDate) {
      const diffDays = Math.round((d.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        runStreak++;
      } else {
        runStreak = 1;
      }
    } else {
      runStreak = 1;
    }
    bestStreak = Math.max(bestStreak, runStreak);
    prevDate = d;
  }

  // --- Period-specific stats ---
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  const todaySessions = allSessions.filter((s) => toMs(s.startedAt) >= startOfToday.getTime());
  const monthSessions = allSessions.filter((s) => toMs(s.startedAt) >= startOfMonth.getTime());
  const yearSessions = allSessions.filter((s) => toMs(s.startedAt) >= startOfYear.getTime());

  function sumMinutes(sessions: typeof allSessions) {
    return sessions.reduce(
      (sum, s) => sum + Math.max(0, toMs(s.endedAt!) - toMs(s.startedAt)) / 60000,
      0,
    );
  }

  const todayTotalMin = sumMinutes(todaySessions);
  const monthTotalMin = sumMinutes(monthSessions);
  const yearTotalMin = sumMinutes(yearSessions);

  const daysElapsedInMonth = Math.max(1, now.getDate());

  const today = {
    minutes: Math.round(todayTotalMin),
    sessions: todaySessions.length,
    pagesRead: todaySessions.reduce((sum, s) => sum + (s.pagesRead ?? 0), 0),
    booksTouched: new Set(todaySessions.map((s) => s.bookId)).size,
  };

  const thisMonth = {
    minutes: Math.round(monthTotalMin),
    sessions: monthSessions.length,
    avgDailyMinutes: Math.round(monthTotalMin / daysElapsedInMonth),
    booksTouched: new Set(monthSessions.map((s) => s.bookId)).size,
  };

  // Books finished this year: books that are isRead=true and had sessions this year
  const yearBookIds = [...new Set(yearSessions.map((s) => s.bookId))];
  const booksFinishedThisYear =
    yearBookIds.length > 0
      ? (db
          .select({ count: sql<number>`count(*)` })
          .from(userBookState)
          .where(
            and(
              eq(userBookState.profileId, profileId),
              eq(userBookState.isRead, true),
              inArray(userBookState.bookId, yearBookIds),
            ),
          )
          .get()?.count ?? 0)
      : 0;

  // Best streak this year
  const yearReadingDays = [...new Set(yearSessions.map((s) => toDateKey(s.startedAt)))].sort();
  let yearBestStreak = 0;
  let yearRun = 0;
  let yearPrev: Date | null = null;
  for (const dayStr of yearReadingDays) {
    const d = new Date(dayStr + "T00:00:00");
    if (yearPrev) {
      const diff = Math.round((d.getTime() - yearPrev.getTime()) / 86400000);
      yearRun = diff === 1 ? yearRun + 1 : 1;
    } else {
      yearRun = 1;
    }
    yearBestStreak = Math.max(yearBestStreak, yearRun);
    yearPrev = d;
  }

  const thisYear = {
    minutes: Math.round(yearTotalMin),
    sessions: yearSessions.length,
    booksFinished: booksFinishedThisYear,
    bestStreak: yearBestStreak,
  };

  // --- Hourly breakdown for today ---
  const todayHourly: { hour: number; minutes: number }[] = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    minutes: 0,
  }));
  for (const s of todaySessions) {
    const hour = new Date(toMs(s.startedAt)).getHours();
    todayHourly[hour].minutes += Math.max(0, toMs(s.endedAt!) - toMs(s.startedAt)) / 60000;
  }
  for (const entry of todayHourly) entry.minutes = Math.round(entry.minutes);

  // --- Daily breakdown for this month ---
  const thisMonthDaily: { date: string; minutes: number }[] = [];
  for (let day = 1; day <= now.getDate(); day++) {
    const d = new Date(now.getFullYear(), now.getMonth(), day);
    const key = d.toISOString().slice(0, 10);
    thisMonthDaily.push({ date: key, minutes: 0 });
  }
  for (const s of monthSessions) {
    const key = toDateKey(s.startedAt);
    const entry = thisMonthDaily.find((d) => d.date === key);
    if (entry) entry.minutes += Math.max(0, toMs(s.endedAt!) - toMs(s.startedAt)) / 60000;
  }
  for (const entry of thisMonthDaily) entry.minutes = Math.round(entry.minutes);

  // --- Monthly breakdown for this year ---
  const thisYearMonthly: { month: number; minutes: number }[] = Array.from(
    { length: now.getMonth() + 1 },
    (_, i) => ({ month: i + 1, minutes: 0 }),
  );
  for (const s of yearSessions) {
    const month = new Date(toMs(s.startedAt)).getMonth();
    thisYearMonthly[month].minutes += Math.max(0, toMs(s.endedAt!) - toMs(s.startedAt)) / 60000;
  }
  for (const entry of thisYearMonthly) entry.minutes = Math.round(entry.minutes);

  // Per-book time breakdown (top 10 by time spent in last 30 days)
  const bookStatsMap = new Map<string, { minutes: number; count: number }>();
  for (const s of recentSessions) {
    const mins = Math.max(0, toMs(s.endedAt!) - toMs(s.startedAt)) / 60000;
    const existing = bookStatsMap.get(s.bookId) ?? { minutes: 0, count: 0 };
    bookStatsMap.set(s.bookId, { minutes: existing.minutes + mins, count: existing.count + 1 });
  }

  const topBookIds = [...bookStatsMap.entries()]
    .sort((a, b) => b[1].minutes - a[1].minutes)
    .slice(0, 10);

  // Batch-fetch book details for top books
  const topBookIdList = topBookIds.map(([bookId]) => bookId);
  const topBookRecords =
    topBookIdList.length > 0
      ? db
          .select({
            id: books.id,
            title: books.title,
            authors: books.authors,
            coverPath: books.coverPath,
            updatedAt: books.updatedAt,
          })
          .from(books)
          .where(inArray(books.id, topBookIdList))
          .all()
      : [];
  const bookLookup = new Map(topBookRecords.map((b) => [b.id, b]));

  const topBooks = topBookIds.map(([bookId, stats]) => {
    const book = bookLookup.get(bookId);
    return {
      bookId,
      minutes: Math.round(stats.minutes),
      sessionCount: stats.count,
      title: book?.title ?? "Unknown",
      authors: book?.authors ?? null,
      coverUrl: book?.coverPath
        ? `/covers/${bookId}.thumb.jpg?v=${book.updatedAt ? toMs(book.updatedAt) : ""}`
        : null,
    };
  });

  return {
    totalMinutes,
    booksRead,
    currentStreak,
    bestStreak,
    todayMinutes,
    last7Days,
    last30Days,
    topBooks,
    today,
    thisMonth,
    thisYear,
    todayHourly,
    thisMonthDaily,
    thisYearMonthly,
  };
}
