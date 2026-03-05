"use client";

interface MonthlyHeatmapProps {
  dailyData: { date: string; minutes: number }[];
}

export function MonthlyHeatmap({ dailyData }: MonthlyHeatmapProps) {
  const max = Math.max(...dailyData.map((d) => d.minutes), 1);
  const activeDays = dailyData.filter((d) => d.minutes > 0).length;

  function getIntensityClass(minutes: number): string {
    if (minutes === 0) return "bg-surface-elevated";
    const ratio = minutes / max;
    if (ratio < 0.25) return "bg-primary/20";
    if (ratio < 0.5) return "bg-primary/40";
    if (ratio < 0.75) return "bg-primary/70";
    return "bg-primary";
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Last 30 Days</h3>
        <p className="text-xs text-foreground-muted">
          {activeDays} active {activeDays === 1 ? "day" : "days"}
        </p>
      </div>

      {/* Heatmap grid */}
      <div className="flex flex-wrap gap-1">
        {dailyData.map(({ date, minutes }) => {
          const d = new Date(date + "T12:00:00");
          const dayLabel = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

          return (
            <div
              key={date}
              className={`w-5 h-5 rounded-sm transition-colors ${getIntensityClass(minutes)}`}
              title={`${dayLabel}: ${minutes} min`}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-between mt-4">
        <div className="flex items-center gap-1 text-xs text-foreground-muted">
          <span>Less</span>
          <div className="w-3 h-3 rounded-sm bg-surface-elevated" />
          <div className="w-3 h-3 rounded-sm bg-primary/20" />
          <div className="w-3 h-3 rounded-sm bg-primary/40" />
          <div className="w-3 h-3 rounded-sm bg-primary/70" />
          <div className="w-3 h-3 rounded-sm bg-primary" />
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
