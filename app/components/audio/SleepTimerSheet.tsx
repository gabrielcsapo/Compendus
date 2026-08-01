"use client";

import { useState } from "react";
import { useAudiobook } from "./AudiobookProvider";

const PRESETS = [5, 15, 30, 45, 60];

/**
 * Sleep timer panel (iOS SleepTimerSheet parity): minute presets, custom
 * minutes, end-of-current-chapter; when armed shows the countdown with
 * +5/+15 extend and cancel. Firing pauses playback.
 */
export function SleepTimerSheet({ onClose }: { onClose: () => void }) {
  const {
    sleepTimer,
    sleepRemainingSec,
    setSleepTimer,
    extendSleepTimer,
    cancelSleepTimer,
    chapters,
    currentChapterIndex,
  } = useAudiobook();
  const [customMinutes, setCustomMinutes] = useState(20);

  const hasNextChapterEnd = chapters.length > 0 && currentChapterIndex < chapters.length;

  const fmt = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 rounded-t-2xl bg-black/85 backdrop-blur-xl border-t border-white/10 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white">Sleep timer</h3>
        <button
          onClick={onClose}
          aria-label="Close sleep timer"
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

      {sleepTimer ? (
        <div className="flex flex-col items-center gap-4 pb-2">
          <div className="text-4xl font-bold text-white tabular-nums">
            {sleepRemainingSec !== null ? fmt(sleepRemainingSec) : "—"}
          </div>
          <p className="text-xs text-white/60">
            {sleepTimer.kind === "end-of-chapter"
              ? "Pausing at the end of this chapter"
              : "Playback will pause when the timer ends"}
          </p>
          <div className="flex gap-2">
            {sleepTimer.kind === "duration" && (
              <>
                <button
                  onClick={() => extendSleepTimer(5)}
                  className="px-3 py-1.5 rounded-lg bg-white/10 text-white text-xs hover:bg-white/20"
                >
                  +5 min
                </button>
                <button
                  onClick={() => extendSleepTimer(15)}
                  className="px-3 py-1.5 rounded-lg bg-white/10 text-white text-xs hover:bg-white/20"
                >
                  +15 min
                </button>
              </>
            )}
            <button
              onClick={() => {
                cancelSleepTimer();
              }}
              className="px-3 py-1.5 rounded-lg bg-white/20 text-white text-xs font-medium hover:bg-white/30"
            >
              Cancel timer
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 pb-2">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((m) => (
              <button
                key={m}
                onClick={() => {
                  setSleepTimer({ minutes: m });
                  onClose();
                }}
                className="px-3.5 py-2 rounded-lg bg-white/10 text-white text-sm hover:bg-white/20"
              >
                {m} min
              </button>
            ))}
            {hasNextChapterEnd && (
              <button
                onClick={() => {
                  setSleepTimer({ endOfChapter: true });
                  onClose();
                }}
                className="px-3.5 py-2 rounded-lg bg-white/10 text-white text-sm hover:bg-white/20"
              >
                End of chapter
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={5}
              max={180}
              step={5}
              value={customMinutes}
              onChange={(e) => setCustomMinutes(parseInt(e.target.value, 10))}
              className="flex-1 h-1 rounded-lg appearance-none cursor-pointer"
              style={{ accentColor: "#fff" }}
              aria-label="Custom sleep timer minutes"
            />
            <button
              onClick={() => {
                setSleepTimer({ minutes: customMinutes });
                onClose();
              }}
              className="px-3 py-1.5 rounded-lg bg-white/15 text-white text-xs whitespace-nowrap hover:bg-white/25 tabular-nums"
            >
              Start {customMinutes} min
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
