"use client";

/**
 * Persistent mini listen-bar — the iOS tab-bar mini player, web edition.
 * Mounted once in ClientShell inside AudiobookProvider; visible whenever a
 * track is loaded and the user is NOT on that book's reader route (route-based
 * visibility — no claim tokens to leak). Clicking the bar reopens the full
 * player; playback itself never depends on any route being mounted.
 */

import { useLayoutEffect } from "react";
import { useLocation, useRouter } from "react-flight-router/client";
import { useAudiobook } from "./AudiobookProvider";
import { formatAudioTime } from "./format";

export function MiniListenBar() {
  const {
    track,
    chapters,
    currentChapterIndex,
    isPlaying,
    currentTime,
    duration,
    toggle,
    skipBy,
    stop,
  } = useAudiobook();
  const location = useLocation();
  const { navigate } = useRouter();

  const readerPath = track ? `/book/${track.bookId}/read` : null;
  const visible = Boolean(track) && location.pathname !== readerPath;

  // Reserve layout space so the footer isn't permanently obscured
  // (follows the --header-height precedent in ClientShell).
  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--listen-bar-height", visible ? "64px" : "0px");
    return () => {
      document.documentElement.style.setProperty("--listen-bar-height", "0px");
    };
  }, [visible]);

  if (!visible || !track) return null;

  const chapterTitle = chapters.length > 1 ? chapters[currentChapterIndex]?.title : undefined;
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  return (
    <div
      className="fixed bottom-0 inset-x-0 z-40 bg-[#151e1a]/96 text-white backdrop-blur-xl border-t border-white/10 cursor-pointer"
      onClick={() => navigate(readerPath!)}
      role="button"
      aria-label={`Open player for ${track.title}`}
    >
      {/* Hairline progress strip */}
      <div className="h-[2px] w-full bg-white/10">
        <div
          className="h-full bg-[#f1c84b] transition-[width]"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <div className="container mx-auto px-4 h-16 flex items-center gap-3">
        {track.coverUrl ? (
          <img
            src={track.coverUrl}
            alt=""
            className="w-10 h-10 rounded object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded bg-surface-elevated flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-foreground-muted" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white truncate">{track.title}</div>
          {chapterTitle && (
            <div className="text-xs text-white/55 truncate hidden sm:block">{chapterTitle}</div>
          )}
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            skipBy(-15);
          }}
          className="p-2 text-white/55 hover:text-white transition-colors"
          aria-label="Skip back 15 seconds"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
          </svg>
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          className="p-1.5 text-white hover:text-[#f1c84b] transition-colors"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" />
            </svg>
          ) : (
            <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
            </svg>
          )}
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            skipBy(30);
          }}
          className="p-2 text-white/55 hover:text-white transition-colors"
          aria-label="Skip forward 30 seconds"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z" />
          </svg>
        </button>

        <span className="text-xs text-white/55 tabular-nums hidden sm:block">
          -{formatAudioTime(Math.max(0, duration - currentTime))}
        </span>

        <button
          onClick={(e) => {
            e.stopPropagation();
            stop();
          }}
          className="p-2 text-white/45 hover:text-white transition-colors"
          aria-label="Stop listening"
          title="Stop (position is saved)"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
