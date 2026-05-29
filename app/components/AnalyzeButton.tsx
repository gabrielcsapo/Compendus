"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface AnalyzeButtonProps {
  bookId: string;
}

type AnalyzeState =
  | { type: "idle" }
  | { type: "loading" } // checking initial status
  | { type: "starting" }
  | { type: "analyzing"; progress: number; message: string; jobId: string }
  | { type: "completed"; entityCount: number; relationshipCount: number }
  | { type: "error"; message: string };

export function AnalyzeButton({ bookId }: AnalyzeButtonProps) {
  const [state, setState] = useState<AnalyzeState>({ type: "loading" });
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const pollJob = useCallback(
    (jobId: string) => {
      stopPolling();
      pollingRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/jobs/${jobId}`);
          if (!res.ok) {
            stopPolling();
            setState({ type: "error", message: "Lost connection to analysis job" });
            return;
          }
          const data = await res.json();
          if (data.status === "completed") {
            stopPolling();
            await loadStatus();
          } else if (data.status === "error") {
            stopPolling();
            setState({ type: "error", message: data.message || "Analysis failed" });
          } else {
            setState({
              type: "analyzing",
              progress: data.progress || 0,
              message: data.message || "Analyzing…",
              jobId,
            });
          }
        } catch {
          stopPolling();
          setState({ type: "error", message: "Failed to check analysis status" });
        }
      }, 2000);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stopPolling],
  );

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${bookId}/analysis`);
      const data = await res.json();
      const a = data.analysis;
      if (a?.status === "completed") {
        setState({
          type: "completed",
          entityCount: a.entityCount ?? 0,
          relationshipCount: a.relationshipCount ?? 0,
        });
      } else if (a?.status === "running" || a?.status === "pending") {
        setState({
          type: "analyzing",
          progress: 0,
          message: "Analyzing…",
          jobId: `extract-${bookId}`,
        });
        pollJob(`extract-${bookId}`);
      } else if (a?.status === "error") {
        setState({ type: "error", message: a.error || "Analysis failed" });
      } else {
        setState({ type: "idle" });
      }
    } catch {
      setState({ type: "idle" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, pollJob]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const startAnalysis = async () => {
    setState({ type: "starting" });
    try {
      const res = await fetch(`/api/books/${bookId}/analyze`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setState({ type: "error", message: data.message || data.error || "Analysis failed" });
        return;
      }
      if (data.jobId) {
        setState({
          type: "analyzing",
          progress: 0,
          message: "Starting analysis…",
          jobId: data.jobId,
        });
        pollJob(data.jobId);
      }
    } catch {
      setState({ type: "error", message: "Failed to start analysis" });
    }
  };

  if (state.type === "loading") {
    return (
      <div className="h-10 rounded-lg bg-surface-elevated border border-border animate-pulse" />
    );
  }

  if (state.type === "analyzing") {
    return (
      <div className="px-3 py-3 rounded-lg bg-surface-elevated border border-border">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-foreground-muted">{state.message}</span>
          <span className="font-medium text-foreground">{state.progress}%</span>
        </div>
        <div className="h-2 bg-surface rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary to-accent rounded-full transition-all duration-500"
            style={{ width: `${state.progress}%` }}
          />
        </div>
      </div>
    );
  }

  if (state.type === "completed") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-green-500/10 text-green-700 dark:text-green-400">
          <ConstellationIcon />
          <span>
            {state.entityCount} ideas · {state.relationshipCount} links
          </span>
        </div>
        <button
          onClick={startAnalysis}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm border border-border rounded-lg hover:bg-surface-elevated text-foreground-muted hover:text-foreground transition-colors"
        >
          Re-analyze
        </button>
      </div>
    );
  }

  if (state.type === "error") {
    return (
      <div className="space-y-2">
        <div className="px-3 py-2 text-sm rounded-lg bg-red-500/10 text-red-700 dark:text-red-400">
          {state.message}
        </div>
        <button
          onClick={startAnalysis}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm border border-border rounded-lg hover:bg-surface-elevated text-foreground-muted hover:text-foreground transition-colors"
        >
          Retry analysis
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={startAnalysis}
      disabled={state.type === "starting"}
      className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm border border-border rounded-lg hover:bg-surface-elevated text-foreground-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {state.type === "starting" ? (
        <>
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          <span>Starting analysis…</span>
        </>
      ) : (
        <>
          <ConstellationIcon />
          <span>Analyze for Living Library</span>
        </>
      )}
    </button>
  );
}

function ConstellationIcon() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.6}
        d="M5 7l6 3m0 0l6-4m-6 4l1 7m-7-3l6 3m0 0l5-2"
      />
      <circle cx="5" cy="7" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="17" cy="6" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="11" cy="10" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="17" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="5" cy="14" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
