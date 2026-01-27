"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { AudioChapter } from "../../lib/types";

interface AudiobookReaderProps {
  bookPath: string;
  position?: string;
  onPositionChange: (position: string, progress: number) => void;
  chapters?: AudioChapter[];
  duration?: number;
  coverPath?: string;
}

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const SLEEP_TIMER_OPTIONS = [
  { label: "Off", value: 0 },
  { label: "15 min", value: 15 * 60 },
  { label: "30 min", value: 30 * 60 },
  { label: "45 min", value: 45 * 60 },
  { label: "1 hour", value: 60 * 60 },
  { label: "End of chapter", value: -1 },
];

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AudiobookReader({
  bookPath,
  position,
  onPositionChange,
  chapters = [],
  duration: initialDuration,
  coverPath,
}: AudiobookReaderProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration || 0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [volume, setVolume] = useState(1);
  const [showToc, setShowToc] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showSleepMenu, setShowSleepMenu] = useState(false);
  const [sleepTimer, setSleepTimer] = useState(0);
  const [sleepTimeRemaining, setSleepTimeRemaining] = useState(0);
  const sleepTimerRef = useRef<NodeJS.Timeout | null>(null);
  const sleepEndChapterRef = useRef(false);

  // Parse initial position
  useEffect(() => {
    if (position && audioRef.current) {
      try {
        const pos = JSON.parse(position);
        if (typeof pos.currentTime === "number") {
          audioRef.current.currentTime = pos.currentTime;
        }
      } catch {
        // Ignore invalid position
      }
    }
  }, [position]);

  // Handle audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      const progress = audio.duration ? audio.currentTime / audio.duration : 0;
      const currentChapter = getCurrentChapterIndex(audio.currentTime);
      onPositionChange(
        JSON.stringify({ currentTime: audio.currentTime, chapter: currentChapter }),
        progress
      );

      // Check for end of chapter sleep timer
      if (sleepEndChapterRef.current && chapters.length > 0) {
        const chapter = chapters[currentChapter];
        if (chapter && audio.currentTime >= chapter.endTime - 0.5) {
          audio.pause();
          setSleepTimer(0);
          sleepEndChapterRef.current = false;
        }
      }
    };

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => setIsPlaying(false);

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [onPositionChange, chapters]);

  // Sleep timer countdown
  useEffect(() => {
    if (sleepTimer > 0 && sleepTimer !== -1) {
      setSleepTimeRemaining(sleepTimer);
      sleepTimerRef.current = setInterval(() => {
        setSleepTimeRemaining((prev) => {
          if (prev <= 1) {
            audioRef.current?.pause();
            setSleepTimer(0);
            if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else if (sleepTimer === -1) {
      sleepEndChapterRef.current = true;
    }

    return () => {
      if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
    };
  }, [sleepTimer]);

  const getCurrentChapterIndex = useCallback(
    (time: number): number => {
      if (chapters.length === 0) return 0;
      for (let i = chapters.length - 1; i >= 0; i--) {
        if (time >= chapters[i].startTime) return i;
      }
      return 0;
    },
    [chapters]
  );

  const currentChapterIndex = getCurrentChapterIndex(currentTime);

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
  }, [isPlaying]);

  const skip = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + seconds));
  }, []);

  const goToChapter = useCallback((index: number) => {
    const audio = audioRef.current;
    if (!audio || !chapters[index]) return;
    audio.currentTime = chapters[index].startTime;
    setShowToc(false);
  }, [chapters]);

  const goToPreviousChapter = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || chapters.length === 0) return;

    // If we're more than 3 seconds into current chapter, go to start of current
    // Otherwise go to previous chapter
    const currentChapter = chapters[currentChapterIndex];
    if (currentChapter && currentTime - currentChapter.startTime > 3) {
      audio.currentTime = currentChapter.startTime;
    } else if (currentChapterIndex > 0) {
      audio.currentTime = chapters[currentChapterIndex - 1].startTime;
    } else {
      audio.currentTime = 0;
    }
  }, [chapters, currentChapterIndex, currentTime]);

  const goToNextChapter = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || chapters.length === 0) return;
    if (currentChapterIndex < chapters.length - 1) {
      audio.currentTime = chapters[currentChapterIndex + 1].startTime;
    }
  }, [chapters, currentChapterIndex]);

  const handleSpeedChange = useCallback((speed: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = speed;
    setPlaybackSpeed(speed);
    setShowSpeedMenu(false);
  }, []);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const value = parseFloat(e.target.value);
    audio.volume = value;
    setVolume(value);
  }, []);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = parseFloat(e.target.value);
  }, []);

  const handleSleepTimer = useCallback((value: number) => {
    setSleepTimer(value);
    sleepEndChapterRef.current = value === -1;
    setShowSleepMenu(false);
  }, []);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="h-full flex bg-surface">
      {/* Chapter Sidebar */}
      {showToc && chapters.length > 0 && (
        <div className="w-72 border-r border-border bg-surface-elevated flex flex-col flex-shrink-0">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h3 className="font-bold text-foreground">Chapters</h3>
            <button
              onClick={() => setShowToc(false)}
              className="text-foreground-muted hover:text-foreground text-xl"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {chapters.map((chapter, i) => (
              <button
                key={i}
                onClick={() => goToChapter(i)}
                className={`w-full text-left p-3 text-sm hover:bg-surface rounded flex justify-between items-center gap-2 ${
                  i === currentChapterIndex ? "bg-primary-light text-primary" : "text-foreground"
                }`}
              >
                <span className="truncate flex-1">{chapter.title}</span>
                <span className="text-foreground-muted text-xs flex-shrink-0">
                  {formatTime(chapter.startTime)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Player */}
      <div className="flex-1 flex flex-col min-w-0">
        <audio ref={audioRef} src={bookPath} preload="metadata" />

        {/* Top Bar */}
        <div className="flex items-center gap-2 p-3 border-b border-border bg-surface flex-shrink-0">
          {chapters.length > 0 && (
            <button
              onClick={() => setShowToc(!showToc)}
              className="p-2 hover:bg-surface-elevated rounded text-foreground"
              title="Chapters"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )}

          {/* Current Chapter Display */}
          {chapters.length > 0 && chapters[currentChapterIndex] && (
            <span className="text-sm text-foreground-muted truncate">
              {chapters[currentChapterIndex].title}
            </span>
          )}

          <div className="flex-1" />

          {/* Sleep Timer */}
          <div className="relative">
            <button
              onClick={() => setShowSleepMenu(!showSleepMenu)}
              className={`p-2 hover:bg-surface-elevated rounded ${sleepTimer > 0 ? "text-primary" : "text-foreground"}`}
              title="Sleep Timer"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
              {sleepTimeRemaining > 0 && (
                <span className="absolute -top-1 -right-1 text-xs bg-primary text-white rounded-full px-1">
                  {Math.ceil(sleepTimeRemaining / 60)}
                </span>
              )}
            </button>
            {showSleepMenu && (
              <div className="absolute right-0 top-full mt-1 bg-surface-elevated border border-border rounded shadow-lg z-10">
                {SLEEP_TIMER_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => handleSleepTimer(option.value)}
                    className={`block w-full text-left px-4 py-2 text-sm hover:bg-surface ${
                      sleepTimer === option.value ? "text-primary" : "text-foreground"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Playback Speed */}
          <div className="relative">
            <button
              onClick={() => setShowSpeedMenu(!showSpeedMenu)}
              className="px-2 py-1 text-sm hover:bg-surface-elevated rounded text-foreground"
            >
              {playbackSpeed}x
            </button>
            {showSpeedMenu && (
              <div className="absolute right-0 top-full mt-1 bg-surface-elevated border border-border rounded shadow-lg z-10">
                {PLAYBACK_SPEEDS.map((speed) => (
                  <button
                    key={speed}
                    onClick={() => handleSpeedChange(speed)}
                    className={`block w-full text-left px-4 py-2 text-sm hover:bg-surface ${
                      playbackSpeed === speed ? "text-primary" : "text-foreground"
                    }`}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Volume */}
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15z" />
            </svg>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={volume}
              onChange={handleVolumeChange}
              className="w-20 accent-primary"
            />
          </div>
        </div>

        {/* Player Content Area */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 gap-8">
          {/* Cover Art */}
          {coverPath ? (
            <div className="w-64 h-64 rounded-lg shadow-lg overflow-hidden flex-shrink-0">
              <img
                src={coverPath}
                alt="Cover art"
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="w-64 h-64 rounded-lg bg-surface-elevated flex items-center justify-center flex-shrink-0">
              <svg className="w-24 h-24 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            </div>
          )}

          {/* Large centered play/pause area */}
          <div className="flex items-center gap-6">
            {/* Skip Back 15s */}
            <button
              onClick={() => skip(-15)}
              className="p-3 hover:bg-surface-elevated rounded-full text-foreground"
              title="Skip back 15 seconds"
            >
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
              </svg>
              <span className="text-xs">15</span>
            </button>

            {/* Previous Chapter */}
            {chapters.length > 0 && (
              <button
                onClick={goToPreviousChapter}
                className="p-3 hover:bg-surface-elevated rounded-full text-foreground"
                title="Previous chapter"
              >
                <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                </svg>
              </button>
            )}

            {/* Play/Pause */}
            <button
              onClick={togglePlayPause}
              className="p-6 bg-primary hover:bg-primary-dark rounded-full text-white"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              ) : (
                <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            {/* Next Chapter */}
            {chapters.length > 0 && (
              <button
                onClick={goToNextChapter}
                disabled={currentChapterIndex >= chapters.length - 1}
                className="p-3 hover:bg-surface-elevated rounded-full text-foreground disabled:opacity-50"
                title="Next chapter"
              >
                <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                </svg>
              </button>
            )}

            {/* Skip Forward 30s */}
            <button
              onClick={() => skip(30)}
              className="p-3 hover:bg-surface-elevated rounded-full text-foreground"
              title="Skip forward 30 seconds"
            >
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" />
              </svg>
              <span className="text-xs">30</span>
            </button>
          </div>

          {/* Progress Bar */}
          <div className="w-full max-w-2xl">
            <input
              type="range"
              min="0"
              max={duration || 100}
              value={currentTime}
              onChange={handleSeek}
              className="w-full accent-primary h-2 rounded-lg appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, var(--color-primary) ${progress}%, var(--color-border) ${progress}%)`,
              }}
            />
            <div className="flex justify-between text-sm text-foreground-muted mt-2">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
