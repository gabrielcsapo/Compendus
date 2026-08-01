"use client";

/**
 * Global audiobook playback — the web equivalent of iOS's AudiobookPlayer
 * service. Mounted ONCE in ClientShell (never unmounts across SPA
 * navigations), owns the single hidden <audio> element and all playback state.
 * The full-screen player (AudiobookPlayerView) and the persistent
 * MiniListenBar are both views over this provider, which is what lets audio
 * keep playing when the reader closes.
 *
 * Handoff protocol: the reader route CLAIMS the provider on mount via load();
 * load() is idempotent by bookId (same book = adopt, keep playing) and the
 * reader releases nothing on unmount. Never pause in effect cleanups —
 * StrictMode double-invokes them.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AudioChapter } from "@/lib/types";
import { serializeAudioPosition } from "@/lib/audio-position";
import { saveReadingProgress, createReadingSession, endReadingSession } from "@/actions/reader";
import { getWebDevice } from "@/lib/web-device";

export interface AudiobookTrack {
  bookId: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  audioUrl: string;
  format: string;
  /** From books.duration (seconds); element duration is the fallback. */
  duration: number;
  chapters: AudioChapter[];
  hasTranscript: boolean;
  series?: string | null;
  seriesNumber?: string | null;
}

export type SleepTimer =
  | { kind: "duration"; endsAt: number }
  | { kind: "end-of-chapter"; chapterIndex: number }
  | null;

export interface AudiobookContextValue {
  track: AudiobookTrack | null;
  /** track.chapters, or a synthesized single chapter — never empty while loaded. */
  chapters: AudioChapter[];
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  volume: number;
  sleepTimer: SleepTimer;
  sleepRemainingSec: number | null;
  currentChapterIndex: number;

  load: (track: AudiobookTrack, opts?: { startAt?: number; forceSeek?: boolean }) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seekTo: (sec: number) => void;
  skipBy: (sec: number) => void;
  goToChapter: (index: number) => void;
  setRate: (r: number) => void;
  setVolume: (v: number) => void;
  setSleepTimer: (t: { minutes: number } | { endOfChapter: true }) => void;
  extendSleepTimer: (minutes: number) => void;
  cancelSleepTimer: () => void;
  stop: () => void;
}

const AudiobookContext = createContext<AudiobookContextValue | null>(null);

export function useAudiobook(): AudiobookContextValue {
  const ctx = useContext(AudiobookContext);
  if (!ctx) throw new Error("useAudiobook must be used inside AudiobookProvider");
  return ctx;
}

/** Same-shape hook that tolerates absence (for components that render outside the shell). */
export function useAudiobookOptional(): AudiobookContextValue | null {
  return useContext(AudiobookContext);
}

const SETTINGS_KEY = "reader-settings"; // useReaderSettings' storage key
const SAVE_INTERVAL_MS = 30_000;

function readAudioSettings(): { rate: number; volume: number } {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = JSON.parse(raw) as { audioPlaybackSpeed?: number; audioVolume?: number };
      return {
        rate: clampRate(Number(s.audioPlaybackSpeed) || 1),
        volume: Math.max(0, Math.min(1, Number(s.audioVolume ?? 1))),
      };
    }
  } catch {
    /* defaults below */
  }
  return { rate: 1, volume: 1 };
}

function writeAudioSettings(patch: { audioPlaybackSpeed?: number; audioVolume?: number }): void {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const s = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...s, ...patch }));
  } catch {
    /* settings persistence is best-effort */
  }
}

const clampRate = (r: number) => Math.min(3, Math.max(0.5, r));

function getClientProfileId(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(/(?:^|;\s*)compendus-profile=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

/** Binary search: index of the chapter containing `time`. */
export function chapterIndexAt(chapters: AudioChapter[], time: number): number {
  if (chapters.length === 0) return 0;
  let lo = 0;
  let hi = chapters.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (chapters[mid].startTime <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function AudiobookProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [track, setTrack] = useState<AudiobookTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [elementDuration, setElementDuration] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [volume, setVolumeState] = useState(1);
  const [sleepTimer, setSleepTimerState] = useState<SleepTimer>(null);
  const [sleepRemainingSec, setSleepRemainingSec] = useState<number | null>(null);

  const pendingSeekRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  // Refs mirror state the unload/save handlers need without re-binding listeners.
  const stateRef = useRef({ track, currentTime: 0, duration: 0, isPlaying: false });

  const duration = track?.duration || elementDuration || 0;
  const chapters = useMemo<AudioChapter[]>(() => {
    if (!track) return [];
    if (track.chapters.length > 0) return track.chapters;
    // Single-chapter fallback (plain mp3s) so every chapter UI degrades cleanly.
    return [{ index: 0, title: track.title, startTime: 0, endTime: duration }];
  }, [track, duration]);
  const currentChapterIndex = useMemo(
    () => chapterIndexAt(chapters, currentTime),
    [chapters, currentTime],
  );

  useEffect(() => {
    stateRef.current = { track, currentTime, duration, isPlaying };
  }, [track, currentTime, duration, isPlaying]);

  // Hydrate rate/volume from reader settings once on mount (client only).
  useEffect(() => {
    const { rate, volume: v } = readAudioSettings();
    setPlaybackRateState(rate);
    setVolumeState(v);
  }, []);

  // Apply rate/volume to the element.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate, track]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume, track]);

  // ---- persistence -----------------------------------------------------------

  const savePosition = useCallback((why: string) => {
    const { track: t, currentTime: ct, duration: dur } = stateRef.current;
    if (!t || dur <= 0 || ct <= 0) return;
    void why;
    saveReadingProgress(
      t.bookId,
      Math.min(1, ct / dur),
      undefined,
      getClientProfileId(),
      serializeAudioPosition(ct, dur),
      getWebDevice(),
    ).catch(() => {
      /* transient save failures are re-tried by the next interval tick */
    });
  }, []);

  /** Unload-safe save: server actions don't survive pagehide; the sync PUT does. */
  const savePositionKeepalive = useCallback(() => {
    const { track: t, currentTime: ct, duration: dur } = stateRef.current;
    if (!t || dur <= 0 || ct <= 0) return;
    const device = getWebDevice();
    try {
      fetch("/api/sync/reading-progress", {
        method: "PUT",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId: t.bookId,
          readingProgress: Math.min(1, ct / dur),
          lastPosition: serializeAudioPosition(ct, dur),
          lastReadAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          deviceId: device?.deviceId,
          deviceName: device?.deviceName,
          deviceType: device?.deviceType,
        }),
      }).catch(() => {});
    } catch {
      /* page is going away */
    }
  }, []);

  // Interval save while playing.
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => savePosition("interval"), SAVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isPlaying, savePosition]);

  // Unload/hidden saves.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") savePositionKeepalive();
    };
    window.addEventListener("pagehide", savePositionKeepalive);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", savePositionKeepalive);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [savePositionKeepalive]);

  const endSession = useCallback(() => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    sessionIdRef.current = null;
    const { currentTime: ct } = stateRef.current;
    endReadingSession(sid, String(ct)).catch(() => {});
  }, []);

  // ---- sleep timer -----------------------------------------------------------

  useEffect(() => {
    if (!sleepTimer) {
      setSleepRemainingSec(null);
      return;
    }
    const tick = () => {
      if (sleepTimer.kind === "duration") {
        const remaining = Math.max(0, Math.round((sleepTimer.endsAt - Date.now()) / 1000));
        setSleepRemainingSec(remaining);
        if (remaining <= 0) {
          audioRef.current?.pause();
          setSleepTimerState(null);
        }
      } else {
        const ch = chapters[sleepTimer.chapterIndex];
        const end = ch?.endTime ?? stateRef.current.duration;
        const remaining = Math.max(0, Math.round(end - stateRef.current.currentTime));
        setSleepRemainingSec(remaining);
        if (stateRef.current.currentTime >= end - 0.25) {
          audioRef.current?.pause();
          setSleepTimerState(null);
        }
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sleepTimer, chapters]);

  // ---- media session -----------------------------------------------------------

  useEffect(() => {
    if (!("mediaSession" in navigator) || !track) return;
    const chapterTitle = chapters[currentChapterIndex]?.title;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: chapterTitle && chapters.length > 1 ? chapterTitle : track.title,
      artist: track.authors.join(", "),
      album: track.title,
      artwork: track.coverUrl ? [{ src: track.coverUrl, sizes: "512x512" }] : [],
    });
  }, [track, chapters, currentChapterIndex]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = track ? (isPlaying ? "playing" : "paused") : "none";
  }, [isPlaying, track]);

  // Throttled position state (~1/s while playing, plus rate changes).
  useEffect(() => {
    if (!("mediaSession" in navigator) || !track || duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate,
        position: Math.min(currentTime, duration),
      });
    } catch {
      /* some browsers reject transiently-inconsistent states */
    }
    // currentTime updates ~4Hz; gate on the rounded second to throttle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.floor(currentTime), duration, playbackRate, track]);

  // ---- controls -----------------------------------------------------------

  const play = useCallback(() => {
    audioRef.current?.play().catch(() => {
      /* autoplay policy — requires a user gesture; UI state stays paused */
    });
  }, []);
  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);
  const toggle = useCallback(() => {
    if (stateRef.current.isPlaying) audioRef.current?.pause();
    else play();
  }, [play]);

  const seekTo = useCallback((sec: number) => {
    const el = audioRef.current;
    if (!el) return;
    const dur = stateRef.current.duration;
    const clamped = Math.max(0, dur > 0 ? Math.min(sec, dur - 0.1) : sec);
    if (el.readyState >= 1) {
      el.currentTime = clamped;
      setCurrentTime(clamped);
    } else {
      pendingSeekRef.current = clamped;
    }
  }, []);

  const skipBy = useCallback((sec: number) => seekTo(stateRef.current.currentTime + sec), [seekTo]);

  const goToChapter = useCallback(
    (index: number) => {
      const ch = chapters[Math.max(0, Math.min(index, chapters.length - 1))];
      if (ch) seekTo(ch.startTime);
    },
    [chapters, seekTo],
  );

  const setRate = useCallback((r: number) => {
    const clamped = clampRate(r);
    setPlaybackRateState(clamped);
    writeAudioSettings({ audioPlaybackSpeed: clamped });
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    writeAudioSettings({ audioVolume: clamped });
  }, []);

  const setSleepTimer = useCallback(
    (t: { minutes: number } | { endOfChapter: true }) => {
      if ("endOfChapter" in t) {
        setSleepTimerState({ kind: "end-of-chapter", chapterIndex: currentChapterIndex });
      } else {
        setSleepTimerState({ kind: "duration", endsAt: Date.now() + t.minutes * 60_000 });
      }
    },
    [currentChapterIndex],
  );
  const extendSleepTimer = useCallback((minutes: number) => {
    setSleepTimerState((prev) =>
      prev?.kind === "duration"
        ? { kind: "duration", endsAt: Math.max(prev.endsAt, Date.now()) + minutes * 60_000 }
        : prev,
    );
  }, []);
  const cancelSleepTimer = useCallback(() => setSleepTimerState(null), []);

  const load = useCallback(
    (next: AudiobookTrack, opts?: { startAt?: number; forceSeek?: boolean }) => {
      const el = audioRef.current;
      if (!el) return;
      const current = stateRef.current.track;
      if (current?.bookId === next.bookId) {
        // Adopt: the provider is the source of truth for a book already loaded.
        // Deep links (forceSeek) still jump.
        if (opts?.forceSeek && opts.startAt !== undefined) seekTo(opts.startAt);
        return;
      }
      // Swapping books: bank the outgoing position + session first.
      if (current) {
        savePosition("src-swap");
        endSession();
      }
      setTrack(next);
      setCurrentTime(opts?.startAt ?? 0);
      setElementDuration(0);
      setSleepTimerState(null);
      pendingSeekRef.current = opts?.startAt ?? null;
      el.src = next.audioUrl;
      el.load(); // no autoplay — playback starts from a user gesture
    },
    [savePosition, endSession, seekTo],
  );

  const stop = useCallback(() => {
    const el = audioRef.current;
    savePosition("stop");
    endSession();
    if (el) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
    setTrack(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setElementDuration(0);
    setSleepTimerState(null);
  }, [savePosition, endSession]);

  // ---- element event handlers -----------------------------------------------

  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    const t = stateRef.current.track;
    if (t && !sessionIdRef.current) {
      createReadingSession(t.bookId, String(Math.floor(stateRef.current.currentTime)))
        .then((id) => {
          sessionIdRef.current = id;
        })
        .catch(() => {});
    }
  }, []);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    savePosition("pause");
  }, [savePosition]);

  const handleLoadedMetadata = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (isFinite(el.duration)) setElementDuration(el.duration);
    if (pendingSeekRef.current !== null) {
      el.currentTime = pendingSeekRef.current;
      setCurrentTime(pendingSeekRef.current);
      pendingSeekRef.current = null;
    }
  }, []);

  const value = useMemo<AudiobookContextValue>(
    () => ({
      track,
      chapters,
      isPlaying,
      currentTime,
      duration,
      playbackRate,
      volume,
      sleepTimer,
      sleepRemainingSec,
      currentChapterIndex,
      load,
      play,
      pause,
      toggle,
      seekTo,
      skipBy,
      goToChapter,
      setRate,
      setVolume,
      setSleepTimer,
      extendSleepTimer,
      cancelSleepTimer,
      stop,
    }),
    [
      track,
      chapters,
      isPlaying,
      currentTime,
      duration,
      playbackRate,
      volume,
      sleepTimer,
      sleepRemainingSec,
      currentChapterIndex,
      load,
      play,
      pause,
      toggle,
      seekTo,
      skipBy,
      goToChapter,
      setRate,
      setVolume,
      setSleepTimer,
      extendSleepTimer,
      cancelSleepTimer,
      stop,
    ],
  );

  // Media Session remote commands (after `value` so handlers close over stable fns).
  useEffect(() => {
    if (!("mediaSession" in navigator) || !track) return;
    const ms = navigator.mediaSession;
    const skipBack = () => skipBy(-15);
    const skipFwd = () => skipBy(30);
    try {
      ms.setActionHandler("play", play);
      ms.setActionHandler("pause", pause);
      ms.setActionHandler("seekbackward", skipBack);
      ms.setActionHandler("seekforward", skipFwd);
      ms.setActionHandler("seekto", (d) => {
        if (d.seekTime !== undefined && d.seekTime !== null) seekTo(d.seekTime);
      });
      ms.setActionHandler("stop", stop);
      ms.setActionHandler("previoustrack", () => {
        // Restart chapter, or previous chapter when near its start (music-app idiom).
        const idx = chapterIndexAt(chapters, stateRef.current.currentTime);
        const ch = chapters[idx];
        if (ch && stateRef.current.currentTime - ch.startTime > 3) seekTo(ch.startTime);
        else goToChapter(idx - 1);
      });
      ms.setActionHandler("nexttrack", () =>
        goToChapter(chapterIndexAt(chapters, stateRef.current.currentTime) + 1),
      );
    } catch {
      /* unsupported handlers on some browsers */
    }
    return () => {
      for (const action of [
        "play",
        "pause",
        "seekbackward",
        "seekforward",
        "seekto",
        "stop",
        "previoustrack",
        "nexttrack",
      ] as MediaSessionAction[]) {
        try {
          ms.setActionHandler(action, null);
        } catch {
          /* ignore */
        }
      }
    };
  }, [track, chapters, play, pause, seekTo, skipBy, goToChapter, stop]);

  return (
    <AudiobookContext.Provider value={value}>
      {/* The one audio element for the whole app — provider-owned, hidden. */}
      <audio
        ref={audioRef}
        hidden
        preload="metadata"
        onPlay={handlePlay}
        onPause={handlePause}
        onTimeUpdate={() => {
          const el = audioRef.current;
          if (el) setCurrentTime(el.currentTime);
        }}
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={() => {
          const el = audioRef.current;
          if (el && isFinite(el.duration)) setElementDuration(el.duration);
        }}
        onEnded={() => savePosition("ended")}
      />
      {children}
    </AudiobookContext.Provider>
  );
}
