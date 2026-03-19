"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useRouter } from "react-flight-router/client";
import { buttonStyles } from "../lib/styles";

interface ConvertToEpubButtonProps {
  bookId: string;
  hasEpub: boolean;
  progressPercent?: number;
  /** "primary" (default) shows as main CTA; "secondary" shows as an optional alternative */
  variant?: "primary" | "secondary";
}

type ConversionState =
  | { type: "idle" }
  | { type: "starting" }
  | { type: "converting"; progress: number; message: string; jobId: string }
  | { type: "completed" }
  | { type: "error"; message: string };

export function ConvertToEpubButton({
  bookId,
  hasEpub,
  progressPercent = 0,
  variant = "primary",
}: ConvertToEpubButtonProps) {
  const { navigate } = useRouter();
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
            navigate(`/book/${bookId}/read?format=epub`);
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
    [stopPolling, bookId, navigate],
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
        navigate(`/book/${bookId}/read?format=epub`);
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

  const readLabel =
    variant === "secondary"
      ? progressPercent > 0
        ? "Continue Reading as EPUB"
        : "Read as EPUB"
      : progressPercent > 0
        ? "Continue Reading"
        : "Start Reading";
  const convertLabel = variant === "secondary" ? "Convert to EPUB" : readLabel;
  const btnStyle = variant === "secondary" ? buttonStyles.secondary : buttonStyles.primary;

  // Already converted — just a read link
  if (state.type === "completed") {
    return (
      <Link
        to={`/book/${bookId}/read?format=epub`}
        className={`${buttonStyles.base} ${btnStyle} w-full text-center justify-center gap-2`}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
          />
        </svg>
        {readLabel}
      </Link>
    );
  }

  // Converting — show progress
  if (state.type === "converting") {
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

  // Error — show message + retry
  if (state.type === "error") {
    return (
      <div className="space-y-2">
        <div className="px-3 py-2 text-sm rounded-lg bg-red-500/10 text-red-700 dark:text-red-400">
          {state.message}
        </div>
        <button
          onClick={() => startConversion()}
          className={`${buttonStyles.base} ${btnStyle} w-full text-center justify-center gap-2`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
            />
          </svg>
          Retry Conversion
        </button>
      </div>
    );
  }

  // Idle / Starting — button that triggers conversion
  return (
    <button
      onClick={() => startConversion()}
      disabled={state.type === "starting"}
      className={`${buttonStyles.base} ${btnStyle} w-full text-center justify-center gap-2`}
    >
      {state.type === "starting" ? (
        <>
          <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          <span>Converting...</span>
        </>
      ) : (
        <>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
            />
          </svg>
          <span>{convertLabel}</span>
        </>
      )}
    </button>
  );
}

/**
 * Reconvert button — meant to be placed in a details/settings area, not prominent.
 */
export function ReconvertEpubButton({ bookId }: { bookId: string }) {
  const [state, setState] = useState<"idle" | "starting" | "done">("idle");

  const reconvert = async () => {
    setState("starting");
    try {
      await fetch(`/api/books/${bookId}/convert-to-epub`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      setState("done");
    } catch {
      setState("idle");
    }
  };

  if (state === "done") {
    return (
      <span className="text-sm text-green-600 dark:text-green-400">
        Reconversion queued — check progress on the book page
      </span>
    );
  }

  return (
    <button
      onClick={reconvert}
      disabled={state === "starting"}
      className="text-sm text-foreground-muted hover:text-foreground transition-colors disabled:opacity-50"
    >
      {state === "starting" ? "Queuing..." : "Reconvert EPUB"}
    </button>
  );
}
