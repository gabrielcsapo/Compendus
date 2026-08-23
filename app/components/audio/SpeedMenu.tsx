"use client";

import { useEffect, useRef, useState } from "react";
import { useAudiobook } from "./AudiobookProvider";
import { PLAYBACK_SPEEDS, PLAYBACK_SPEED_RANGE } from "@/lib/reader/settings";

/**
 * In-player speed control: preset chips + a fine slider (iOS SpeedSliderSheet
 * parity, 0.5–3.0× step 0.05, pitch preserved by the browser by default).
 * Writes through the provider, which persists to reader settings.
 */
export function SpeedMenu() {
  const { playbackRate, setRate } = useAudiobook();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  const label = `${Number(playbackRate.toFixed(2))}x`;

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
        style={{
          backgroundColor: open ? "rgba(156,202,184,0.22)" : "rgba(255,255,255,0.07)",
          color: "#eef3ef",
        }}
        aria-label="Playback speed"
      >
        {label} speed
      </button>
      {open && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-64 rounded-xl bg-[#151e1a]/95 backdrop-blur-xl border border-white/10 p-3 z-30 shadow-2xl">
          <div className="flex flex-wrap gap-1.5 justify-center">
            {PLAYBACK_SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => setRate(s)}
                className={`px-2.5 py-1 rounded-md text-xs tabular-nums transition-colors ${
                  Math.abs(playbackRate - s) < 0.001
                    ? "bg-white text-black font-semibold"
                    : "bg-white/10 text-white hover:bg-white/20"
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
          <div className="mt-3">
            <input
              type="range"
              min={PLAYBACK_SPEED_RANGE.min}
              max={PLAYBACK_SPEED_RANGE.max}
              step={PLAYBACK_SPEED_RANGE.step}
              value={playbackRate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
              className="w-full h-1 rounded-lg appearance-none cursor-pointer"
              style={{ accentColor: "#f1c84b" }}
              aria-label="Fine speed control"
            />
            <div className="flex justify-between text-[10px] text-white/50 mt-1">
              <span>{PLAYBACK_SPEED_RANGE.min}x</span>
              <span className="text-white/80 tabular-nums">{label}</span>
              <span>{PLAYBACK_SPEED_RANGE.max}x</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
