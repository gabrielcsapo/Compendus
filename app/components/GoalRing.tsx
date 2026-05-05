"use client";

/**
 * Circular progress ring for the daily reading goal.
 *
 * Used in two places to give a Duolingo-style at-a-glance signal:
 *  - Around the profile avatar in the nav (size=32, strokeWidth=2.5)
 *  - As a hero on the Profile page (size=120+, strokeWidth=8)
 *
 * Visual states:
 *  - 0% → muted gray track, no fill
 *  - 1–99% → accent-colored arc (primary)
 *  - >=100% → green completed ring
 */
type GoalRingProps = {
  /** Current value (e.g. minutes read today) */
  value: number;
  /** Goal value (e.g. dailyGoalMinutes) */
  goal: number;
  /** Outer diameter in px */
  size?: number;
  /** Ring stroke width */
  strokeWidth?: number;
  /** Optional content rendered inside the ring */
  children?: React.ReactNode;
  /** Optional className applied to the wrapper */
  className?: string;
  /** Override colors */
  trackColor?: string;
  progressColor?: string;
  completedColor?: string;
  /** Show progress line cap as round (default) or square */
  capStyle?: "round" | "butt";
};

export function GoalRing({
  value,
  goal,
  size = 32,
  strokeWidth = 2.5,
  children,
  className = "",
  trackColor,
  progressColor,
  completedColor,
  capStyle = "round",
}: GoalRingProps) {
  const safeGoal = Math.max(1, goal);
  const progress = Math.max(0, Math.min(1, value / safeGoal));
  const completed = value >= safeGoal;

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);

  const resolvedTrack = trackColor ?? "color-mix(in oklab, currentColor 18%, transparent)";
  const resolvedProgress =
    progressColor ?? "color-mix(in oklab, var(--color-primary, #7c3aed) 95%, transparent)";
  const resolvedCompleted = completedColor ?? "#10b981";

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      aria-label={`${Math.round(progress * 100)}% of daily reading goal`}
      role="progressbar"
      aria-valuenow={Math.round(progress * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0 -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={resolvedTrack}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={completed ? resolvedCompleted : resolvedProgress}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap={capStyle}
          style={{
            transition: "stroke-dashoffset 600ms cubic-bezier(0.4, 0, 0.2, 1), stroke 200ms",
          }}
        />
      </svg>
      {children}
    </div>
  );
}
