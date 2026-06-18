"use client";

import { useCallback, useEffect, useState } from "react";
import { getFleetOverview, retryFailedWork } from "../actions/fleet";

/**
 * Admin → Fleet: live view of the Idle Fleet — queue depth, enrolled devices
 * with attributed throughput, per-kind health (including failure rates, e.g.
 * on-device-model refusals), a 24h work timeline, artifact volume, and recent
 * failures with their reasons. Auto-refreshes while open.
 */

interface Status {
  byStatus: Record<string, number>;
  devices: Array<{
    id: string;
    name: string;
    platform: string;
    lastSeen: string | null;
    jobsDone: number;
  }>;
}

interface Analytics {
  perDevice: Array<{
    id: string;
    name: string;
    platform: string;
    completed: number | null;
    avgSeconds: number | null;
    inWindow: number | null;
  }>;
  perDeviceKind: Array<{ device: string; kind: string; done: number; avgSeconds: number | null }>;
  perKind: Array<{
    kind: string;
    done: number;
    failed: number;
    open: number;
    avgAttempts: number | null;
    avgSeconds: number | null;
  }>;
  timeline: Array<{ hour: string; done: number }>;
  artifacts: Array<{ kind: string; count: number; bytes: number | null }>;
  recentFailures: Array<{
    kind: string;
    error: string | null;
    attempts: number;
    createdAt: number;
  }>;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 90) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Compact ETA from a fractional-hours estimate ("~2h 10m", "~25m", "<1m"). */
function etaFromHours(hours: number): string {
  const totalMin = Math.round(hours * 60);
  if (totalMin < 1) return "<1m";
  if (totalMin < 60) return `~${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `~${h}h ${m}m` : `~${h}h`;
}

export function FleetAdminClient() {
  const [status, setStatus] = useState<Status | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryMsg, setRetryMsg] = useState<string | null>(null);

  const load = useCallback(
    () =>
      getFleetOverview()
        .then(({ status: s, analytics: a }) => {
          setStatus(s as Status);
          setAnalytics(a as Analytics);
          setError(null);
        })
        .catch(() => setError("Couldn't reach the fleet")),
    [],
  );

  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (alive) void load();
    };
    tick();
    const interval = setInterval(tick, 15_000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [load]);

  const onRetryFailed = useCallback(async () => {
    setRetrying(true);
    setRetryMsg(null);
    try {
      const { requeued } = await retryFailedWork();
      setRetryMsg(`Re-queued ${requeued} failed job${requeued === 1 ? "" : "s"}.`);
      await load();
    } catch {
      setRetryMsg("Retry failed — admin session required.");
    } finally {
      setRetrying(false);
    }
  }, [load]);

  if (error) return <p className="text-sm text-foreground-muted">{error}</p>;
  if (!status || !analytics) return <p className="text-sm text-foreground-muted">Loading fleet…</p>;

  const queue = status.byStatus;
  const maxHour = Math.max(1, ...analytics.timeline.map((t) => t.done));
  const deviceById = new Map(analytics.perDevice.map((d) => [d.id, d]));

  // Queue burndown: total open work + the fleet's recent completion rate (from
  // the hourly timeline, dropping the current partial hour) → an ETA. This is
  // the "how long will it take" readout across ALL devices at once.
  const openTotal = analytics.perKind.reduce((sum, k) => sum + (k.open ?? 0), 0);
  const fullHours =
    analytics.timeline.length > 1 ? analytics.timeline.slice(0, -1) : analytics.timeline;
  const recent = fullHours.slice(-3);
  const ratePerHour =
    recent.length > 0 ? recent.reduce((sum, t) => sum + t.done, 0) / recent.length : 0;
  const etaHours = ratePerHour > 0 ? openTotal / ratePerHour : null;

  return (
    <div className="space-y-8">
      {/* Queue summary */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(["queued", "leased", "done", "failed"] as const).map((key) => (
          <div key={key} className="rounded-lg border border-border bg-surface p-4">
            <div className="text-xs uppercase tracking-wide text-foreground-muted">{key}</div>
            <div
              className={`text-2xl font-semibold mt-1 ${
                key === "failed" && (queue[key] ?? 0) > 0 ? "text-red-500" : "text-foreground"
              }`}
            >
              {queue[key] ?? 0}
            </div>
          </div>
        ))}
      </section>

      {/* Queue burndown */}
      {openTotal > 0 && (
        <section className="rounded-lg border border-border bg-surface p-4">
          <div className="flex items-baseline justify-between flex-wrap gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-foreground-muted">
                Queue burndown
              </div>
              <div className="text-2xl font-semibold text-foreground mt-1">
                {openTotal.toLocaleString()} job{openTotal === 1 ? "" : "s"} remaining
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-foreground">
                {ratePerHour > 0 ? `~${Math.round(ratePerHour)} jobs/hr` : "rate unknown"}
              </div>
              <div className="text-sm text-foreground-muted">
                {etaHours != null ? `ETA ${etaFromHours(etaHours)}` : "ETA —"}
              </div>
            </div>
          </div>
          <p className="text-xs text-foreground-muted mt-2">
            Across all active devices, at the fleet&apos;s recent rate. Adding more capable devices
            raises the rate and shortens the ETA.
          </p>
        </section>
      )}

      {/* Devices */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Devices</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-foreground-muted">
                <th className="px-4 py-2 font-medium">Device</th>
                <th className="px-4 py-2 font-medium">Platform</th>
                <th className="px-4 py-2 font-medium">Last seen</th>
                <th className="px-4 py-2 font-medium text-right">Jobs (lifetime)</th>
                <th className="px-4 py-2 font-medium text-right">Attributed</th>
                <th className="px-4 py-2 font-medium text-right">Avg job</th>
                <th className="px-4 py-2 font-medium text-right">Throughput</th>
              </tr>
            </thead>
            <tbody>
              {status.devices.map((device) => {
                const stats = deviceById.get(device.id);
                const fresh =
                  device.lastSeen && Date.now() - new Date(device.lastSeen).getTime() < 5 * 60_000;
                return (
                  <tr key={device.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 text-foreground">
                      <span
                        className={`inline-block w-2 h-2 rounded-full mr-2 ${
                          fresh ? "bg-green-500" : "bg-border"
                        }`}
                      />
                      {device.name}
                    </td>
                    <td className="px-4 py-2 text-foreground-muted">{device.platform}</td>
                    <td className="px-4 py-2 text-foreground-muted">
                      {relativeTime(device.lastSeen)}
                    </td>
                    <td className="px-4 py-2 text-right text-foreground">{device.jobsDone}</td>
                    <td className="px-4 py-2 text-right text-foreground">
                      {stats?.completed ?? 0}
                    </td>
                    <td className="px-4 py-2 text-right text-foreground-muted">
                      {stats?.avgSeconds ? `${stats.avgSeconds}s` : "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-foreground-muted">
                      {stats?.avgSeconds && stats.avgSeconds > 0
                        ? `~${Math.round(3600 / stats.avgSeconds)}/hr`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-foreground-muted mt-2">
          “Attributed” counts jobs completed since per-device attribution landed; the lifetime
          counter includes earlier work.
        </p>
      </section>

      {/* 24h timeline */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Last 24 hours</h2>
        <div className="rounded-lg border border-border bg-surface p-4">
          {analytics.timeline.length === 0 ? (
            <p className="text-sm text-foreground-muted">No completed work in the last 24h.</p>
          ) : (
            <div className="flex items-end gap-1 h-24">
              {analytics.timeline.map((t) => (
                <div key={t.hour} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                  <div
                    className="w-full rounded-t bg-primary/70"
                    style={{ height: `${Math.max(4, (t.done / maxHour) * 80)}px` }}
                    title={`${t.hour}: ${t.done} jobs`}
                  />
                  <div className="text-[9px] text-foreground-muted truncate w-full text-center">
                    {t.hour.slice(11)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Kinds */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Work by kind</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-foreground-muted">
                <th className="px-4 py-2 font-medium">Kind</th>
                <th className="px-4 py-2 font-medium text-right">Done</th>
                <th className="px-4 py-2 font-medium text-right">Failed</th>
                <th className="px-4 py-2 font-medium text-right">Open</th>
                <th className="px-4 py-2 font-medium text-right">Avg attempts</th>
                <th className="px-4 py-2 font-medium text-right">Avg job</th>
              </tr>
            </thead>
            <tbody>
              {analytics.perKind.map((kind) => (
                <tr key={kind.kind} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-mono text-xs text-foreground">{kind.kind}</td>
                  <td className="px-4 py-2 text-right text-foreground">{kind.done}</td>
                  <td
                    className={`px-4 py-2 text-right ${kind.failed > 0 ? "text-red-500" : "text-foreground-muted"}`}
                  >
                    {kind.failed}
                  </td>
                  <td className="px-4 py-2 text-right text-foreground-muted">{kind.open}</td>
                  <td className="px-4 py-2 text-right text-foreground-muted">
                    {kind.avgAttempts ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-right text-foreground-muted">
                    {kind.avgSeconds ? `${kind.avgSeconds}s` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Device × kind */}
      {analytics.perDeviceKind.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3">Who does what</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-foreground-muted">
                  <th className="px-4 py-2 font-medium">Device</th>
                  <th className="px-4 py-2 font-medium">Kind</th>
                  <th className="px-4 py-2 font-medium text-right">Done</th>
                  <th className="px-4 py-2 font-medium text-right">Avg job</th>
                </tr>
              </thead>
              <tbody>
                {analytics.perDeviceKind.map((row) => (
                  <tr key={row.device + row.kind} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 text-foreground">{row.device}</td>
                    <td className="px-4 py-2 font-mono text-xs text-foreground">{row.kind}</td>
                    <td className="px-4 py-2 text-right text-foreground">{row.done}</td>
                    <td className="px-4 py-2 text-right text-foreground-muted">
                      {row.avgSeconds ? `${row.avgSeconds}s` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Artifacts + failures */}
      <div className="grid md:grid-cols-2 gap-8">
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3">Artifacts</h2>
          <div className="rounded-lg border border-border bg-surface divide-y divide-border">
            {analytics.artifacts.map((artifact) => (
              <div
                key={artifact.kind}
                className="flex items-center justify-between px-4 py-2 text-sm"
              >
                <span className="font-mono text-xs text-foreground">{artifact.kind}</span>
                <span className="text-foreground-muted">
                  {artifact.count} · {formatBytes(artifact.bytes)}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-3 gap-3">
            <h2 className="text-lg font-semibold text-foreground">Recent failures</h2>
            {(queue.failed ?? 0) > 0 && (
              <button
                type="button"
                onClick={onRetryFailed}
                disabled={retrying}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:opacity-80 disabled:opacity-50"
              >
                {retrying ? "Retrying…" : `Retry ${queue.failed} failed`}
              </button>
            )}
          </div>
          {retryMsg && <p className="text-xs text-foreground-muted mb-2">{retryMsg}</p>}
          {analytics.recentFailures.length === 0 ? (
            <p className="text-sm text-foreground-muted">None. 🎉</p>
          ) : (
            <div className="rounded-lg border border-border bg-surface divide-y divide-border">
              {analytics.recentFailures.map((failure, i) => (
                <div key={i} className="px-4 py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-foreground">{failure.kind}</span>
                    <span className="text-xs text-foreground-muted">
                      {failure.attempts} attempts
                    </span>
                  </div>
                  <div className="text-xs text-foreground-muted mt-0.5 truncate">
                    {failure.error ?? "(no reason recorded)"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
