"use client";

interface WeeklyReadingChartProps {
  days: { date: string; minutes: number }[];
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function WeeklyReadingChart({ days }: WeeklyReadingChartProps) {
  const max = Math.max(...days.map((d) => d.minutes), 1);
  const todayKey = new Date().toISOString().slice(0, 10);

  return (
    <div className="bg-surface border border-border rounded-xl p-5 h-full flex flex-col">
      <h3 className="text-sm font-semibold text-foreground mb-4">This Week</h3>

      <div className="flex items-end gap-2 flex-1 min-h-[100px]">
        {days.map(({ date, minutes }) => {
          const heightPct = Math.max(minutes > 0 ? 4 : 0, Math.round((minutes / max) * 100));
          const d = new Date(date + "T12:00:00");
          const label = DAY_LABELS[d.getDay()];
          const isToday = date === todayKey;

          return (
            <div key={date} className="flex-1 flex flex-col items-center gap-1">
              {/* Bar container */}
              <div className="w-full flex items-end justify-center h-20">
                <div
                  className={`w-full max-w-8 rounded-t transition-all duration-300 ${
                    isToday ? "bg-primary" : "bg-primary/30"
                  }`}
                  style={{ height: `${heightPct}%`, minHeight: minutes > 0 ? "4px" : "0" }}
                  title={`${date}: ${minutes} min`}
                />
              </div>
              {/* Minute label */}
              {minutes > 0 && (
                <span className="text-[10px] text-foreground-muted font-medium">{minutes}m</span>
              )}
              {minutes === 0 && <span className="text-[10px] text-transparent">0</span>}
              {/* Day label */}
              <span
                className={`text-[10px] ${isToday ? "text-primary font-semibold" : "text-foreground-muted"}`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
