import * as mm from "music-metadata";
import type { BookMetadata, AudioChapter, CoverResult } from "../types";

export interface AudioMetadata extends BookMetadata {
  duration?: number;
  narrator?: string;
  chapters?: AudioChapter[];
}

export async function extractAudioMetadata(buffer: Buffer): Promise<AudioMetadata> {
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
  const narratorStr = Array.isArray(composer) ? composer[0] : composer || metadata.common.albumartist;

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

            const startTime = chapter.startTimeMs
              ? chapter.startTimeMs / 1000
              : 0;
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

export async function extractAudioCover(buffer: Buffer): Promise<CoverResult | null> {
  const metadata = await mm.parseBuffer(buffer);
  const picture = metadata.common.picture?.[0];

  if (!picture) return null;

  return {
    buffer: Buffer.from(picture.data),
    mimeType: picture.format,
  };
}

export async function extractAudioContent(): Promise<{
  fullText: string;
  chapters: Array<{ index: number; title: string; content: string }>;
  toc: Array<{ title: string; href: string; index: number }>;
}> {
  // Audio files don't have text content to extract
  return { fullText: "", chapters: [], toc: [] };
}
