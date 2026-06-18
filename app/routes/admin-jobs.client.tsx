"use client";

import { useCallback, useEffect, useState } from "react";
import { adminRest, type AdminJobRow, type JobsSummary } from "../lib/admin-rest";

/**
 * Jobs — three honest views instead of one 1,700-row table:
 *   Attention  errored/parked jobs with Retry + Dismiss (the default when any exist)
 *   Active     the running job + pending queue
 *   History    completions from the last 24h (older ones auto-prune)
 * Bulk actions are scoped (Retry all errors / Clear completed); the old
 * one-click "Cancel all jobs" nuke is gone.
 */

type View = "attention" | "active" | "history";
const PAGE_SIZE = 25;

const TYPE_LABELS: Record<string, string> = {
  extract: "Analyze",
  convert: "Convert",
  transcribe: "Transcribe",
  "generate-ccd": "Prepare",
  "ccd-backfill": "Backfill",
  inline: "Inline",
};

function timeAgo(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 90 * 60) return `${Math.round(s / 60)}m ago`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default function AdminJobsClient() {
  const [view, setView] = useState<View | null>(null);
  const [summary, setSummary] = useState<JobsSummary | null>(null);
  const [rows, setRows] = useState<AdminJobRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [logsFor, setLogsFor] = useState<{ id: string; text: string } | null>(null);

  const loadSummary = useCallback(() => {
    adminRest
      .summary()
      .then((s) => {
        setSummary(s);
        // First load: land on Attention if anything needs it, else Active.
        setView((v) => v ?? (s.errorCount > 0 ? "attention" : "active"));
      })
      .catch(() => {});
  }, []);

  const loadRows = useCallback((v: View, p: number, query: string) => {
    adminRest
      .jobs({ view: v, page: p, pageSize: PAGE_SIZE, q: query })
      .then((r) => {
        setRows(r.items);
        setTotal(r.total);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (!view) return;
    loadRows(view, page, q); // first paint always loads
    const id = setInterval(() => {
      if (!document.hidden) {
        loadRows(view, page, q);
        loadSummary();
      }
    }, 15_000);
    return () => clearInterval(id);
  }, [view, page, q, loadRows, loadSummary]);

  const switchView = (v: View) => {
    setView(v);
    setPage(1);
  };

  const retry = async (id: string) => {
    setBusyId(id);
    try {
      await adminRest.retryJob(id);
      if (view) loadRows(view, page, q);
      loadSummary();
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async (id: string) => {
    setBusyId(id);
    try {
      await adminRest.dismissJob(id);
      if (view) loadRows(view, page, q);
      loadSummary();
    } finally {
      setBusyId(null);
    }
  };

  const showLogs = async (id: string) => {
    const text = await adminRest.jobLogs(id).catch(() => "");
    setLogsFor({ id, text: text || "(no logs recorded)" });
  };

  const counts = {
    attention: summary?.errorCount ?? 0,
    active: (summary?.pendingTotal ?? 0) + (summary?.running ? 1 : 0),
    history: summary?.completed24h ?? 0,
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-foreground">Jobs</h2>
        <div className="flex gap-2">
          {view === "attention" && counts.attention > 0 && (
            <button
              onClick={async () => {
                await adminRest.retryAllErrors();
                if (view) loadRows(view, 1, q);
                loadSummary();
              }}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-surface-elevated"
            >
              Retry all errors
            </button>
          )}
          {view === "history" && (
            <button
              onClick={async () => {
                await adminRest.clearCompleted();
                if (view) loadRows(view, 1, q);
                loadSummary();
              }}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground-muted hover:bg-surface-elevated"
            >
              Clear completed
            </button>
          )}
        </div>
      </div>

      {/* View switcher */}
      <div className="flex gap-1 rounded-lg border border-border bg-surface p-1 w-fit">
        {(
          [
            ["attention", "Attention"],
            ["active", "Active"],
            ["history", "History"],
          ] as Array<[View, string]>
        ).map(([v, label]) => (
          <button
            key={v}
            onClick={() => switchView(v)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
              view === v
                ? "bg-surface-elevated text-foreground font-medium"
                : "text-foreground-muted hover:text-foreground"
            }`}
          >
            {label}
            <span
              className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
                v === "attention" && counts.attention > 0
                  ? "bg-red-500/15 text-red-400"
                  : "bg-border text-foreground-muted"
              }`}
            >
              {counts[v].toLocaleString()}
            </span>
          </button>
        ))}
      </div>

      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
        placeholder="Search jobs…"
        className="w-full max-w-sm rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-foreground-muted"
      />

      {/* Rows */}
      <div className="rounded-xl border border-border bg-surface divide-y divide-border">
        {rows.length === 0 && (
          <div className="p-6 text-sm text-foreground-muted">
            {view === "attention" ? "Nothing needs attention." : "No jobs here."}
          </div>
        )}
        {rows.map((j) => {
          const parked = j.message.includes("Crashed the worker");
          return (
            <div key={j.id} className="flex items-center gap-3 px-4 py-2.5">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  j.status === "running"
                    ? "bg-primary animate-pulse"
                    : j.status === "pending"
                      ? "bg-amber-400/70"
                      : j.status === "error"
                        ? "bg-red-400"
                        : "bg-green-400/70"
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-foreground">
                    {TYPE_LABELS[j.type] ?? j.type}
                  </span>
                  {parked && (
                    <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-400">
                      PARKED
                    </span>
                  )}
                  <span className="truncate text-foreground-muted">{j.message || j.id}</span>
                </div>
                {j.status === "running" && (
                  <div className="mt-1.5 h-1 w-full max-w-xs rounded-full bg-border overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${Math.min(100, j.progress)}%` }}
                    />
                  </div>
                )}
              </div>
              <span className="shrink-0 text-xs text-foreground-muted tabular-nums">
                {timeAgo(j.updatedAt)}
              </span>
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => showLogs(j.id)}
                  className="rounded px-2 py-1 text-xs text-foreground-muted hover:bg-surface-elevated hover:text-foreground"
                >
                  Logs
                </button>
                {j.status === "error" && (
                  <button
                    onClick={() => retry(j.id)}
                    disabled={busyId === j.id}
                    className="rounded px-2 py-1 text-xs text-primary hover:bg-surface-elevated disabled:opacity-50"
                  >
                    Retry
                  </button>
                )}
                {(j.status === "error" || j.status === "completed") && (
                  <button
                    onClick={() => dismiss(j.id)}
                    disabled={busyId === j.id}
                    className="rounded px-2 py-1 text-xs text-foreground-muted hover:bg-surface-elevated hover:text-foreground disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                )}
                {(j.status === "pending" || j.status === "running") && (
                  <button
                    onClick={() => dismiss(j.id)}
                    disabled={busyId === j.id}
                    className="rounded px-2 py-1 text-xs text-foreground-muted hover:bg-surface-elevated hover:text-foreground disabled:opacity-50"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-3 text-sm text-foreground-muted">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded border border-border px-2 py-1 disabled:opacity-40 hover:bg-surface-elevated"
          >
            ←
          </button>
          <span className="tabular-nums">
            {page} / {totalPages} · {total.toLocaleString()} jobs
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="rounded border border-border px-2 py-1 disabled:opacity-40 hover:bg-surface-elevated"
          >
            →
          </button>
        </div>
      )}

      {/* Logs drawer */}
      {logsFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
          onClick={() => setLogsFor(null)}
        >
          <div
            className="max-h-[70vh] w-full max-w-2xl overflow-auto rounded-xl border border-border bg-surface p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-xs text-foreground-muted">{logsFor.id}</span>
              <button
                onClick={() => setLogsFor(null)}
                className="text-sm text-foreground-muted hover:text-foreground"
              >
                Close
              </button>
            </div>
            <pre className="whitespace-pre-wrap font-mono text-xs text-foreground-muted">
              {logsFor.text}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
