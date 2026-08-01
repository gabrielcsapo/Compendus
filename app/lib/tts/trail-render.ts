/**
 * Server-side trail narration — Kokoro TTS via the host's Lemonade daemon.
 *
 * Replaces the fleet's `tts-render-trail` kind (and the interim in-process
 * kokoro-js port): each trail segment renders through Lemonade's kokoro-v1
 * (app/lib/llm/audio.ts), the segments concatenate with short pauses into one
 * 24kHz mono WAV under <data>/trail-audio/<sha256>.wav, and the hash pins on
 * trails.audio_hash so /api/trails/:id/audio can stream it to every device
 * forever after (compute once, reuse everywhere).
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { rawDb } from "../db";
import { lemonadeSpeech, decodeWavToFloat32 } from "../llm/audio";

const DATA_DIR = process.env.COMPENDUS_DATA_DIR || resolve(process.cwd(), "data");
const AUDIO_DIR = resolve(DATA_DIR, "trail-audio");
const SAMPLE_RATE = 24_000;
const SEGMENT_PAUSE_SEC = 0.6;

// voiceIndex (the existing client contract) → kokoro voice id. Ordered by
// voice quality grade; index 0 is the default narrator.
export const TRAIL_VOICES = ["af_heart", "af_bella", "bf_emma", "am_michael"] as const;

export interface TrailSegment {
  passageId: string;
  text: string;
}

/** Minimal 16-bit PCM mono WAV encoder. */
function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const data = Buffer.allocUnsafe(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(s * 0x7fff), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export interface TrailRenderResult {
  audioHash: string;
  durationSec: number;
  sampleCount: number;
}

/**
 * Render a trail's segments to one narration WAV and pin its hash on the trail.
 * Serial by nature (one backend, segments in order); callers run it detached.
 */
export async function renderTrailAudio(
  trailId: string,
  segments: TrailSegment[],
  opts?: { voiceIndex?: number; onProgress?: (done: number, total: number) => void },
): Promise<TrailRenderResult> {
  if (segments.length === 0) throw new Error("trail has no narratable text");
  const voice = TRAIL_VOICES[opts?.voiceIndex ?? 0] ?? TRAIL_VOICES[0];

  const pause = new Float32Array(Math.round(SAMPLE_RATE * SEGMENT_PAUSE_SEC));
  const parts: Float32Array[] = [];
  let sampleCount = 0;
  for (let i = 0; i < segments.length; i++) {
    const wav = await lemonadeSpeech(segments[i].text, { voice });
    const audio = decodeWavToFloat32(wav, SAMPLE_RATE);
    parts.push(audio, pause);
    sampleCount += audio.length + pause.length;
    opts?.onProgress?.(i + 1, segments.length);
  }
  const all = new Float32Array(sampleCount);
  let off = 0;
  for (const p of parts) {
    all.set(p, off);
    off += p.length;
  }

  const wav = encodeWav(all, SAMPLE_RATE);
  const audioHash = createHash("sha256").update(wav).digest("hex");
  mkdirSync(AUDIO_DIR, { recursive: true });
  writeFileSync(resolve(AUDIO_DIR, `${audioHash}.wav`), wav);

  const updated = rawDb
    .prepare("UPDATE trails SET audio_hash = ? WHERE id = ?")
    .run(audioHash, trailId);
  if (updated.changes === 0) throw new Error(`trail ${trailId} not found`);

  return { audioHash, durationSec: sampleCount / SAMPLE_RATE, sampleCount };
}

/** Absolute path of a rendered narration WAV (existence is the caller's check). */
export function trailAudioPath(audioHash: string): string {
  return resolve(AUDIO_DIR, `${audioHash}.wav`);
}
