import { Hono } from "hono";
import { eq, and, sql } from "drizzle-orm";
import { db, readingSessions, userBookState, books } from "../../app/lib/db";

const app = new Hono();

// Drizzle with mode:"timestamp" may return Date objects or raw unix-second numbers.
function toMs(value: Date | number): number {
  if (value instanceof Date) return value.getTime();
  return value * 1000;
}

function toDateKey(value: Date | number): string {
  return new Date(toMs(value)).toISOString().slice(0, 10);
}

// GET /api/stats — Aggregated reading statistics for current profile
app.get("/api/stats", (c) => {
  const profileId = c.get("profileId");

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

  const recentSessions = allSessions.filter(
    (s) => toMs(s.startedAt) >= thirtyDaysAgo.getTime(),
  );

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

  // Streak calculation from all sessions (not just last 30 days)
  const allReadingDays = new Set(allSessions.map((s) => toDateKey(s.startedAt)));

  // Current streak: count consecutive days backward from today
  let currentStreak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (allReadingDays.has(key)) {
      currentStreak++;
    } else if (i > 0) {
      // Allow today to not have a session without breaking the streak
      break;
    }
  }

  // Best streak (within all reading days)
  const sortedDays = [...allReadingDays].sort();
  let bestStreak = 0;
  let runStreak = 0;
  let prevDate: Date | null = null;
  for (const dayStr of sortedDays) {
    const d = new Date(dayStr + "T00:00:00");
    if (prevDate) {
      const diffDays = Math.round(
        (d.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24),
      );
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

  // Per-book time breakdown (top 10 by time spent in last 30 days)
  const bookTimeMap = new Map<string, number>();
  for (const s of recentSessions) {
    const mins = Math.max(0, toMs(s.endedAt!) - toMs(s.startedAt)) / 60000;
    bookTimeMap.set(s.bookId, (bookTimeMap.get(s.bookId) ?? 0) + mins);
  }

  const topBookIds = [...bookTimeMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Fetch book details for top books
  const topBooks = topBookIds.map(([bookId, minutes]) => {
    const book = db.select().from(books).where(eq(books.id, bookId)).get();
    return {
      bookId,
      minutes: Math.round(minutes),
      title: book?.title ?? "Unknown",
      authors: book?.authors ?? null,
      coverUrl: book?.coverPath
        ? `/covers/${bookId}.thumb.jpg?v=${book.updatedAt ? toMs(book.updatedAt) : ""}`
        : null,
    };
  });

  return c.json({
    totalMinutes,
    booksRead,
    currentStreak,
    bestStreak,
    todayMinutes,
    last7Days,
    last30Days,
    topBooks,
  });
});

export const statsRoutes = app;
