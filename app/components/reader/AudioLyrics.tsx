"use client";

import { useState, useEffect, useRef, useMemo } from "react";

interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words: TranscriptWord[];
}

interface Transcript {
  duration: number;
  language: string;
  segments: TranscriptSegment[];
}

interface AudioLyricsProps {
  bookId: string;
  currentTime: number;
  onSeek: (time: number) => void;
  theme: { background: string; foreground: string; muted: string; accent: string };
}

export function AudioLyrics({ bookId, currentTime, onSeek, theme }: AudioLyricsProps) {
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);

  // Fetch transcript on mount
  useEffect(() => {
    fetch(`/api/books/${bookId}/transcript`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.transcript) {
          setTranscript(data.transcript);
        } else {
          setError("No transcript available");
        }
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load transcript");
        setLoading(false);
      });
  }, [bookId]);

  // Find the active segment index using binary search
  const activeIndex = useMemo(() => {
    if (!transcript) return -1;
    const segments = transcript.segments;
    let lo = 0;
    let hi = segments.length - 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (currentTime < segments[mid].start) {
        hi = mid - 1;
      } else if (currentTime > segments[mid].end) {
        lo = mid + 1;
      } else {
        return mid;
      }
    }
    // If between segments, return the previous one
    if (lo > 0 && lo < segments.length && currentTime < segments[lo].start) {
      return lo - 1;
    }
    return -1;
  }, [transcript, currentTime]);

  // Auto-scroll to active line
  useEffect(() => {
    if (activeLineRef.current) {
      activeLineRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeIndex]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8" style={{ color: theme.muted }}>
        <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
        Loading transcript...
      </div>
    );
  }

  if (error || !transcript) {
    return (
      <div className="text-center py-8 text-sm" style={{ color: theme.muted }}>
        {error || "No transcript available"}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="overflow-y-auto px-4 py-4 space-y-3"
      style={{ maxHeight: "300px" }}
    >
      {transcript.segments.map((segment, i) => {
        const isActive = i === activeIndex;
        const isPast = activeIndex > -1 && i < activeIndex;
        return (
          <div
            key={i}
            ref={isActive ? activeLineRef : undefined}
            onClick={() => onSeek(segment.start)}
            className="cursor-pointer transition-all duration-200 px-3 py-1.5 rounded-lg"
            style={{
              opacity: isActive ? 1 : isPast ? 0.5 : 0.35,
              fontSize: isActive ? "1.1em" : "1em",
              fontWeight: isActive ? 600 : 400,
              backgroundColor: isActive ? `${theme.accent}15` : "transparent",
            }}
          >
            {isActive ? (
              <span>
                {segment.words.map((word, wi) => {
                  const isWordActive = currentTime >= word.start && currentTime < word.end;
                  const isWordPast = currentTime >= word.end;
                  return (
                    <span
                      key={wi}
                      style={{
                        color: isWordActive
                          ? theme.accent
                          : isWordPast
                            ? theme.foreground
                            : theme.muted,
                        fontWeight: isWordActive ? 700 : 600,
                        transition: "color 0.15s ease",
                      }}
                    >
                      {word.word}{" "}
                    </span>
                  );
                })}
              </span>
            ) : (
              <span style={{ color: isPast ? theme.foreground : theme.muted }}>
                {segment.text}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
