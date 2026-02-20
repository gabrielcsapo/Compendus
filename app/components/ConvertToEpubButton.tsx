"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router";

interface ConvertToEpubButtonProps {
  bookId: string;
  hasEpub: boolean;
}

type ConversionState =
  | { type: "idle" }
  | { type: "starting" }
  | { type: "converting"; progress: number; message: string; jobId: string }
  | { type: "completed" }
  | { type: "error"; message: string };

export function ConvertToEpubButton({ bookId, hasEpub }: ConvertToEpubButtonProps) {
  const [state, setState] = useState<ConversionState>(
    hasEpub ? { type: "completed" } : { type: "idle" },
  );
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const pollJob = useCallback(
    (jobId: string) => {
      stopPolling();
      pollingRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/jobs/${jobId}`);
          if (!res.ok) {
            stopPolling();
            setState({ type: "error", message: "Lost connection to conversion job" });
            return;
          }
          const data = await res.json();
          if (data.status === "completed") {
            stopPolling();
            setState({ type: "completed" });
          } else if (data.status === "error") {
            stopPolling();
            setState({ type: "error", message: data.message || "Conversion failed" });
          } else {
            setState({
              type: "converting",
              progress: data.progress || 0,
              message: data.message || "Converting...",
              jobId,
            });
          }
        } catch {
          stopPolling();
          setState({ type: "error", message: "Failed to check conversion status" });
        }
      }, 2000);
    },
    [stopPolling],
  );

  const startConversion = async (force = false) => {
    setState({ type: "starting" });
    try {
      const res = await fetch(`/api/books/${bookId}/convert-to-epub`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(force ? { force: true } : {}),
      });
      const data = await res.json();

      if (!res.ok) {
        setState({ type: "error", message: data.message || data.error || "Conversion failed" });
        return;
      }

      if (data.alreadyConverted) {
        setState({ type: "completed" });
        return;
      }

      if (data.jobId) {
        setState({
          type: "converting",
          progress: 0,
          message: "Starting conversion...",
          jobId: data.jobId,
        });
        pollJob(data.jobId);
      }
    } catch {
      setState({ type: "error", message: "Failed to start conversion" });
    }
  };

  if (state.type === "completed") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-green-500/10 text-green-700 dark:text-green-400">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span>EPUB version available</span>
        </div>
        <Link
          to={`/book/${bookId}/read?format=epub`}
          className="btn btn-secondary w-full text-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
            />
          </svg>
          Read as EPUB
        </Link>
        <a
          href={`/books/${bookId}/as-epub`}
          download={`${bookId}.epub`}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm border border-border rounded-lg hover:bg-surface-elevated text-foreground-muted hover:text-foreground transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          Download EPUB
        </a>
        <button
          onClick={() => startConversion(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm border border-border rounded-lg hover:bg-surface-elevated text-foreground-muted hover:text-foreground transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Reconvert EPUB
        </button>
      </div>
    );
  }

  if (state.type === "converting") {
    return (
      <div className="space-y-2">
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
          onClick={() => startConversion()}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm border border-border rounded-lg hover:bg-surface-elevated text-foreground-muted hover:text-foreground transition-colors"
        >
          Retry Conversion
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => startConversion()}
      disabled={state.type === "starting"}
      className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm border border-border rounded-lg hover:bg-surface-elevated text-foreground-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {state.type === "starting" ? (
        <>
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          <span>Starting conversion...</span>
        </>
      ) : (
        <>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          <span>Convert to EPUB</span>
        </>
      )}
    </button>
  );
}
