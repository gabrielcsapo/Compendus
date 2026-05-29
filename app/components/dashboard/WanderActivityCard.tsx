"use client";

interface WanderActivityCardProps {
  totalMinutes: number;
  sessions: number;
  ideasVisited: number;
  last7Days: { date: string; minutes: number }[];
}

function formatTime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export function WanderActivityCard({
  totalMinutes,
  sessions,
  ideasVisited,
  last7Days,
}: WanderActivityCardProps) {
  const weekMinutes = last7Days.reduce((sum, d) => sum + d.minutes, 0);

  return (
    <div className="bg-surface border border-border rounded-xl p-5 flex flex-col h-full">
      <div className="flex items-center gap-4 mb-4">
        <div className="flex-shrink-0">
          {/* winding-path icon, matching the nav wander glyph */}
          <svg
            className="w-9 h-9 text-amber-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 19c3 0 3-5 6-5s3 5 6 5" opacity="0.5" />
            <path d="M5 14c3 0 3-9 7-9 2.5 0 3 4 0 4" />
            <circle cx="5" cy="19" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="17" cy="19" r="1.4" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <div>
          <div className="text-2xl font-bold text-foreground">{ideasVisited}</div>
          <div className="text-sm text-foreground-muted">ideas wandered</div>
        </div>
      </div>

      <p className="text-sm text-foreground-muted mb-4">
        {weekMinutes > 0
          ? `${formatTime(weekMinutes)} wandering this week`
          : "Wander the Living Library to explore your ideas."}
      </p>

      <div className="mt-auto grid grid-cols-3 gap-3 pt-3 border-t border-border">
        <div className="text-center">
          <div className="text-sm font-semibold text-foreground">{sessions}</div>
          <div className="text-[10px] text-foreground-muted">Sessions</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold text-foreground">{ideasVisited}</div>
          <div className="text-[10px] text-foreground-muted">Ideas seen</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold text-foreground">{formatTime(totalMinutes)}</div>
          <div className="text-[10px] text-foreground-muted">Total time</div>
        </div>
      </div>
    </div>
  );
}
