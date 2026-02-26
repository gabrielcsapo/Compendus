import { spawn, execSync } from "child_process";
import { resolve, dirname } from "path";
import { existsSync, mkdirSync } from "fs";
import { readFile, writeFile, unlink, readdir } from "fs/promises";

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words: TranscriptWord[];
}

export interface Transcript {
  duration: number;
  language: string;
  segments: TranscriptSegment[];
}

interface TranscribeOptions {
  onProgress?: (progress: number, message: string) => void;
  onLog?: (line: string) => void;
}

/** whisper.cpp full JSON output format */
interface WhisperCppOutput {
  result: { language: string };
  transcription: Array<{
    offsets: { from: number; to: number };
    text: string;
    tokens: Array<{
      text: string;
      offsets: { from: number; to: number };
      p: number;
    }>;
  }>;
}

/**
 * Check if whisper-cli (whisper.cpp) is available on PATH
 */
export async function isWhisperAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("whisper-cli", ["--help"]);
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

/**
 * Get audio duration in seconds using ffprobe
 */
async function getAudioDuration(audioPath: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v", "quiet",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
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
 * Resolve the path where a GGML model should be stored
 */
function resolveModelPath(model: string): string {
  const modelsDir = resolve(process.cwd(), "data", "models");
  return resolve(modelsDir, `ggml-${model}.bin`);
}

/**
 * Download a whisper.cpp GGML model from HuggingFace if not present
 */
async function ensureModelDownloaded(
  model: string,
  modelPath: string,
  onProgress?: (progress: number, message: string) => void,
): Promise<void> {
  if (existsSync(modelPath)) return;

  const modelsDir = resolve(process.cwd(), "data", "models");
  mkdirSync(modelsDir, { recursive: true });

  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`;

  onProgress?.(1, `Downloading model ${model}...`);

  try {
    execSync(`curl -L -o "${modelPath}" "${url}"`, {
      stdio: "pipe",
      timeout: 600000, // 10 minutes
    });
  } catch (err) {
    // Clean up partial download
    if (existsSync(modelPath)) {
      try { execSync(`rm "${modelPath}"`); } catch {}
    }
    throw new Error(
      `Failed to download whisper model '${model}'. ` +
      `Download manually from ${url} and place at ${modelPath}`,
    );
  }

  if (!existsSync(modelPath)) {
    throw new Error(`Model download completed but file not found at ${modelPath}`);
  }

  onProgress?.(4, "Model downloaded");
}

/**
 * Round a number to 3 decimal places
 */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Transform whisper.cpp full JSON output to our Transcript format
 */
function transformWhisperOutput(raw: WhisperCppOutput, duration: number): Transcript {
  const segments = raw.transcription.map((seg) => {
    const words = seg.tokens
      .filter((t) => t.text.trim().length > 0)
      .filter((t) => !t.text.startsWith("["))
      .map((t) => ({
        word: t.text.trim(),
        start: round3(t.offsets.from / 1000),
        end: round3(t.offsets.to / 1000),
      }));

    return {
      start: round3(seg.offsets.from / 1000),
      end: round3(seg.offsets.to / 1000),
      text: seg.text.trim(),
      words,
    };
  });

  // Use ffprobe duration, fall back to last segment end
  const finalDuration = duration > 0
    ? round3(duration)
    : segments.length > 0
      ? segments[segments.length - 1].end
      : 0;

  return {
    duration: finalDuration,
    language: raw.result.language,
    segments,
  };
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
        "-y", "-i", audioPath,
        "-ss", String(startOffset),
        "-t", String(CHUNK_SECONDS),
        "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
        chunkPath,
      ];
      const ff = spawn("ffmpeg", args, { stdio: "pipe" });
      let stderr = "";
      ff.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
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

/** Timeout per chunk: 30 minutes of audio should not take more than 2 hours */
const CHUNK_TIMEOUT_MS = 2 * 60 * 60 * 1000;

/**
 * Run whisper-cli on a single WAV chunk and return parsed segments.
 */
async function transcribeChunk(
  chunkPath: string,
  modelPath: string,
  threads: number,
  onLog?: (line: string) => void,
): Promise<WhisperCppOutput> {
  const tempOutputBase = chunkPath.replace(/\.wav$/, ".whisper");

  const args = [
    "-m", modelPath,
    "-f", chunkPath,
    "-ojf",
    "-of", tempOutputBase,
    "-pp",
    "--max-len", "1",
    "-t", String(threads),
    "-bs", "1",
    "--best-of", "1",
  ];

  onLog?.(`[whisper-cli] ${args.join(" ")}`);

  await new Promise<void>((resolvePromise, reject) => {
    let settled = false;
    let stderrBuffer = "";
    let stderrLineBuffer = "";
    let spawnError: Error | null = null;
    let lastOutputTime = Date.now();

    const proc = spawn("whisper-cli", args, {
      env: { ...process.env },
    });

    // Timeout check — kill the process if no output for too long
    const timeoutCheck = setInterval(() => {
      const elapsed = Date.now() - lastOutputTime;
      if (elapsed > CHUNK_TIMEOUT_MS) {
        clearInterval(timeoutCheck);
        onLog?.(`[timeout] No output for ${Math.round(elapsed / 60000)}min, killing process`);
        proc.kill("SIGKILL");
      }
    }, 30000);

    proc.stderr.on("data", (data: Buffer) => {
      const text = data.toString();
      stderrBuffer += text;
      lastOutputTime = Date.now();

      // Stream stderr line-by-line to the log callback
      stderrLineBuffer += text;
      const lines = stderrLineBuffer.split("\n");
      stderrLineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) onLog?.(line);
      }
    });

    proc.stdout.on("data", (data: Buffer) => {
      lastOutputTime = Date.now();
      const text = data.toString();
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.trim()) onLog?.(`[stdout] ${line}`);
      }
    });

    proc.on("error", (err) => {
      spawnError = err;
    });

    proc.on("close", (code) => {
      clearInterval(timeoutCheck);
      // Flush remaining stderr
      if (stderrLineBuffer.trim()) onLog?.(stderrLineBuffer);

      if (settled) return;
      settled = true;

      onLog?.(`[whisper-cli] exited with code ${code}`);

      if (code === 0) {
        resolvePromise();
        return;
      }

      if (spawnError) {
        reject(new Error(`Failed to start whisper-cli: ${spawnError.message}. Is whisper.cpp installed?`));
        return;
      }

      const errorLines = stderrBuffer
        .split("\n")
        .filter((l) => l.trim())
        .slice(-5)
        .join("\n")
        .slice(-500);

      if (errorLines) {
        reject(new Error(`Transcription failed (exit code ${code}): ${errorLines}`));
      } else if (code === null) {
        reject(new Error("Transcription process was killed (out of memory or signal). Check server resources."));
      } else {
        reject(new Error(`Transcription failed with exit code ${code}.`));
      }
    });
  });

  const whisperJsonPath = `${tempOutputBase}.json`;
  try {
    const rawJson = await readFile(whisperJsonPath, "utf-8");
    return JSON.parse(rawJson) as WhisperCppOutput;
  } finally {
    try { await unlink(whisperJsonPath); } catch {}
  }
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
 * Transcribe an audio file using whisper.cpp.
 * Splits long audio into 30-minute chunks to avoid OOM, then merges results.
 */
export async function transcribeAudio(
  audioPath: string,
  outputPath: string,
  options: TranscribeOptions = {},
): Promise<void> {
  const model = process.env.WHISPER_MODEL || "small";
  const modelPath = resolveModelPath(model);

  // Download model if needed
  await ensureModelDownloaded(model, modelPath, options.onProgress);

  // Get audio duration via ffprobe
  options.onProgress?.(5, "Analyzing audio...");
  const duration = await getAudioDuration(audioPath);

  const threads = Math.max(2, (process.env.WHISPER_THREADS ? parseInt(process.env.WHISPER_THREADS) : 0) || 4);

  // Create temp directory for chunks
  const tempDir = resolve(dirname(outputPath), `.transcribe_tmp_${Date.now()}`);

  try {
    // Split audio into 30-minute WAV chunks
    const totalChunks = Math.max(1, Math.ceil(duration / CHUNK_SECONDS));
    console.log(`[Transcribe] Duration: ${round3(duration)}s, splitting into ${totalChunks} chunks of ${CHUNK_SECONDS}s`);

    const chunks = await splitAudioToChunks(audioPath, tempDir, duration, options.onProgress);

    // Transcribe each chunk sequentially
    const allSegments: TranscriptSegment[] = [];
    let language = "en";

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkPct = Math.round((i / chunks.length) * 85) + 8; // 8-93% range
      options.onProgress?.(chunkPct, `Transcribing chunk ${i + 1}/${chunks.length}...`);

      console.log(`[Transcribe] Processing chunk ${i + 1}/${chunks.length} (offset: ${chunk.startOffset}s)`);
      options.onLog?.(`--- Chunk ${i + 1}/${chunks.length} (offset: ${chunk.startOffset}s) ---`);
      const whisperOutput = await transcribeChunk(chunk.path, modelPath, threads, options.onLog);

      if (i === 0 && whisperOutput.result?.language) {
        language = whisperOutput.result.language;
      }

      // Transform and offset timestamps for this chunk
      for (const seg of whisperOutput.transcription) {
        const words = seg.tokens
          .filter((t) => t.text.trim().length > 0)
          .filter((t) => !t.text.startsWith("["))
          .map((t) => ({
            word: t.text.trim(),
            start: round3(t.offsets.from / 1000 + chunk.startOffset),
            end: round3(t.offsets.to / 1000 + chunk.startOffset),
          }));

        allSegments.push({
          start: round3(seg.offsets.from / 1000 + chunk.startOffset),
          end: round3(seg.offsets.to / 1000 + chunk.startOffset),
          text: seg.text.trim(),
          words,
        });
      }

      // Delete chunk WAV immediately after transcription to free disk space
      try { await unlink(chunk.path); } catch {}
    }

    // Build final transcript
    options.onProgress?.(97, "Processing transcript...");

    const finalDuration = duration > 0
      ? round3(duration)
      : allSegments.length > 0
        ? allSegments[allSegments.length - 1].end
        : 0;

    const transcript: Transcript = {
      duration: finalDuration,
      language,
      segments: allSegments,
    };

    console.log(`[Transcribe] Complete: ${transcript.segments.length} segments, duration: ${transcript.duration}s`);
    await writeFile(outputPath, JSON.stringify(transcript), "utf-8");
  } finally {
    await cleanupTempDir(tempDir);
  }

  options.onProgress?.(100, "Transcription complete");
}
