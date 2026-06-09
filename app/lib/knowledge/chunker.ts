/**
 * Passage chunker for the Living Library knowledge pipeline.
 *
 * Consumes the clean sections from `book-source` (entity-decoded, NLP-grade text)
 * and splits them into ordered passages — the provenance anchor for every entity
 * and relationship. Passage `charStart`/`charEnd` are global offsets in the
 * extractor's clean-text space (cumulative across sections), matching the image
 * `charStart` values so figures can be linked to the passages they sit in.
 */
import type { BookSection } from "./book-source";

/** Target/min/max passage size in characters. ~900 chars ≈ ~200 tokens — enough
 *  context for extraction + embedding, small enough for precise provenance and
 *  good semantic granularity (well under MiniLM's token limit). */
const TARGET_CHARS = 900;
const MIN_CHARS = 400;
const MAX_CHARS = 1500;

export interface PassageChunk {
  spineIndex: number | null;
  page: number | null; // reserved for PDF support
  charStart: number; // global offset in clean-text space
  charEnd: number;
  ordinal: number; // sequential order within the book
  chapterTitle: string | null;
  text: string;
}

interface Span {
  start: number;
  end: number;
}

/**
 * Split text into boundary-aware windows of ~TARGET_CHARS, preferring paragraph
 * then sentence breaks. Offsets are into the original string (no reassembly), so
 * `text.slice(start, end)` always reconstructs the passage exactly.
 */
function chunkText(text: string): Span[] {
  const spans: Span[] = [];
  const len = text.length;
  let cursor = 0;

  while (cursor < len) {
    // Skip leading whitespace so spans start on real content.
    while (cursor < len && /\s/.test(text[cursor])) cursor++;
    if (cursor >= len) break;

    const hardEnd = Math.min(cursor + MAX_CHARS, len);
    if (hardEnd - cursor <= TARGET_CHARS || hardEnd === len) {
      const end = Math.min(cursor + MAX_CHARS, len);
      spans.push({ start: cursor, end });
      cursor = end;
      continue;
    }

    const windowStart = cursor + MIN_CHARS;
    const windowEnd = Math.min(cursor + MAX_CHARS, len);
    const target = cursor + TARGET_CHARS;

    const boundary =
      findBreak(text, windowStart, windowEnd, target, "\n\n") ??
      findBreak(text, windowStart, windowEnd, target, "\n") ??
      findSentenceBreak(text, windowStart, windowEnd, target) ??
      target;

    spans.push({ start: cursor, end: boundary });
    cursor = boundary;
  }

  return spans;
}

/** Find the occurrence of `marker` within [lo, hi) closest to `target`. */
function findBreak(
  text: string,
  lo: number,
  hi: number,
  target: number,
  marker: string,
): number | null {
  let best: number | null = null;
  let idx = text.indexOf(marker, lo);
  while (idx >= 0 && idx < hi) {
    const pos = idx + marker.length;
    if (best === null || Math.abs(pos - target) < Math.abs(best - target)) best = pos;
    idx = text.indexOf(marker, idx + 1);
  }
  return best;
}

/** Find a sentence-ending boundary (.!? followed by whitespace) near `target`. */
function findSentenceBreak(text: string, lo: number, hi: number, target: number): number | null {
  let best: number | null = null;
  for (let i = lo; i < hi; i++) {
    const c = text[i];
    if ((c === "." || c === "!" || c === "?") && i + 1 < text.length && /\s/.test(text[i + 1])) {
      const pos = i + 1;
      if (best === null || Math.abs(pos - target) < Math.abs(best - target)) best = pos;
    }
  }
  return best;
}

/**
 * Turn extracted sections into ordered passages with global character offsets.
 * The global offset of section N is the sum of prior sections' text lengths,
 * which is exactly how `extractBookSource` assigns image `charStart` — so passage
 * and image offsets share one coordinate space.
 */
export function chunkSections(sections: BookSection[]): {
  chunks: PassageChunk[];
  totalCharacters: number;
} {
  const chunks: PassageChunk[] = [];
  let ordinal = 0;
  let globalBase = 0;

  for (const section of sections) {
    for (const span of chunkText(section.text)) {
      const passageText = section.text.slice(span.start, span.end).trim();
      if (passageText.length === 0) continue;
      chunks.push({
        spineIndex: section.spineIndex,
        page: null,
        charStart: globalBase + span.start,
        charEnd: globalBase + span.end,
        ordinal: ordinal++,
        chapterTitle: section.title,
        text: passageText,
      });
    }
    globalBase += section.text.length;
  }

  return { chunks, totalCharacters: globalBase };
}
