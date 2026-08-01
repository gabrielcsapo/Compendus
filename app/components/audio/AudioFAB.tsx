"use client";

/**
 * Floating audio button inside the ebook/PDF/comic reader (iOS AudioFABView
 * parity) — read one book while listening to another. Cover art in a circle
 * with a progress ring; tap = play/pause; the small arrow chip opens the
 * audiobook's full player.
 */

import { useRouter } from "react-flight-router/client";
import { useAudiobookOptional } from "./AudiobookProvider";

export function AudioFAB() {
  const audiobook = useAudiobookOptional();
  const { navigate } = useRouter();
  if (!audiobook?.track) return null;
  const { track, isPlaying, currentTime, duration, toggle } = audiobook;

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const R = 26;
  const C = 2 * Math.PI * R;

  return (
    <div className="fixed bottom-6 right-6 z-40 select-none">
      <button
        onClick={toggle}
        className="relative w-16 h-16 rounded-full shadow-2xl focus:outline-none"
        aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
        title={track.title}
      >
        {track.coverUrl ? (
          <img
            src={track.coverUrl}
            alt=""
            className="absolute inset-1 w-14 h-14 rounded-full object-cover"
          />
        ) : (
          <div className="absolute inset-1 w-14 h-14 rounded-full bg-surface-elevated" />
        )}
        {/* Dim disc + glyph */}
        <div className="absolute inset-1 w-14 h-14 rounded-full bg-black/45 flex items-center justify-center">
          {isPlaying ? (
            <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
            </svg>
          ) : (
            <svg className="w-6 h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </div>
        {/* Progress ring */}
        <svg
          className="absolute inset-0 w-16 h-16 -rotate-90 pointer-events-none"
          viewBox="0 0 64 64"
        >
          <circle
            cx="32"
            cy="32"
            r={R}
            fill="none"
            stroke="rgba(255,255,255,0.25)"
            strokeWidth="3"
          />
          <circle
            cx="32"
            cy="32"
            r={R}
            fill="none"
            stroke="var(--color-primary, #6366f1)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - progress)}
          />
        </svg>
      </button>
      {/* Expand chip → full player */}
      <button
        onClick={() => navigate(`/book/${track.bookId}/read`)}
        className="absolute -top-1.5 -left-1.5 w-6 h-6 rounded-full bg-background border border-border shadow flex items-center justify-center text-foreground-muted hover:text-foreground"
        aria-label="Open full player"
        title="Open full player"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </button>
    </div>
  );
}
