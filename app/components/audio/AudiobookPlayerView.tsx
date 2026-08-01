"use client";

/**
 * Full-screen audiobook player — a VIEW over the global AudiobookProvider
 * (which owns the <audio> element; this component renders none). Replaces the
 * old route-local AudioContent, adding iOS parity: chapter list, in-player
 * speed control, sleep timer, keyboard shortcuts, elapsed/remaining, and the
 * next-in-series handoff card.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "react-flight-router/client";
import { useAudiobook } from "./AudiobookProvider";
import { ChapterList } from "./ChapterList";
import { SpeedMenu } from "./SpeedMenu";
import { SleepTimerSheet } from "./SleepTimerSheet";
import { formatAudioTime } from "./format";
import { AudioLyrics } from "../reader/AudioLyrics";
import { getBooks } from "@/actions/books";
import { THEMES, type ReaderSettings } from "@/lib/reader/settings";
import type { PageContent } from "@/lib/reader/types";

interface AudiobookPlayerViewProps {
  content: PageContent;
  settings: ReaderSettings;
  bookId?: string;
  hasTranscript?: boolean;
  coverPath?: string;
  isJumpNavigation?: boolean;
  /** Reader navigation by whole-book fraction — keeps the toolbar/slider honest. */
  onNavigateToPosition?: (position: number) => void;
}

interface NextInSeries {
  id: string;
  title: string;
  coverPath: string | null;
}

export function AudiobookPlayerView({
  content,
  settings,
  bookId,
  hasTranscript,
  coverPath,
  isJumpNavigation,
  onNavigateToPosition,
}: AudiobookPlayerViewProps) {
  const audiobook = useAudiobook();
  const {
    track,
    chapters,
    isPlaying,
    currentTime,
    duration,
    toggle,
    seekTo,
    skipBy,
    goToChapter,
    setVolume,
    volume,
    currentChapterIndex,
    sleepTimer,
    sleepRemainingSec,
  } = audiobook;
  const { navigate } = useRouter();

  const [showLyrics, setShowLyrics] = useState(false);
  const [showChapters, setShowChapters] = useState(false);
  const [showSleepTimer, setShowSleepTimer] = useState(false);
  const [nextInSeries, setNextInSeries] = useState<NextInSeries | null>(null);
  const [nextDismissed, setNextDismissed] = useState(false);

  const theme = THEMES[settings.theme];
  const skipBack = settings.audioSkipBackInterval ?? 15;
  const skipForward = settings.audioSkipForwardInterval ?? 30;

  // --- reader-page ↔ provider-chapter sync -----------------------------------
  // The reader still models one chapter per "page" (TOC + slider drive it).
  // followingRef marks page changes WE caused by following playback, so the
  // jump-seek effect below doesn't loop-seek on them.
  const followingRef = useRef(false);
  const lastStartTimeRef = useRef<number | undefined>(content.startTime);

  // Explicit navigation (TOC/slider/deep link) → seek playback.
  useEffect(() => {
    const prev = lastStartTimeRef.current;
    lastStartTimeRef.current = content.startTime;
    if (content.startTime === undefined || content.startTime === prev) return;
    if (followingRef.current) {
      followingRef.current = false;
      return;
    }
    if (isJumpNavigation === false) return; // page flip that isn't a jump: ignore
    seekTo(content.startTime);
  }, [content.startTime, isJumpNavigation, seekTo]);

  // Playback crossing a chapter boundary → advance the reader page.
  useEffect(() => {
    if (!onNavigateToPosition || duration <= 0 || chapters.length < 2) return;
    const ch = chapters[currentChapterIndex];
    if (!ch || content.chapter?.index === currentChapterIndex) return;
    followingRef.current = true;
    onNavigateToPosition(ch.startTime / duration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChapterIndex]);

  // --- keyboard shortcuts -----------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      switch (e.key) {
        case " ":
          e.preventDefault();
          toggle();
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (e.shiftKey) goToChapter(currentChapterIndex - 1);
          else skipBy(-skipBack);
          break;
        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey) goToChapter(currentChapterIndex + 1);
          else skipBy(skipForward);
          break;
        case "ArrowUp":
          e.preventDefault();
          setVolume(volume + 0.05);
          break;
        case "ArrowDown":
          e.preventDefault();
          setVolume(volume - 0.05);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, skipBy, goToChapter, setVolume, volume, currentChapterIndex, skipBack, skipForward]);

  // --- next-in-series (final 30s) ---------------------------------------------
  const inFinalStretch = duration > 0 && duration - currentTime < 30 && duration - currentTime > 0;
  const seriesLookupRef = useRef(false);
  useEffect(() => {
    if (!inFinalStretch || nextInSeries || seriesLookupRef.current) return;
    if (!track?.series || track.seriesNumber == null) return;
    seriesLookupRef.current = true;
    getBooks({ series: track.series, type: "audiobook" })
      .then((books) => {
        const currentNo = parseFloat(String(track.seriesNumber));
        const next = books
          .filter((b) => b.id !== track.bookId && parseFloat(String(b.seriesNumber)) > currentNo)
          .sort(
            (a, b) => parseFloat(String(a.seriesNumber)) - parseFloat(String(b.seriesNumber)),
          )[0];
        if (next) setNextInSeries({ id: next.id, title: next.title, coverPath: next.coverPath });
      })
      .catch(() => {});
  }, [inFinalStretch, nextInSeries, track]);

  const handleSeekInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => seekTo(parseFloat(e.target.value)),
    [seekTo],
  );

  const coverUrl = track?.coverUrl ?? (bookId && coverPath ? `/covers/${bookId}.jpg` : null);
  const chapterTitle =
    chapters[currentChapterIndex]?.title || content.chapterTitle || "Now Playing";
  const multiChapter = chapters.length > 1;

  return (
    <div className="h-full flex flex-col relative overflow-hidden" style={{ color: "#fff" }}>
      {/* Vibrant blurred cover background (Spotify-style) */}
      {coverUrl && (
        <img
          src={coverUrl}
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none"
          style={{ filter: "blur(60px) saturate(1.8)", transform: "scale(1.15)", opacity: 0.7 }}
        />
      )}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.20) 40%, rgba(0,0,0,0.60) 100%)",
        }}
      />

      {/* Scrollable content area */}
      <div className="relative flex-1 flex flex-col items-center justify-center gap-6 px-8 py-10 overflow-y-auto">
        {coverUrl && !showLyrics && (
          <img
            src={coverUrl}
            alt="Album art"
            className="w-56 h-56 object-cover rounded-xl shadow-2xl flex-shrink-0"
            style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}
          />
        )}

        {showLyrics && bookId && (
          <div className="w-full max-w-lg">
            <AudioLyrics bookId={bookId} currentTime={currentTime} onSeek={seekTo} theme={theme} />
          </div>
        )}

        {/* Chapter info */}
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-1 drop-shadow">{chapterTitle}</h2>
          {multiChapter && (
            <button
              onClick={() => setShowChapters(true)}
              className="text-sm hover:text-white transition-colors"
              style={{ color: "rgba(255,255,255,0.65)" }}
            >
              Chapter {currentChapterIndex + 1} of {chapters.length} ▾
            </button>
          )}
        </div>

        {/* Progress bar */}
        <div className="w-full max-w-lg">
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={Math.min(currentTime, duration || 0)}
            onChange={handleSeekInput}
            className="w-full h-1 rounded-lg appearance-none cursor-pointer"
            style={{ accentColor: "#fff" }}
            aria-label="Seek"
          />
          <div
            className="flex justify-between text-xs mt-1.5"
            style={{ color: "rgba(255,255,255,0.65)" }}
          >
            <span className="tabular-nums">{formatAudioTime(currentTime)}</span>
            <span className="tabular-nums">
              {duration > 0 ? `${Math.round((currentTime / duration) * 100)}%` : ""}
            </span>
            <span className="tabular-nums">
              -{formatAudioTime(Math.max(0, duration - currentTime))}
            </span>
          </div>
        </div>

        {/* Transport */}
        <div className="flex items-center gap-8">
          <button
            onClick={() => skipBy(-skipBack)}
            className="opacity-90 hover:opacity-100 transition-opacity"
            aria-label={`Skip back ${skipBack} seconds`}
          >
            <svg className="w-9 h-9" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
              <text
                x={skipBack >= 100 ? "7.5" : "9"}
                y="15"
                fontSize="5.5"
                fontWeight="bold"
                fill="currentColor"
              >
                {skipBack}
              </text>
            </svg>
          </button>

          <button
            onClick={toggle}
            className="opacity-95 hover:opacity-100 transition-opacity"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <svg className="w-16 h-16" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" />
              </svg>
            ) : (
              <svg className="w-16 h-16" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
              </svg>
            )}
          </button>

          <button
            onClick={() => skipBy(skipForward)}
            className="opacity-90 hover:opacity-100 transition-opacity"
            aria-label={`Skip forward ${skipForward} seconds`}
          >
            <svg className="w-9 h-9" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z" />
              <text
                x={skipForward >= 100 ? "7.5" : "9"}
                y="15"
                fontSize="5.5"
                fontWeight="bold"
                fill="currentColor"
              >
                {skipForward}
              </text>
            </svg>
          </button>
        </div>

        {/* Utility row: volume | chapters | lyrics | sleep | speed */}
        <div className="flex items-center justify-between w-full max-w-lg gap-4 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[10rem]">
            <svg
              className="w-4 h-4 flex-shrink-0 opacity-70"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M3 9v6h4l5 5V4L7 9H3z" />
            </svg>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="flex-1 h-1 rounded-lg appearance-none cursor-pointer"
              style={{ accentColor: "#fff" }}
              aria-label="Volume"
            />
            <svg
              className="w-4 h-4 flex-shrink-0 opacity-70"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
            </svg>
          </div>

          <div className="flex items-center gap-2">
            {multiChapter && (
              <button
                onClick={() => setShowChapters(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors text-xs"
                style={{ backgroundColor: "rgba(255,255,255,0.10)", color: "#fff" }}
                title="Chapters"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h7"
                  />
                </svg>
                Chapters
              </button>
            )}

            {hasTranscript && bookId && (
              <button
                onClick={() => setShowLyrics(!showLyrics)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors text-xs"
                style={{
                  backgroundColor: showLyrics ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.10)",
                  color: "#fff",
                }}
                title={showLyrics ? "Hide lyrics" : "Show lyrics"}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                Lyrics
              </button>
            )}

            <button
              onClick={() => setShowSleepTimer(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors text-xs tabular-nums"
              style={{
                backgroundColor: sleepTimer ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.10)",
                color: "#fff",
              }}
              title="Sleep timer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                />
              </svg>
              {sleepTimer && sleepRemainingSec !== null
                ? `${Math.floor(sleepRemainingSec / 60)}:${String(sleepRemainingSec % 60).padStart(2, "0")}`
                : "Sleep"}
            </button>

            <SpeedMenu />
          </div>
        </div>
      </div>

      {/* Next-in-series card (final 30 seconds) */}
      {inFinalStretch && nextInSeries && !nextDismissed && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 rounded-xl bg-black/80 backdrop-blur-xl border border-white/10 px-4 py-3 shadow-2xl max-w-sm w-[calc(100%-3rem)]">
          {nextInSeries.coverPath && (
            <img
              src={`/covers/${nextInSeries.id}.jpg`}
              alt=""
              className="w-10 h-14 object-cover rounded flex-shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wide text-white/50">
              Up next in series
            </div>
            <div className="text-sm text-white font-medium truncate">{nextInSeries.title}</div>
          </div>
          <button
            onClick={() => navigate(`/book/${nextInSeries.id}/read`)}
            className="p-2 rounded-full bg-white text-black hover:bg-white/90 flex-shrink-0"
            aria-label={`Play ${nextInSeries.title}`}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
          <button
            onClick={() => setNextDismissed(true)}
            className="p-1 text-white/50 hover:text-white flex-shrink-0"
            aria-label="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}

      {showChapters && <ChapterList onClose={() => setShowChapters(false)} />}
      {showSleepTimer && <SleepTimerSheet onClose={() => setShowSleepTimer(false)} />}
    </div>
  );
}
