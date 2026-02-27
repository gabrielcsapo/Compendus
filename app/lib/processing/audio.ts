import * as mm from "music-metadata";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, extname } from "path";
import type { BookMetadata, AudioChapter } from "../types";

export interface AudioMetadata extends BookMetadata {
  duration?: number;
  narrator?: string;
  chapters?: AudioChapter[];
}

export async function extractAudioMetadata(buffer: Buffer): Promise<AudioMetadata> {
  try {
    const metadata = await mm.parseBuffer(buffer);

    // Extract chapters from metadata if available (M4B files have these)
    const chapters = extractChapters(metadata);

    // Extract language - can be string or array
    const language = metadata.common.language;
    const languageStr = Array.isArray(language) ? language[0] : language;

    // Extract description from comment
    const comment = metadata.common.comment?.[0];
    const descriptionStr = typeof comment === "string" ? comment : comment?.text;

    // Extract narrator - often stored in composer or albumartist
    const composer = metadata.common.composer;
    const narratorStr = Array.isArray(composer)
      ? composer[0]
      : composer || metadata.common.albumartist;

    // Extract publisher - label can be an array
    const label = metadata.common.label;
    const publisherStr = Array.isArray(label) ? label[0] : label;

    return {
      title: metadata.common.title || null,
      authors: metadata.common.artist ? [metadata.common.artist] : [],
      publisher: publisherStr || null,
      description: descriptionStr || null,
      language: languageStr || null,
      duration: metadata.format.duration ? Math.round(metadata.format.duration) : undefined,
      narrator: narratorStr || undefined,
      chapters: chapters.length > 0 ? chapters : undefined,
    };
  } catch (error) {
    // music-metadata may fail on some files - return empty metadata
    console.warn("[Audio] Failed to extract metadata:", error);
    return {
      title: null,
      authors: [],
    };
  }
}

function extractChapters(metadata: mm.IAudioMetadata): AudioChapter[] {
  const chapters: AudioChapter[] = [];

  // Check for chapters in the native metadata (common in M4B files)
  if (metadata.native) {
    // Look for iTunes-style chapters or other chapter formats
    for (const format of Object.values(metadata.native)) {
      for (const tag of format) {
        // M4B files store chapters in the 'chpl' atom
        if (tag.id === "chpl" && Array.isArray(tag.value)) {
          const chapterList = tag.value as Array<{
            title?: string;
            sampleOffset?: number;
            startTimeMs?: number;
          }>;

          for (let i = 0; i < chapterList.length; i++) {
            const chapter = chapterList[i];
            const nextChapter = chapterList[i + 1];

            const startTime = chapter.startTimeMs ? chapter.startTimeMs / 1000 : 0;
            const endTime = nextChapter?.startTimeMs
              ? nextChapter.startTimeMs / 1000
              : metadata.format.duration || startTime;

            chapters.push({
              index: i,
              title: chapter.title || `Chapter ${i + 1}`,
              startTime,
              endTime,
            });
          }
        }
      }
    }
  }

  // If no chapters found in native tags, check if there's a chapter marker format
  // Some audiobooks use ID3v2 CHAP frames
  if (chapters.length === 0 && metadata.native?.["ID3v2.4"]) {
    const id3Tags = metadata.native["ID3v2.4"];
    const chapTags = id3Tags.filter((tag) => tag.id === "CHAP");

    for (let i = 0; i < chapTags.length; i++) {
      const chap = chapTags[i].value as {
        elementID?: string;
        startTime?: number;
        endTime?: number;
        tags?: { TIT2?: string };
      };

      if (chap) {
        chapters.push({
          index: i,
          title: chap.tags?.TIT2 || chap.elementID || `Chapter ${i + 1}`,
          startTime: (chap.startTime || 0) / 1000,
          endTime: (chap.endTime || metadata.format.duration || 0) / 1000,
        });
      }
    }
  }

  return chapters;
}

export async function extractAudioCover(buffer: Buffer): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const metadata = await mm.parseBuffer(buffer);
    const picture = metadata.common.picture?.[0];

    if (!picture) return null;

    return {
      buffer: Buffer.from(picture.data),
      mimeType: picture.format,
    };
  } catch (error) {
    // music-metadata may fail on some files - return null
    console.warn("[Audio] Failed to extract cover:", error);
    return null;
  }
}

export async function extractAudioContent(): Promise<{
  fullText: string;
  chapters: Array<{ index: number; title: string; content: string }>;
  toc: Array<{ title: string; href: string; index: number }>;
}> {
  // Audio files don't have text content to extract
  return { fullText: "", chapters: [], toc: [] };
}

// Multi-file audiobook merging

export interface AudioFileInput {
  buffer: Buffer;
  fileName: string;
  trackNumber: number;
}

interface MergeResult {
  success: boolean;
  duration?: number;
  chapters?: AudioChapter[];
  outputBuffer?: Buffer;
  error?: string;
}

interface MergeOptions {
  onProgress?: (progress: number, currentTime: number, totalDuration: number) => void;
}

const execAsync = promisify(exec);

/**
 * Parse ffmpeg stderr output to extract current time
 * ffmpeg outputs lines like: "size=   1234kB time=00:01:23.45 bitrate= 123.4kbits/s speed=1.23x"
 */
function parseFFmpegTime(line: string): number | null {
  const match = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (match) {
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = parseFloat(match[3]);
    return hours * 3600 + minutes * 60 + seconds;
  }
  return null;
}

/**
 * Check if ffmpeg is available on the system
 */
export async function isFFmpegAvailable(): Promise<boolean> {
  try {
    await execAsync("ffmpeg -version");
    return true;
  } catch {
    return false;
  }
}

/**
 * Get duration of an audio file using ffprobe
 */
async function getAudioDurationFromFile(filePath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`,
    );
    return parseFloat(stdout.trim()) || 0;
  } catch {
    // Fallback to music-metadata if ffprobe fails
    const buffer = readFileSync(filePath);
    const metadata = await mm.parseBuffer(buffer);
    return metadata.format.duration || 0;
  }
}

/**
 * Merge multiple audio files into a single M4B file with chapters
 */
export async function mergeAudioFiles(
  files: AudioFileInput[],
  outputPath: string,
  options: MergeOptions = {},
): Promise<MergeResult> {
  // Check ffmpeg availability
  if (!(await isFFmpegAvailable())) {
    return {
      success: false,
      error: "ffmpeg is not installed. Please install ffmpeg to merge multi-file audiobooks.",
    };
  }

  // Sort by track number
  const sorted = [...files].sort((a, b) => a.trackNumber - b.trackNumber);

  // Create temp directory for input files
  const tempDir = mkdtempSync(join(tmpdir(), "compendus-merge-"));

  try {
    const inputPaths: string[] = [];

    // Write files to temp directory with consistent extension
    for (let i = 0; i < sorted.length; i++) {
      const ext = extname(sorted[i].fileName).toLowerCase() || ".mp3";
      const path = join(tempDir, `${String(i).padStart(3, "0")}${ext}`);
      writeFileSync(path, sorted[i].buffer);
      inputPaths.push(path);
    }

    // Get durations for each file
    const durations: number[] = [];
    for (const path of inputPaths) {
      const duration = await getAudioDurationFromFile(path);
      durations.push(duration);
    }

    // Build chapters from file boundaries
    let offset = 0;
    const chapters: AudioChapter[] = sorted.map((file, i) => {
      const chapter = {
        index: i,
        title: deriveChapterTitle(file.fileName, i + 1),
        startTime: offset,
        endTime: offset + durations[i],
      };
      offset += durations[i];
      return chapter;
    });

    const totalDuration = offset;

    // Create ffmpeg concat file
    const concatFile = join(tempDir, "concat.txt");
    const concatContent = inputPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
    writeFileSync(concatFile, concatContent);

    // Create ffmpeg metadata file for chapters
    const metadataFile = join(tempDir, "metadata.txt");
    const metadataContent = buildFFmpegChapterMetadata(chapters);
    writeFileSync(metadataFile, metadataContent);

    // Check if all files are already AAC (M4A/M4B) - if so, we can stream copy (much faster)
    const allAac = sorted.every((f) => {
      const ext = extname(f.fileName).toLowerCase();
      return ext === ".m4a" || ext === ".m4b";
    });

    // Build ffmpeg arguments
    // Stream copy is ~10-100x faster but only works if source is already AAC
    // Use -map 0:a to only process audio streams (some files have video streams for album art)
    const ffmpegArgs = [
      "-f", "concat",
      "-safe", "0",
      "-i", concatFile,
      "-i", metadataFile,
      "-map", "0:a", // Only map audio streams, ignore video (album art)
      "-map_metadata", "1",
      ...(allAac
        ? ["-c:a", "copy"] // Stream copy - very fast, preserves quality
        : ["-c:a", "aac", "-b:a", "128k"]), // Re-encode MP3 to AAC at good quality
      "-vn", // Explicitly disable video output
      "-f", "mp4",
      "-y",
      outputPath,
    ];

    console.log(`[Merge] Using ${allAac ? "stream copy (fast)" : "re-encoding"} for ${sorted.length} files`);

    // Run ffmpeg to merge using spawn for real-time progress
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", ffmpegArgs);

      let stderrBuffer = "";

      ffmpeg.stderr.on("data", (data: Buffer) => {
        const text = data.toString();
        stderrBuffer += text;

        // Parse progress from ffmpeg output
        const currentTime = parseFFmpegTime(text);
        if (currentTime !== null && options.onProgress && totalDuration > 0) {
          const progress = Math.min(100, Math.round((currentTime / totalDuration) * 100));
          options.onProgress(progress, currentTime, totalDuration);
        }
      });

      ffmpeg.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg exited with code ${code}: ${stderrBuffer.slice(-500)}`));
        }
      });

      ffmpeg.on("error", (err) => {
        reject(err);
      });
    });

    // Read the output file
    const outputBuffer = readFileSync(outputPath);

    return {
      success: true,
      duration: Math.round(totalDuration),
      chapters,
      outputBuffer,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to merge audio files",
    };
  } finally {
    // Cleanup temp directory
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Build ffmpeg metadata file content with chapter markers
 */
function buildFFmpegChapterMetadata(chapters: AudioChapter[]): string {
  let content = ";FFMETADATA1\n";
  for (const ch of chapters) {
    content += "\n[CHAPTER]\n";
    content += "TIMEBASE=1/1000\n";
    content += `START=${Math.round(ch.startTime * 1000)}\n`;
    content += `END=${Math.round(ch.endTime * 1000)}\n`;
    content += `title=${ch.title.replace(/[=;#\\\n]/g, "")}\n`;
  }
  return content;
}

/**
 * Derive a chapter title from a filename
 */
function deriveChapterTitle(fileName: string, index: number): string {
  // Remove extension
  let title = fileName.replace(/\.(mp3|m4a|m4b|aac|ogg|flac)$/i, "");

  // Remove common prefixes like "01 - ", "Track 01", etc.
  title = title
    .replace(/^\d+\s*[-._]\s*/, "") // "01 - Chapter" -> "Chapter"
    .replace(/^Track\s*\d+\s*[-._]?\s*/i, "") // "Track 01 - X" -> "X"
    .replace(/^Part\s*\d+\s*[-._]?\s*/i, "") // "Part 1 - X" -> "X"
    .replace(/^Chapter\s*\d+\s*[-._]?\s*/i, "") // "Chapter 01 - X" -> "X"
    .trim();

  return title || `Part ${index}`;
}

/**
 * Sort audio files by track number extracted from filename
 */
export function sortAudioFilesByTrack<T extends { fileName: string }>(files: T[]): T[] {
  return [...files].sort((a, b) => {
    const trackA = extractTrackNumber(a.fileName);
    const trackB = extractTrackNumber(b.fileName);
    if (trackA !== null && trackB !== null) {
      return trackA - trackB;
    }
    // Fall back to natural string sort
    return a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: "base" });
  });
}

/**
 * Extract track number from filename
 */
function extractTrackNumber(fileName: string): number | null {
  const patterns = [
    /^(\d+)\s*[-._]/, // "01 - Chapter.mp3"
    /^Track\s*(\d+)/i, // "Track 01.mp3"
    /^Part\s*(\d+)/i, // "Part 1.mp3"
    /^Chapter\s*(\d+)/i, // "Chapter 01.mp3"
    /\((\d+)\)/, // "Chapter (1).mp3"
    /\[(\d+)\]/, // "Chapter [1].mp3"
  ];
  for (const pattern of patterns) {
    const match = fileName.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return null;
}
