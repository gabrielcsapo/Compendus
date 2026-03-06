"use client";

interface ReadingStreakCardProps {
  currentStreak: number;
  bestStreak: number;
  todayMinutes: number;
  booksRead: number;
  totalMinutes: number;
  onClick?: () => void;
}

function formatTime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export function ReadingStreakCard({
  currentStreak,
  bestStreak,
  todayMinutes,
  booksRead,
  totalMinutes,
  onClick,
}: ReadingStreakCardProps) {
  return (
    <div
      className={`bg-surface border border-border rounded-xl p-5 flex flex-col h-full${onClick ? " cursor-pointer hover:border-primary/50 transition-colors" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
    >
      <div className="flex items-center gap-4 mb-4">
        {/* Flame icon */}
        <div className="flex-shrink-0">
          <svg
            className={`w-10 h-10 ${currentStreak > 0 ? "text-orange-500" : "text-foreground-muted/40"}`}
            fill={currentStreak > 0 ? "currentColor" : "none"}
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={currentStreak > 0 ? 0 : 1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z"
            />
          </svg>
        </div>

        <div>
          <div className="text-2xl font-bold text-foreground">{currentStreak}</div>
          <div className="text-sm text-foreground-muted">
            day {currentStreak === 1 ? "streak" : "streak"}
          </div>
        </div>
      </div>

      {/* Today status */}
      <p className="text-sm text-foreground-muted mb-4">
        {todayMinutes > 0
          ? `${formatTime(todayMinutes)} read today`
          : currentStreak > 0
            ? "Read today to keep your streak!"
            : "Start reading to build a streak!"}
      </p>

      {/* Stats row */}
      <div className="mt-auto grid grid-cols-3 gap-3 pt-3 border-t border-border">
        <div className="text-center">
          <div className="text-sm font-semibold text-foreground">{bestStreak}</div>
          <div className="text-[10px] text-foreground-muted">Best streak</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold text-foreground">{booksRead}</div>
          <div className="text-[10px] text-foreground-muted">Books read</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold text-foreground">{formatTime(totalMinutes)}</div>
          <div className="text-[10px] text-foreground-muted">Total time</div>
        </div>
      </div>

      {onClick && <div className="text-xs text-primary mt-3 text-center">View details &rarr;</div>}
    </div>
  );
}
