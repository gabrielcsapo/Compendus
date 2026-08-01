/**
 * Audio position serialization — the iOS-compatible `lastPosition` shape.
 *
 * iOS saves audiobook positions as JSON {"type":"audio","timestamp":<sec>,
 * "progress":<0-1>} (AudiobookPlayerService.saveProgress); web writes the same
 * shape through saveReadingProgress so the per-device rows + furthest-progress
 * roll-up give exact cross-device resume in both directions.
 */

export interface AudioPosition {
  type: "audio";
  /** Absolute position in seconds. */
  timestamp: number;
  /** Whole-book fraction 0-1. */
  progress: number;
}

export function serializeAudioPosition(timestamp: number, duration: number): string {
  const t = Math.max(0, timestamp);
  const progress = duration > 0 ? Math.min(1, Math.max(0, t / duration)) : 0;
  return JSON.stringify({
    type: "audio",
    timestamp: Math.round(t * 1000) / 1000,
    progress: Math.round(progress * 100000) / 100000,
  } satisfies AudioPosition);
}

/** Tolerant parse: returns null for anything that isn't the audio shape. */
export function parseAudioPosition(lastPosition: string | null | undefined): AudioPosition | null {
  if (!lastPosition) return null;
  try {
    const v = JSON.parse(lastPosition) as Partial<AudioPosition> | null;
    if (v && v.type === "audio" && typeof v.timestamp === "number" && v.timestamp >= 0) {
      return {
        type: "audio",
        timestamp: v.timestamp,
        progress: typeof v.progress === "number" ? Math.min(1, Math.max(0, v.progress)) : 0,
      };
    }
  } catch {
    /* legacy / non-JSON positions */
  }
  return null;
}
