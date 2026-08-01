/**
 * Lemonade audio endpoints — server-side ASR (Whisper) + TTS (Kokoro).
 *
 * The Beelink's Lemonade daemon serves OpenAI-compatible audio routes next to
 * the LLM ones (same host/port as LLM_URL/OLLAMA_URL):
 *   POST /api/v1/audio/transcriptions  — whispercpp / whisper-FLM (NPU) ASR
 *   POST /api/v1/audio/speech          — kokoro-v1 TTS
 *
 * Lemonade is THE audio backend — the container ships no speech models of its
 * own (the old in-container whisper-cli and in-process kokoro-js are gone).
 * Self-hosters stand up Lemonade and pull the models (client CLI or
 * POST /api/v1/pull {"model_name": ...}):
 *   Whisper-Large-v3-Turbo   (whispercpp — segment timestamps, our default)
 *   kokoro-v1                (TTS; serves IEEE-float WAV)
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const LLM_URL = (process.env.LLM_URL || process.env.OLLAMA_URL || "http://localhost:11434").replace(
  /\/+$/,
  "",
);

// whispercpp-recipe models return segment timestamps (read-along needs them);
// the FLM/NPU whisper is text-only — fine for plain transcription, not for us.
export const LEMONADE_ASR_MODEL = process.env.LEMONADE_ASR_MODEL || "Whisper-Large-v3-Turbo";
export const LEMONADE_TTS_MODEL = process.env.LEMONADE_TTS_MODEL || "kokoro-v1";

/**
 * Preflight for transcription jobs: the backend answers and has the ASR model
 * downloaded. Used instead of the old "is whisper-cli on PATH" check.
 */
export async function isTranscriptionAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${LLM_URL}/api/v1/models`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      data?: Array<{ id?: string; downloaded?: boolean }>;
    };
    return (data.data ?? []).some((m) => m.id === LEMONADE_ASR_MODEL && m.downloaded !== false);
  } catch {
    return false;
  }
}

export interface AsrWord {
  word: string;
  start: number;
  end: number;
}
export interface AsrSegment {
  start: number;
  end: number;
  text: string;
  words: AsrWord[];
}
export interface AsrResult {
  language: string;
  segments: AsrSegment[];
}

interface VerboseJson {
  language?: string;
  text?: string;
  segments?: Array<{ start?: number; end?: number; text?: string }>;
  words?: Array<{ word?: string; start?: number; end?: number }>;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Transcribe one audio file (a ≤30-min WAV chunk from the existing splitter).
 * Requests verbose_json with word granularity; when the backend returns no
 * word timings, words are interpolated linearly within each segment so
 * read-along keeps functioning (approximate, but monotonic and in-range).
 */
export async function lemonadeTranscribe(
  wavPath: string,
  opts?: { model?: string },
): Promise<AsrResult> {
  const model = opts?.model || LEMONADE_ASR_MODEL;
  const bytes = await readFile(wavPath);
  const form = new FormData();
  form.append("model", model);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");
  form.append("file", new Blob([bytes], { type: "audio/wav" }), basename(wavPath));

  let res: Response;
  try {
    res = await fetch(`${LLM_URL}/api/v1/audio/transcriptions`, { method: "POST", body: form });
  } catch (e) {
    throw new Error(`Lemonade ASR unreachable at ${LLM_URL} (${(e as Error).message})`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Lemonade ASR returned ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as VerboseJson;

  const rawSegments = Array.isArray(data.segments) ? data.segments : [];
  // Fallback shape: some builds return only {text} — one segment, no timings,
  // which the caller treats as a failed chunk (better than silent nonsense).
  if (rawSegments.length === 0) {
    throw new Error("Lemonade ASR returned no timestamped segments (plain-text response?)");
  }

  const allWords = Array.isArray(data.words) ? data.words : [];
  const segments: AsrSegment[] = rawSegments.map((s) => {
    const start = round3(Number(s.start ?? 0));
    const end = round3(Number(s.end ?? start));
    const text = String(s.text ?? "").trim();
    let words: AsrWord[] = allWords
      .filter((w) => Number(w.start ?? -1) >= start && Number(w.end ?? -1) <= end + 0.01)
      .map((w) => ({
        word: String(w.word ?? "").trim(),
        start: round3(Number(w.start ?? start)),
        end: round3(Number(w.end ?? end)),
      }))
      .filter((w) => w.word.length > 0);
    if (words.length === 0 && text) {
      // Interpolate: spread the segment's words evenly across its duration.
      const parts = text.split(/\s+/).filter(Boolean);
      const span = Math.max(0.01, end - start);
      words = parts.map((word, i) => ({
        word,
        start: round3(start + (i / parts.length) * span),
        end: round3(start + ((i + 1) / parts.length) * span),
      }));
    }
    return { start, end, text, words };
  });

  return { language: String(data.language ?? "en"), segments };
}

/**
 * Render text to speech via Lemonade's Kokoro. Returns the raw audio bytes as
 * served (request WAV; callers validate the RIFF header before trusting it).
 */
export async function lemonadeSpeech(
  text: string,
  opts?: { voice?: string; model?: string },
): Promise<Buffer> {
  const model = opts?.model || LEMONADE_TTS_MODEL;
  let res: Response;
  try {
    res = await fetch(`${LLM_URL}/api/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: text,
        voice: opts?.voice || "af_heart",
        response_format: "wav",
      }),
    });
  } catch (e) {
    throw new Error(`Lemonade TTS unreachable at ${LLM_URL} (${(e as Error).message})`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Lemonade TTS returned ${res.status}: ${body.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Decode a PCM16 WAV into Float32 samples at the requested rate (naive linear
 * resample when the source rate differs — Kokoro serves 24kHz, so usually a
 * straight copy). Throws on anything that isn't mono/stereo PCM16 RIFF.
 */
export function decodeWavToFloat32(wav: Buffer, targetRate: number): Float32Array {
  if (
    wav.length < 44 ||
    wav.toString("ascii", 0, 4) !== "RIFF" ||
    wav.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("Lemonade TTS did not return a RIFF/WAVE payload");
  }
  // Walk chunks for fmt + data (headers aren't always exactly 44 bytes).
  let pos = 12;
  let sampleRate = 0;
  let channels = 1;
  let bitsPerSample = 16;
  let format = 1;
  let dataStart = -1;
  let dataLen = 0;
  while (pos + 8 <= wav.length) {
    const id = wav.toString("ascii", pos, pos + 4);
    const size = wav.readUInt32LE(pos + 4);
    if (id === "fmt ") {
      format = wav.readUInt16LE(pos + 8);
      channels = wav.readUInt16LE(pos + 10);
      sampleRate = wav.readUInt32LE(pos + 12);
      bitsPerSample = wav.readUInt16LE(pos + 22);
      const pcm16 = format === 1 && bitsPerSample === 16;
      const float32 = format === 3 && bitsPerSample === 32; // kokoro-v1 serves this
      if (!pcm16 && !float32) {
        throw new Error(`unsupported WAV encoding (format ${format}, ${bitsPerSample}-bit)`);
      }
    } else if (id === "data") {
      dataStart = pos + 8;
      dataLen = Math.min(size, wav.length - dataStart);
    }
    pos += 8 + size + (size % 2);
  }
  if (dataStart < 0 || !sampleRate) throw new Error("WAV missing fmt/data chunks");

  const bytesPerSample = bitsPerSample / 8;
  const frames = Math.floor(dataLen / bytesPerSample / channels);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) {
      const off = dataStart + (i * channels + c) * bytesPerSample;
      acc += format === 3 ? wav.readFloatLE(off) : wav.readInt16LE(off) / 0x8000;
    }
    mono[i] = acc / channels;
  }
  if (sampleRate === targetRate) return mono;

  const outLen = Math.floor((frames * targetRate) / sampleRate);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = (i * sampleRate) / targetRate;
    const lo = Math.floor(src);
    const hi = Math.min(frames - 1, lo + 1);
    out[i] = mono[lo] + (mono[hi] - mono[lo]) * (src - lo);
  }
  return out;
}
