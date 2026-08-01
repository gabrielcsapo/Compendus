"use client";

import { useEffect, useRef } from "react";
import { useAudiobook } from "./AudiobookProvider";
import { formatAudioTime } from "./format";

/**
 * Slide-up chapter panel for the full player: every chapter with its start
 * time and progress fill, current chapter highlighted and auto-scrolled into
 * view (iOS ChaptersListView parity).
 */
export function ChapterList({ onClose }: { onClose: () => void }) {
  const { chapters, currentChapterIndex, currentTime, duration, goToChapter } = useAudiobook();
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center" });
  }, []);

  return (
    <div className="absolute inset-x-0 bottom-0 top-16 z-20 flex flex-col rounded-t-2xl overflow-hidden bg-black/80 backdrop-blur-xl">
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
        <h3 className="text-sm font-semibold text-white">
          Chapters <span className="text-white/50 font-normal">({chapters.length})</span>
        </h3>
        <button
          onClick={onClose}
          aria-label="Close chapters"
          className="p-1.5 rounded-full text-white/70 hover:text-white hover:bg-white/10"
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
      <div className="flex-1 overflow-y-auto py-2">
        {chapters.map((ch, i) => {
          const end = ch.endTime ?? duration;
          const isCurrent = i === currentChapterIndex;
          const fill = isCurrent
            ? Math.min(
                1,
                Math.max(0, (currentTime - ch.startTime) / Math.max(1, end - ch.startTime)),
              )
            : currentTime > end
              ? 1
              : 0;
          return (
            <button
              key={`${ch.startTime}-${i}`}
              ref={isCurrent ? activeRef : undefined}
              onClick={() => {
                goToChapter(i);
                onClose();
              }}
              className={`w-full text-left px-5 py-3 flex items-center gap-3 transition-colors ${
                isCurrent ? "bg-white/10" : "hover:bg-white/5"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div
                  className={`text-sm truncate ${isCurrent ? "text-white font-medium" : "text-white/80"}`}
                >
                  {ch.title}
                </div>
                <div className="mt-1.5 h-0.5 rounded bg-white/15 overflow-hidden">
                  <div className="h-full bg-white/80" style={{ width: `${fill * 100}%` }} />
                </div>
              </div>
              <span className="text-xs text-white/50 tabular-nums flex-shrink-0">
                {formatAudioTime(ch.startTime)}
              </span>
              {isCurrent && (
                <svg
                  className="w-4 h-4 text-white flex-shrink-0"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                  aria-label="Now playing"
                >
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
