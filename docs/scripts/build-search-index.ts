import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import matter from "gray-matter";

interface SearchEntry {
  title: string;
  slug: string;
  path: string;
  section: string;
  headings: string[];
  content: string;
}

const contentDir = resolve(import.meta.dirname, "../content");
const publicDir = resolve(import.meta.dirname, "../public");

const sectionNames: Record<string, string> = {
  index: "Overview",
  "getting-started": "Overview",
  architecture: "Overview",
  api: "Reference",
  formats: "Reference",
  ios: "Platforms",
  "audio-speech": "Reference",
};

const routePaths: Record<string, string> = {
  index: "/docs",
  "getting-started": "/docs/getting-started",
  architecture: "/docs/architecture",
  ios: "/docs/ios",
  "audio-speech": "/docs/audio-speech",
};

function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]\([^)]*\)/g, (match) => {
      const text = match.match(/\[([^\]]*)\]/);
      return text ? text[1] : "";
    })
    .replace(/#{1,6}\s+/g, "")
    .replace(/[*_~]+/g, "")
    .replace(/>\s+/g, "")
    .replace(/\|[^|\n]*\|/g, "")
    .replace(/-{3,}/g, "")
    .replace(/<[A-Z]\w*\s*\/>/g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function extractHeadings(md: string): string[] {
  const headings: string[] = [];
  const regex = /^#{2,3}\s+(.+)$/gm;
  let match;
  while ((match = regex.exec(md)) !== null) {
    headings.push(match[1].trim());
  }
  return headings;
}

function slugify(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~]+/g, "")
    .toLowerCase()
    .replace(
      /[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/g,
      "",
    )
    .replace(/\s/g, "-");
}

interface MdSection {
  heading: string;
  slug: string;
  content: string;
}

function extractSections(md: string): MdSection[] {
  const sections: MdSection[] = [];
  const headingRegex = /^#{2,3}\s+(.+)$/gm;
  let lastHeading: { text: string; slug: string; index: number } | null = null;
  let match;

  while ((match = headingRegex.exec(md)) !== null) {
    if (lastHeading) {
      sections.push({
        heading: lastHeading.text,
        slug: lastHeading.slug,
        content: stripMarkdown(
          md.slice(
            lastHeading.index + md.slice(lastHeading.index).indexOf("\n"),
            match.index,
          ),
        ).slice(0, 1000),
      });
    }
    lastHeading = {
      text: match[1].trim(),
      slug: slugify(match[1].trim()),
      index: match.index,
    };
  }

  if (lastHeading) {
    sections.push({
      heading: lastHeading.text,
      slug: lastHeading.slug,
      content: stripMarkdown(
        md.slice(
          lastHeading.index + md.slice(lastHeading.index).indexOf("\n"),
        ),
      ).slice(0, 1000),
    });
  }

  return sections;
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.name.endsWith(".md") || entry.name.endsWith(".mdx")) {
      files.push(fullPath);
    }
  }
  return files;
}

const files = walk(contentDir);
const entries: SearchEntry[] = [];

for (const file of files) {
  const raw = readFileSync(file, "utf-8");
  const { data, content } = matter(raw);
  const relPath = relative(contentDir, file)
    .replace(/\.mdx?$/, "")
    .replace(/\\/g, "/");
  const pageTitle = (data.title as string) || relPath.split("/").pop() || "";
  const sectionName = sectionNames[relPath] || "Overview";
  const routePath = routePaths[relPath] || `/docs/${relPath}`;

  // Page-level entry
  entries.push({
    title: pageTitle,
    slug: relPath,
    path: routePath,
    section: sectionName,
    headings: extractHeadings(content),
    content: stripMarkdown(content).slice(0, 2000),
  });

  // Per-section entries
  const sections = extractSections(content);
  for (const sec of sections) {
    entries.push({
      title: sec.heading,
      slug: `${relPath}#${sec.slug}`,
      path: `${routePath}#${sec.slug}`,
      section: `${sectionName} · ${pageTitle}`,
      headings: [],
      content: sec.content,
    });
  }
}

// Add manual entries for TSX-only pages (ApiReference, Formats)
entries.push({
  title: "API Reference",
  slug: "api",
  path: "/docs/api",
  section: "Reference",
  headings: [
    "Base URL",
    "Authentication",
    "CORS",
    "Supported File Formats",
    "Error Response Format",
    "API Endpoints",
    "Static Files",
    "Types",
  ],
  content:
    "REST API reference for Compendus. Browse endpoints for books, search, upload, reader, convert, transcribe, collections, tags, bookmarks, highlights, reading sessions, wishlist. Base URL is /api. No authentication required for local deployments. CORS enabled.",
});

entries.push({
  title: "Supported Formats",
  slug: "formats",
  path: "/docs/formats",
  section: "Reference",
  headings: [
    "MIME Types",
    "Ebooks",
    "Comics",
    "Audiobooks",
    "Cover Images",
    "Conversion Support",
  ],
  content:
    "EPUB PDF MOBI AZW3 CBZ CBR M4B M4A MP3 ebook comic audiobook formats. EPUB is the standard ebook format with full reading support. PDF rendered as page images. MOBI and AZW3 auto-convert to EPUB. CBZ comic ZIP archive. CBR auto-converts to CBZ. M4B Apple audiobook format. Cover images extracted automatically. Conversion support: PDF to EPUB, MOBI to EPUB, AZW3 to EPUB, CBR to CBZ.",
});

entries.push({
  title: "Audio & Speech",
  slug: "audio-speech",
  path: "/docs/audio-speech",
  section: "Reference",
  headings: [
    "Audiobook Transcription",
    "Server-Side Transcription",
    "On-Device Transcription",
    "Transcript API",
    "Transcript Data Model",
    "Karaoke Lyrics",
    "Text-to-Speech",
    "Web Read Aloud",
    "iOS PocketTTS Engine",
    "Audio Caching",
    "Pre-Generation & Read-Along",
    "Audiobook Playback",
    "Player Features",
    "Player Interface",
    "Audio File Processing",
    "Chapter Data Model",
  ],
  content:
    "Audio speech transcription text-to-speech TTS audiobook playback whisper.cpp PocketTTS read aloud karaoke lyrics word-level highlighting sentence timing AVAudioPlayer Web Speech API on-device background processing BGProcessingTask chapter navigation sleep timer speed control transcript API endpoint M4B M4A MP3 EPUB read-along pre-generation audio caching Now Playing widget",
});

mkdirSync(publicDir, { recursive: true });
writeFileSync(
  resolve(publicDir, "search-index.json"),
  JSON.stringify(entries, null, 2),
);

console.log(`Search index built with ${entries.length} entries`);
