/**
 * Compendus Content Document (CCD) — canonical content AST.
 *
 * This is the single, format-agnostic representation that the SERVER produces
 * once at ingest from every reflowable input (EPUB / MOBI / AZW3 / LIT, and PDF
 * for the semantic/inference layer). Both clients render it with NATIVE
 * primitives — iOS TextKit 2 / CoreText, web React — with NO layout/browser
 * engine. It is also the substrate for Living Library graph inference, search,
 * and TTS/wander alignment.
 *
 * Design source of truth. The iOS `ContentNode` enum and the Swift `Codable`
 * mirror in docs/canonical-ast-spec.md must stay in sync with this file.
 *
 * Spec: docs/canonical-ast-spec.md
 */

export const CCD_VERSION = "1.0.4-draft" as const;
export const CCD_MEDIA_TYPE = "application/vnd.compendus.content+json" as const;

// ---------------------------------------------------------------------------
// Document envelope
// ---------------------------------------------------------------------------

/** Original source format (provenance). NOTE: only EPUB and PDF are emitted to
 *  CCD directly — mobi/azw3/lit are converted to EPUB first (mobi-to-epub) and
 *  then go through the single XHTML→CCD path. This field records the *origin*. */
export type SourceFormat = "epub" | "mobi" | "azw3" | "lit" | "pdf";

/** Block flow direction. Vertical modes are used by high-quality CJK books. */
export type WritingMode = "horizontal-tb" | "vertical-rl" | "vertical-lr";

/** A whole publication as a CCD. Chapters are streamed individually in practice. */
export interface ContentDocument {
  ccdVersion: typeof CCD_VERSION;
  bookId: string;
  sourceFormat: SourceFormat;
  /** Reading order. Each entry is one spine item / logical chapter. */
  readingOrder: ChapterRef[];
  toc: TocEntry[];
  /** Total virtual-position units across the whole book (for progress math). */
  totalVirtual: number;
  /** Fixed-layout source (FXL EPUB / pre-paginated). Rendered page-faithfully. */
  isFixedLayout?: boolean;
  /** Default flow direction for the whole publication. */
  writingMode?: WritingMode;
  /** Print page-list (epub:type=pagebreak markers) → page-number locators. */
  pageList?: PageRef[];
}

/** A print-edition page boundary, anchored structurally. */
export interface PageRef {
  label: string;
  spineIndex: number;
  blockId?: string;
}

/**
 * The on-disk / over-the-wire artifact: a ContentDocument manifest with all
 * chapters inline. One `.ccd.json` bundle per book. The web API slices
 * individual chapters out of it; iOS downloads the whole bundle.
 */
export interface ContentBundle extends ContentDocument {
  chapters: Chapter[];
}

/** Pointer to a chapter resource; the body is fetched/streamed separately. */
export interface ChapterRef {
  /** Stable chapter id (NOT the array index). */
  id: string;
  title?: string;
  /** 0-based EPUB spine index — the cross-system anchor (matches knowledge pipeline). */
  spineIndex: number;
  /** Virtual-position range of this chapter within the book. */
  virtualStart: number;
  virtualLength: number;
}

/** A single chapter's content — the unit emitted over the wire. */
export interface Chapter {
  id: string;
  /** Original spine href (for internal cross-chapter link resolution). */
  href?: string;
  spineIndex: number;
  /** Semantic role from epub:type where available. */
  role?: SemanticRole;
  /** Flow direction if this chapter differs from the publication default. */
  writingMode?: WritingMode;
  /** BCP-47 base language of the chapter. */
  lang?: string;
  blocks: Block[];
  /** Footnote / endnote bodies addressable by id (referenced by `noteRef` marks). */
  notes?: Record<string, Block[]>;
  /** Abstract resource handles used by blocks in this chapter. */
  resources?: ResourceRef[];
  virtualStart: number;
  virtualLength: number;
}

/** epub:type-derived semantic roles (extend as needed; unknown → omitted). */
export type SemanticRole =
  | "chapter"
  | "part"
  | "frontmatter"
  | "backmatter"
  | "bodymatter"
  | "preface"
  | "introduction"
  | "conclusion"
  | "epigraph"
  | "dedication"
  | "footnotes"
  | "endnotes"
  | "glossary"
  | "bibliography"
  | "index"
  | "appendix"
  | "toc"
  | "titlepage"
  | "colophon";

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export type Block =
  | ParagraphBlock
  | HeadingBlock
  | BlockquoteBlock
  | ListBlock
  | DefinitionListBlock
  | VerseBlock
  | CodeBlock
  | TableBlock
  | ImageBlock
  | EmbedBlock
  | MathBlock
  | PageBreakBlock
  | ThematicBreakBlock
  | ContainerBlock
  | ForeignBlock;

/** Common to every block: stable anchor id + optional bounded style + position. */
interface BlockBase {
  /** Stable, immutable id assigned at conversion. The anchor target for
   *  highlights, bookmarks, search hits, and graph provenance. */
  id: string;
  style?: StyleHint;
  /** Virtual-position offset of this block's start within its chapter. */
  pos?: number;
  /** Source role (epub:type) when the block itself is semantically tagged. */
  role?: SemanticRole;
  /** BCP-47 language tag when this block switches language (multilingual / TTS). */
  lang?: string;
  /** Base direction when it differs from the chapter (RTL runs in LTR text, etc.). */
  dir?: "ltr" | "rtl";
  /** Flow direction when it differs from the chapter (rare; mixed CJK). */
  writingMode?: WritingMode;
}

export interface ParagraphBlock extends BlockBase {
  t: "paragraph";
  inlines: Inline[];
}
export interface HeadingBlock extends BlockBase {
  t: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  inlines: Inline[];
}
export interface BlockquoteBlock extends BlockBase {
  t: "blockquote";
  children: Block[];
}
export interface ListBlock extends BlockBase {
  t: "list";
  ordered: boolean;
  /** ordered-list start number (default 1). */
  start?: number;
  items: Block[][];
}
/** Definition list (dl/dt/dd) — glossaries, metadata. ~21% of fixtures. */
export interface DefinitionListBlock extends BlockBase {
  t: "definitionList";
  items: { term: Inline[]; definition: Block[] }[];
}
/** Verse / poetry — preserves line structure + per-line indent (Pandoc LineBlock).
 *  ~16% of fixtures. Flattening verse to paragraphs destroys line breaks. */
export interface VerseBlock extends BlockBase {
  t: "verse";
  lines: VerseLine[];
}
export interface VerseLine {
  inlines: Inline[];
  /** leading indent, em units */ indent?: number;
}
/** Forced print-page boundary (epub:type=pagebreak). Carries the page label. */
export interface PageBreakBlock extends BlockBase {
  t: "pageBreak";
  label?: string;
}
export interface CodeBlock extends BlockBase {
  t: "code";
  text: string;
  lang?: string;
}
export interface TableBlock extends BlockBase {
  t: "table";
  rows: TableRow[];
  caption?: Block[];
}
export interface ImageBlock extends BlockBase {
  t: "image";
  /** Resource handle (see Chapter.resources), NOT a URL. */
  resource: string;
  alt?: string;
  /** Caption holds block content — figcaptions are routinely multi-paragraph
   *  (and in FXL art books carry the page's primary reading text). */
  caption?: Block[];
  align?: "start" | "center" | "end";
  /** Text-wrap float (interpreted from CSS float server-side). ~29% of fixtures. */
  float?: "start" | "end";
  /** Display width as a percentage of the text column (0–100). */
  widthPct?: number;
}
export interface EmbedBlock extends BlockBase {
  t: "embed";
  kind: "video" | "audio";
  resource: string;
  poster?: string;
}
export interface MathBlock extends BlockBase {
  t: "math";
  /** Prefer TeX; mathml is the fallback payload for the renderer's escape hatch. */
  tex?: string;
  mathml?: string;
}
export interface ThematicBreakBlock extends BlockBase {
  t: "thematicBreak";
}
/** Generic grouping (div/section/article) — carries role + groups children.
 *  `frame` is a bounded visual treatment interpreted from CSS background/border
 *  (~58% of fixtures use these) — a sidebar/callout/box, NOT arbitrary CSS. */
export interface ContainerBlock extends BlockBase {
  t: "container";
  children: Block[];
  frame?: "box" | "sidebar" | "callout";
}
/** Escape hatch for the long tail (complex SVG, unparseable markup). Rendered
 *  via a SCOPED native fallback — never a full reader WebView. */
export interface ForeignBlock extends BlockBase {
  t: "foreign";
  html: string;
}

export interface TableRow {
  cells: TableCell[];
}
export interface TableCell {
  header: boolean;
  /** Cells hold block content (paragraphs, lists, even nested tables) — real
   *  technical EPUBs do this routinely, so cells are NOT inline-only. */
  blocks: Block[];
  colspan?: number;
  rowspan?: number;
}

// ---------------------------------------------------------------------------
// Inline content (Portable-Text-style flat spans + marks)
// ---------------------------------------------------------------------------
//
// Inlines are a FLAT array of text spans, each carrying zero or more marks.
// Simple decorators ("strong", "em", …) are bare strings; parameterized marks
// (link, note ref, color, font) are keys into `markDefs`. Flatness maps 1:1 to
// NSAttributedString runs on iOS and makes intra-block character-offset
// anchoring trivial (offset = sum of preceding span text lengths).

export type Inline = TextSpan | LineBreak | InlineMath | RubyInline;

export interface TextSpan {
  t: "span";
  text: string;
  /** Decorator names and/or markDef keys applied to this span. */
  marks?: string[];
  /** Definitions for any parameterized marks referenced above. */
  markDefs?: MarkDef[];
  /** BCP-47 lang for an inline language switch (multilingual text / TTS). */
  lang?: string;
}
export interface LineBreak {
  t: "br";
}
/** Inline math (the common case — most MathML is inline, not display). The
 *  block-level `MathBlock` is for display equations on their own line. */
export interface InlineMath {
  t: "math";
  tex?: string;
  mathml?: string;
}
/** Ruby annotation (CJK furigana). `base` is the reading text (what search/TTS
 *  use); `text` is the annotation. Modeling this is mandatory — flattening
 *  <ruby><rt> into one run corrupts the reading text (base+furigana mashed). */
export interface RubyInline {
  t: "ruby";
  base: string;
  text: string;
}

/** Boolean decorators with no parameters. */
export type Decorator =
  | "strong"
  | "em"
  | "code"
  | "sup"
  | "sub"
  | "underline"
  | "strike"
  | "smallCaps"
  | "allCaps";

export type MarkDef = LinkMark | NoteRefMark | ColorMark | FontMark;

export interface LinkMark {
  key: string;
  t: "link";
  href: string;
  /** internal target chapter/block, if resolvable */ target?: string;
}
export interface NoteRefMark {
  key: string;
  t: "noteRef";
  noteId: string;
}
export interface ColorMark {
  key: string;
  t: "color";
  /** #rrggbb or #rrggbbaa */ value: string;
}
export interface FontMark {
  key: string;
  t: "font";
  family?: string;
  /** em-relative scale, e.g. 0.85 */ scale?: number;
}

// ---------------------------------------------------------------------------
// Bounded style hints (NOT arbitrary CSS)
// ---------------------------------------------------------------------------
//
// Only paragraph-text-level properties that map cleanly to NSParagraphStyle and
// to CSS. Layout-engine-implying CSS (display, float, padding) is deliberately
// excluded — structural cases are modeled as block variants instead.

export interface StyleHint {
  align?: "start" | "center" | "end" | "justify";
  /** First-line indent, em units. */
  indent?: number;
  /** Extra space before/after, em units. */
  spaceBefore?: number;
  spaceAfter?: number;
  direction?: "ltr" | "rtl";
  /** Decorative initial / drop cap on the first letter (~8% of fixtures). */
  dropCap?: boolean;
}

// ---------------------------------------------------------------------------
// Resources & TOC
// ---------------------------------------------------------------------------

export interface ResourceRef {
  /** Handle referenced by ImageBlock.resource / EmbedBlock.resource. */
  id: string;
  mime: string;
  width?: number;
  height?: number;
  /** Original in-package href (provenance / cache key). */
  srcHref?: string;
}

export interface TocEntry {
  title: string;
  /** Anchor: chapter spineIndex + optional block id within it. */
  spineIndex: number;
  blockId?: string;
  level?: number;
  children?: TocEntry[];
}

// ---------------------------------------------------------------------------
// Anchoring (highlights, bookmarks, reading position, graph provenance)
// ---------------------------------------------------------------------------
//
// Store ALL applicable selectors together; resolve precise → fuzzy. A pure
// structural anchor must never be the sole anchor — text-quote is the only
// selector that survives re-conversion of the same book.

export interface Anchor {
  /** (a) Structural: chapter spine index + block id + char offset within block. */
  structural?: { spineIndex: number; blockId: string; offset: number };
  /** (b) Positional: virtual-position unit within the whole book. */
  virtual?: number;
  /** (c) Text-quote: exact text + surrounding context (survives re-conversion). */
  quote?: { exact: string; prefix?: string; suffix?: string };
}

/** A selected range = start + end anchors (collapsed range = a point/bookmark). */
export interface AnchorRange {
  start: Anchor;
  end: Anchor;
}
