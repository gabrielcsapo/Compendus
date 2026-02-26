"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface TranscribeButtonProps {
  bookId: string;
  hasTranscript: boolean;
}

type TranscriptionState =
  | { type: "idle" }
  | { type: "starting" }
  | { type: "transcribing"; progress: number; message: string; jobId: string }
  | { type: "completed" }
  | { type: "error"; message: string };

export function TranscribeButton({ bookId, hasTranscript }: TranscribeButtonProps) {
  const [state, setState] = useState<TranscriptionState>(
    hasTranscript ? { type: "completed" } : { type: "idle" },
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
            setState({ type: "error", message: "Lost connection to transcription job" });
            return;
          }
          const data = await res.json();
          if (data.status === "completed") {
            stopPolling();
            setState({ type: "completed" });
          } else if (data.status === "error") {
            stopPolling();
            setState({ type: "error", message: data.message || "Transcription failed" });
          } else {
            setState({
              type: "transcribing",
              progress: data.progress || 0,
              message: data.message || "Transcribing...",
              jobId,
            });
          }
        } catch {
          stopPolling();
          setState({ type: "error", message: "Failed to check transcription status" });
        }
      }, 2000);
    },
    [stopPolling],
  );

  const startTranscription = async (force = false) => {
    setState({ type: "starting" });
    try {
      const res = await fetch(`/api/books/${bookId}/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(force ? { force: true } : {}),
      });
      const data = await res.json();

      if (!res.ok) {
        setState({ type: "error", message: data.message || data.error || "Transcription failed" });
        return;
      }

      if (data.alreadyTranscribed) {
        setState({ type: "completed" });
        return;
      }

      if (data.jobId) {
        setState({
          type: "transcribing",
          progress: 0,
          message: "Starting transcription...",
          jobId: data.jobId,
        });
        pollJob(data.jobId);
      }
    } catch {
      setState({ type: "error", message: "Failed to start transcription" });
    }
  };

  if (state.type === "completed") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-green-500/10 text-green-700 dark:text-green-400">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span>Transcript available</span>
        </div>
        <button
          onClick={() => startTranscription(true)}
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
          Retranscribe
        </button>
      </div>
    );
  }

  if (state.type === "transcribing") {
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
          onClick={() => startTranscription()}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm border border-border rounded-lg hover:bg-surface-elevated text-foreground-muted hover:text-foreground transition-colors"
        >
          Retry Transcription
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => startTranscription()}
      disabled={state.type === "starting"}
      className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm border border-border rounded-lg hover:bg-surface-elevated text-foreground-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {state.type === "starting" ? (
        <>
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          <span>Starting transcription...</span>
        </>
      ) : (
        <>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
            />
          </svg>
          <span>Transcribe</span>
        </>
      )}
    </button>
  );
}
