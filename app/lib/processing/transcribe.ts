/**
 * Audiobook transcription — chunked ffmpeg preprocessing + Lemonade ASR.
 *
 * The container does no speech inference itself: audio is split into 30-minute
 * 16kHz WAV chunks (ffmpeg) and each chunk is transcribed by the host's
 * Lemonade server (Whisper on the NPU — see app/lib/llm/audio.ts). Self-hosters
 * stand up Lemonade and pull an ASR model; there is no in-container fallback.
 *
 * Output contract (unchanged from the whisper-cli era): a transcript JSON of
 * {duration, language, segments: [{start, end, text, words}]} with word-level
 * timings — the read-along and the knowledge substrate both consume it.
 */
import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { mkdirSync } from "fs";
import { writeFile, unlink, readdir } from "fs/promises";
import { lemonadeTranscribe, isTranscriptionAvailable, LEMONADE_ASR_MODEL } from "../llm/audio";

export { isTranscriptionAvailable };

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

interface TranscribeOptions {
  onProgress?: (progress: number, message: string) => void;
  onLog?: (line: string) => void;
}

/**
 * Get audio duration in seconds using ffprobe
 */
async function getAudioDuration(audioPath: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v",
      "quiet",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      audioPath,
    ]);
    let output = "";
    proc.stdout.on("data", (d: Buffer) => (output += d.toString()));
    proc.on("close", (code) => {
      if (code === 0 && output.trim()) {
        resolve(parseFloat(output.trim()));
      } else {
        resolve(0);
      }
    });
    proc.on("error", () => resolve(0));
  });
}

/**
 * Round a number to 3 decimal places
 */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Chunk duration in seconds (30 minutes) — keeps WAV under ~58MB per chunk */
const CHUNK_SECONDS = 1800;

/**
 * Split audio into WAV chunks using ffmpeg.
 * Returns array of { path, startOffset } for each chunk.
 */
async function splitAudioToChunks(
  audioPath: string,
  tempDir: string,
  duration: number,
  onProgress?: (progress: number, message: string) => void,
): Promise<Array<{ path: string; startOffset: number }>> {
  mkdirSync(tempDir, { recursive: true });

  const chunks: Array<{ path: string; startOffset: number }> = [];
  const totalChunks = Math.ceil(duration / CHUNK_SECONDS);

  for (let i = 0; i < totalChunks; i++) {
    const startOffset = i * CHUNK_SECONDS;
    const chunkPath = resolve(tempDir, `chunk_${String(i).padStart(4, "0")}.wav`);

    // Report splitting progress (6-8% range)
    const splitPct = 6 + Math.round(((i + 1) / totalChunks) * 2);
    onProgress?.(splitPct, `Splitting chunk ${i + 1}/${totalChunks}...`);

    await new Promise<void>((res, rej) => {
      const args = [
        "-y",
        "-i",
        audioPath,
        "-ss",
        String(startOffset),
        "-t",
        String(CHUNK_SECONDS),
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        chunkPath,
      ];
      const ff = spawn("ffmpeg", args, { stdio: "pipe" });
      let stderr = "";
      ff.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
      });
      ff.on("close", (code) => {
        if (code === 0) res();
        else rej(new Error(`Failed to split chunk ${i} (exit ${code}): ${stderr.slice(-300)}`));
      });
      ff.on("error", (err) => rej(new Error(`Failed to start ffmpeg: ${err.message}`)));
    });

    chunks.push({ path: chunkPath, startOffset });
  }

  return chunks;
}

/**
 * Clean up a temp directory and all files inside it
 */
async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    const files = await readdir(tempDir);
    await Promise.all(files.map((f) => unlink(resolve(tempDir, f)).catch(() => {})));
    // Remove the directory itself
    await new Promise<void>((res) => {
      const proc = spawn("rmdir", [tempDir]);
      proc.on("close", () => res());
      proc.on("error", () => res());
    });
  } catch {}
}

/**
 * Transcribe an audio file via Lemonade ASR.
 * Splits long audio into 30-minute chunks, transcribes each, merges results.
 */
export async function transcribeAudio(
  audioPath: string,
  outputPath: string,
  options: TranscribeOptions = {},
): Promise<void> {
  // Get audio duration via ffprobe
  options.onProgress?.(5, "Analyzing audio...");
  const duration = await getAudioDuration(audioPath);

  // Create temp directory for chunks
  const tempDir = resolve(dirname(outputPath), `.transcribe_tmp_${Date.now()}`);

  try {
    // Split audio into 30-minute WAV chunks
    const totalChunks = Math.max(1, Math.ceil(duration / CHUNK_SECONDS));
    console.log(
      `[Transcribe] Duration: ${round3(duration)}s, splitting into ${totalChunks} chunks of ${CHUNK_SECONDS}s`,
    );

    const chunks = await splitAudioToChunks(audioPath, tempDir, duration, options.onProgress);

    // Transcribe each chunk sequentially on the Lemonade host
    const allSegments: TranscriptSegment[] = [];
    let language = "en";

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkPct = Math.round((i / chunks.length) * 85) + 8; // 8-93% range
      options.onProgress?.(chunkPct, `Transcribing chunk ${i + 1}/${chunks.length}...`);

      console.log(
        `[Transcribe] Processing chunk ${i + 1}/${chunks.length} (offset: ${chunk.startOffset}s)`,
      );
      options.onLog?.(
        `--- Chunk ${i + 1}/${chunks.length} (offset: ${chunk.startOffset}s) → Lemonade ${LEMONADE_ASR_MODEL} ---`,
      );
      // Each chunk is ONE silent multi-minute HTTP call — heartbeat the job's
      // progress while it runs or the queue's 3-min no-progress watchdog
      // aborts a perfectly healthy transcription (the old whisper-cli only
      // survived because its streamed stderr acted as an accidental heartbeat).
      const beat = setInterval(
        () => options.onProgress?.(chunkPct, `Transcribing chunk ${i + 1}/${chunks.length}...`),
        45_000,
      );
      let asr: Awaited<ReturnType<typeof lemonadeTranscribe>>;
      try {
        asr = await lemonadeTranscribe(chunk.path);
      } finally {
        clearInterval(beat);
      }

      if (i === 0 && asr.language) language = asr.language;

      // Offset timestamps by the chunk's position in the full audio
      for (const seg of asr.segments) {
        allSegments.push({
          start: round3(seg.start + chunk.startOffset),
          end: round3(seg.end + chunk.startOffset),
          text: seg.text,
          words: seg.words.map((w) => ({
            word: w.word,
            start: round3(w.start + chunk.startOffset),
            end: round3(w.end + chunk.startOffset),
          })),
        });
      }

      // Delete chunk WAV immediately after transcription to free disk space
      try {
        await unlink(chunk.path);
      } catch {}
    }

    // Build final transcript
    options.onProgress?.(97, "Processing transcript...");

    const finalDuration =
      duration > 0
        ? round3(duration)
        : allSegments.length > 0
          ? allSegments[allSegments.length - 1].end
          : 0;

    const transcript: Transcript = {
      duration: finalDuration,
      language,
      segments: allSegments,
    };

    console.log(
      `[Transcribe] Complete: ${transcript.segments.length} segments, duration: ${transcript.duration}s`,
    );
    await writeFile(outputPath, JSON.stringify(transcript), "utf-8");
  } finally {
    await cleanupTempDir(tempDir);
  }

  options.onProgress?.(100, "Transcription complete");
}
