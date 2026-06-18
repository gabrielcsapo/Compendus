"use client";

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-flight-router/client";
import { adminRest, type JobsSummary, type SidebarCounts } from "../lib/admin-rest";

/**
 * Admin Overview — mission control. Answers, in ten seconds: is the system
 * healthy, what is it doing right now, how much work is left and when does it
 * finish, and what needs me? The Pause control is the headline: reclaim the
 * box while you're actually using the app; everything auto-resumes.
 */

const TYPE_LABELS: Record<string, string> = {
  extract: "analyze",
  convert: "convert",
  transcribe: "transcribe",
  "generate-ccd": "prepare",
  "ccd-backfill": "backfill",
};

function fmtEta(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return `~${Math.max(5, Math.round(hours * 60))} min`;
  if (hours < 36) return `~${Math.round(hours)} h`;
  return `~${(hours / 24).toFixed(1)} days`;
}

function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  const w = 24 * 7;
  const h = 36;
  return (
    <svg width={w} height={h} className="block" aria-label="completions per hour, last 24h">
      {data.map((v, i) => {
        const barH = Math.max(1, Math.round((v / max) * (h - 4)));
        return (
          <rect
            key={i}
            x={i * 7 + 1}
            y={h - barH}
            width={5}
            height={barH}
            rx={1}
            className={v > 0 ? "fill-primary/70" : "fill-border"}
          />
        );
      })}
    </svg>
  );
}

export default function AdminOverviewClient() {
  const [summary, setSummary] = useState<JobsSummary | null>(null);
  const [counts, setCounts] = useState<SidebarCounts | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    adminRest
      .summary()
      .then(setSummary)
      .catch(() => {});
    adminRest
      .counts()
      .then(setCounts)
      .catch(() => {});
  }, []);

  useEffect(() => {
    load(); // first paint always loads, even in a background tab
    const poll = () => {
      if (!document.hidden) load();
    };
    const id = setInterval(poll, 10_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [load]);

  const pause = async (minutes: number) => {
    setBusy(true);
    try {
      await adminRest.pause(minutes);
      load();
    } finally {
      setBusy(false);
    }
  };
  const resume = async () => {
    setBusy(true);
    try {
      await adminRest.resume();
      load();
    } finally {
      setBusy(false);
    }
  };

  if (!summary) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6 text-sm text-foreground-muted">
        Loading system status…
      </div>
    );
  }

  const activeDevices = summary.fleet.filter(
    (d) => d.lastSeenMs && Date.now() - d.lastSeenMs < 10 * 60 * 1000,
  );
  const pendingChips = Object.entries(summary.pendingByType).sort((a, b) => b[1] - a[1]);

  // Constraint inference: the single sentence that explains the system.
  let constraint: string;
  if (summary.paused) {
    constraint = "Paused — the box is yours; fleet results defer until resume.";
  } else if (summary.pendingTotal === 0) {
    constraint = "Queue empty — nothing limits throughput right now.";
  } else if (activeDevices.length === 0) {
    constraint =
      "Throughput limited by: no fleet devices online. Plug in a laptop or open /fleet-worker on any machine to scale.";
  } else if (activeDevices.length === 1) {
    constraint = `Throughput limited by: 1 fleet device (${activeDevices[0].name}). Add devices at /fleet-worker to scale.`;
  } else {
    constraint = `${activeDevices.length} fleet devices active — throughput scales with devices.`;
  }

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-bold text-foreground">Overview</h2>

      {/* NOW strip */}
      <section
        className={`rounded-xl border p-4 ${
          summary.paused ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-surface"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            {summary.paused ? (
              <div className="text-sm font-medium text-amber-400">
                Paused
                {summary.pausedUntil && (
                  <span className="text-foreground-muted font-normal">
                    {" "}
                    — auto-resumes {new Date(summary.pausedUntil).toLocaleTimeString()}
                  </span>
                )}
              </div>
            ) : summary.running ? (
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse" />
                  <span className="font-medium text-foreground capitalize">
                    {TYPE_LABELS[summary.running.type] ?? summary.running.type}
                  </span>
                  <span className="text-foreground-muted truncate">{summary.running.message}</span>
                </div>
                <div className="mt-2 h-1.5 w-full max-w-md rounded-full bg-border overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.min(100, summary.running.progress)}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="text-sm text-foreground-muted">Idle — no job running</div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {summary.paused ? (
              <button
                onClick={resume}
                disabled={busy}
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
              >
                Resume now
              </button>
            ) : (
              <>
                <button
                  onClick={() => pause(60)}
                  disabled={busy}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-surface-elevated disabled:opacity-50"
                  title="Stop background work so the app feels instant. Auto-resumes."
                >
                  Pause 1h
                </button>
                <button
                  onClick={() => pause(8 * 60)}
                  disabled={busy}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground-muted hover:bg-surface-elevated disabled:opacity-50"
                >
                  8h
                </button>
              </>
            )}
          </div>
        </div>

        {/* Fleet activity line */}
        {summary.fleetActive.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-muted">
            {summary.fleetActive.map((w, i) => (
              <span key={i}>
                <span className="text-foreground">{w.deviceName ?? "device"}</span> — {w.kind}
                {w.leasedForSec !== null && ` (${Math.round(w.leasedForSec / 60)}m)`}
              </span>
            ))}
          </div>
        )}
        <div className="mt-3 text-xs text-foreground-muted">{constraint}</div>
      </section>

      {/* Queue + throughput */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link
          to="/admin/jobs"
          className="rounded-xl border border-border bg-surface p-4 hover:border-primary/40 transition-colors"
        >
          <div className="text-xs uppercase tracking-wide text-foreground-muted">Queue</div>
          <div className="mt-1 text-2xl font-bold text-foreground tabular-nums">
            {summary.pendingTotal.toLocaleString()}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-foreground-muted">
            {pendingChips.length === 0 && <span>empty</span>}
            {pendingChips.map(([type, n]) => (
              <span key={type}>
                {TYPE_LABELS[type] ?? type} {n.toLocaleString()}
              </span>
            ))}
          </div>
          <div className="mt-2 text-xs text-foreground-muted">
            drains in <span className="text-foreground">{fmtEta(summary.etaHours)}</span>
          </div>
        </Link>

        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="text-xs uppercase tracking-wide text-foreground-muted">
            Throughput · 24h
          </div>
          <div className="mt-1 text-2xl font-bold text-foreground tabular-nums">
            {summary.completed24h.toLocaleString()}
            <span className="text-sm font-normal text-foreground-muted"> done</span>
          </div>
          <div className="mt-2">
            <Sparkline data={summary.hourly} />
          </div>
          <div className="mt-1 text-xs text-foreground-muted">
            {summary.throughputPerHour.toFixed(1)}/hr over the last 6h
          </div>
        </div>

        <Link
          to="/admin/jobs"
          className={`rounded-xl border p-4 transition-colors ${
            summary.errorCount > 0
              ? "border-red-500/40 bg-red-500/5 hover:border-red-500/70"
              : "border-border bg-surface hover:border-primary/40"
          }`}
        >
          <div className="text-xs uppercase tracking-wide text-foreground-muted">Attention</div>
          <div
            className={`mt-1 text-2xl font-bold tabular-nums ${
              summary.errorCount > 0 ? "text-red-400" : "text-foreground"
            }`}
          >
            {summary.errorCount}
          </div>
          <div className="mt-1 text-xs text-foreground-muted">
            {summary.errorCount > 0 ? "errored jobs — review & retry" : "no errors"}
          </div>
        </Link>
      </div>

      {/* Work waiting elsewhere */}
      {counts && (counts.unmatched > 0 || counts.duplicates > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {counts.unmatched > 0 && (
            <Link
              to="/admin/unmatched"
              className="rounded-xl border border-border bg-surface p-4 hover:border-primary/40 transition-colors"
            >
              <div className="text-sm text-foreground">
                <span className="font-semibold tabular-nums">{counts.unmatched}</span> books need
                metadata matching
              </div>
              <div className="mt-1 text-xs text-foreground-muted">Library → Matching</div>
            </Link>
          )}
          {counts.duplicates > 0 && (
            <Link
              to="/admin/duplicates"
              className="rounded-xl border border-border bg-surface p-4 hover:border-primary/40 transition-colors"
            >
              <div className="text-sm text-foreground">
                <span className="font-semibold tabular-nums">{counts.duplicates}</span> possible
                duplicate groups
              </div>
              <div className="mt-1 text-xs text-foreground-muted">Library → Duplicates</div>
            </Link>
          )}
        </div>
      )}

      {/* Fleet roster */}
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wide text-foreground-muted">Fleet</div>
          <Link to="/admin/fleet" className="text-xs text-primary hover:text-primary-hover">
            details →
          </Link>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {summary.fleet.length === 0 && (
            <span className="text-sm text-foreground-muted">No devices enrolled.</span>
          )}
          {summary.fleet.map((d) => {
            const online = d.lastSeenMs && Date.now() - d.lastSeenMs < 10 * 60 * 1000;
            return (
              <span
                key={d.name}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs"
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${online ? "bg-green-400" : "bg-border"}`}
                />
                <span className="text-foreground">{d.name}</span>
                <span className="text-foreground-muted tabular-nums">{d.jobsDone}</span>
              </span>
            );
          })}
        </div>
      </section>
    </div>
  );
}
