/**
 * EPUB → CCD emitter (spike / design-validation grade).
 *
 * Walks each chapter's XHTML and maps elements to the bounded CCD block/inline
 * vocabulary (see ./types.ts, docs/canonical-ast-spec.md). The point of this
 * pass is to VERIFY the design against real EPUBs: every element that can't be
 * cleanly mapped is recorded (as a `foreign` block + in diagnostics) so we can
 * see whether the 12-block vocabulary actually covers real-world content.
 *
 * NOT production-complete (CSS→style hints, list nesting edge cases, table
 * colspan inference, etc. are minimal). It is complete enough to measure
 * coverage and find where the schema breaks.
 */

import { parse, type HTMLElement, type Node } from "node-html-parser";
import type {
  Block,
  Inline,
  TextSpan,
  MarkDef,
  SemanticRole,
  TableRow,
  TableCell,
  VerseLine,
} from "./types.js";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const HEADINGS: Record<string, 1 | 2 | 3 | 4 | 5 | 6> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
};

// Inline tag → decorator mark (bare-string marks).
const DECORATORS: Record<string, string> = {
  b: "strong",
  strong: "strong",
  i: "em",
  em: "em",
  cite: "em",
  var: "em",
  dfn: "em",
  code: "code",
  kbd: "code",
  samp: "code",
  tt: "code",
  sup: "sup",
  sub: "sub",
  u: "underline",
  ins: "underline",
  s: "strike",
  strike: "strike",
  del: "strike",
  small: "smallCaps",
};

// Inline tags handled structurally (not a simple decorator).
const INLINE_STRUCT = new Set([
  "a",
  "span",
  "br",
  "abbr",
  "q",
  "mark",
  "bdi",
  "bdo",
  "wbr",
  "time",
  "label",
]);

// Block tags we map directly.
const KNOWN_BLOCK = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "ul",
  "ol",
  "li",
  "pre",
  "table",
  "img",
  "figure",
  "hr",
  "div",
  "section",
  "article",
  "aside",
  "nav",
  "header",
  "footer",
  "main",
  "video",
  "audio",
  "math",
  "dl",
  "dt",
  "dd",
  "details",
  "figcaption",
  "caption",
  "tbody",
  "thead",
  "tfoot",
  "hgroup",
  "address",
]);

// Block-level tags whose presence inside a nominally-inline element (e.g. <a>)
// means we must promote to block handling rather than flatten to inline runs.
const BLOCKISH = [
  "p",
  "div",
  "table",
  "ul",
  "ol",
  "li",
  "tr",
  "td",
  "th",
  "blockquote",
  "section",
  "article",
  "figure",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "dl",
  "pre",
  "img",
];
function hasBlockContent(el: HTMLElement): boolean {
  return BLOCKISH.some((b) => el.querySelector(b));
}

// Tags that always go to the `foreign` escape hatch.
const FOREIGN_TAGS = new Set([
  "svg",
  "iframe",
  "object",
  "embed",
  "canvas",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "map",
  "area",
]);

// Non-content elements: they never contribute rendered text. Skipped entirely
// (and never descended into) so their raw bodies — script/CDATA, CSS — don't
// leak into the flowed content.
const SKIP_TAGS = new Set([
  "script",
  "style",
  "head",
  "title",
  "meta",
  "link",
  "base",
  "noscript",
  "template",
]);

// Collapse runs of HTML "document white space" (space/tab/CR/LF/FF) to a single
// space, per CSS `white-space: normal`. node-html-parser does no CSS layout, so
// pretty-printed source indentation survives verbatim in text nodes; without
// this it renders as hard line breaks + tab indentation. NBSP is left intact.
function normalizeWS(text: string): string {
  return text.replace(/[ \t\r\n\f]+/g, " ");
}

// Trim the collapsed leading/trailing space at a block's inline-run boundary
// (the block edge is a line-box edge, where that space isn't rendered). Apply
// ONLY to outermost/block-level runs — nested inline runs must keep edge spaces,
// which are significant between siblings (e.g. "foo " + <b>bar</b> → "foo bar").
function trimInlineEdges(inlines: Inline[]): Inline[] {
  const spans = inlines.filter((i): i is TextSpan => i.t === "span");
  if (spans.length) {
    spans[0].text = spans[0].text.replace(/^ +/, "");
    spans[spans.length - 1].text = spans[spans.length - 1].text.replace(/ +$/, "");
  }
  return inlines.filter((i) => !(i.t === "span" && i.text === ""));
}

const ROLE_MAP: Record<string, SemanticRole> = {
  chapter: "chapter",
  part: "part",
  frontmatter: "frontmatter",
  backmatter: "backmatter",
  bodymatter: "bodymatter",
  preface: "preface",
  introduction: "introduction",
  conclusion: "conclusion",
  epigraph: "epigraph",
  dedication: "dedication",
  footnotes: "footnotes",
  endnotes: "endnotes",
  glossary: "glossary",
  bibliography: "bibliography",
  index: "index",
  appendix: "appendix",
  toc: "toc",
  titlepage: "titlepage",
  colophon: "colophon",
};

const NOTE_TYPES = new Set(["footnote", "endnote", "rearnote", "note"]);

export interface Diagnostics {
  blockCounts: Record<string, number>;
  markCounts: Record<string, number>;
  /** Tags that fell through to a `foreign` block or were dropped, with counts. */
  unmappedTags: Record<string, number>;
  foreignCount: number;
  noteCount: number;
  hasMath: boolean;
  hasSvg: boolean;
  hasTable: boolean;
  hasRuby: boolean;
}

export interface ChapterCCD {
  blocks: Block[];
  notes: Record<string, Block[]>;
  diagnostics: Diagnostics;
}

function tag(el: HTMLElement): string {
  return (el.tagName || "").toLowerCase();
}

function epubType(el: HTMLElement): string[] {
  const v = el.getAttribute("epub:type") || el.getAttribute("role") || "";
  return v.replace(/^doc-/, "").split(/\s+/).filter(Boolean);
}

function roleOf(el: HTMLElement): SemanticRole | undefined {
  for (const t of epubType(el)) if (ROLE_MAP[t]) return ROLE_MAP[t];
  return undefined;
}

export function convertChapter(html: string, spineIndex: number): ChapterCCD {
  const diag: Diagnostics = {
    blockCounts: {},
    markCounts: {},
    unmappedTags: {},
    foreignCount: 0,
    noteCount: 0,
    hasMath: false,
    hasSvg: false,
    hasTable: false,
    hasRuby: false,
  };
  const notes: Record<string, Block[]> = {};
  let counter = 0;
  const nextId = () => `${spineIndex}:${counter++}`;

  const root = parse(html, { comment: false });
  const body = (root.querySelector("body") as HTMLElement | null) ?? root;

  const bump = (rec: Record<string, number>, k: string) => {
    rec[k] = (rec[k] || 0) + 1;
  };

  // ---- inline pass ----
  function convertInlines(parent: HTMLElement, marks: string[], markDefs: MarkDef[]): Inline[] {
    const out: Inline[] = [];
    for (const node of parent.childNodes as Node[]) {
      if (node.nodeType === TEXT_NODE) {
        const text = normalizeWS((node as any).text as string);
        if (text) out.push({ t: "span", text, marks: marks.length ? [...marks] : undefined });
        continue;
      }
      if (node.nodeType !== ELEMENT_NODE) continue;
      const el = node as HTMLElement;
      const t = tag(el);

      if (SKIP_TAGS.has(t)) continue;
      if (t === "br") {
        out.push({ t: "br" });
        continue;
      }

      // Ruby: capture base + annotation SEPARATELY. Never descend — recursing
      // through <rt> mashes furigana into the reading text (silent corruption).
      if (t === "ruby") {
        diag.hasRuby = true;
        bump(diag.markCounts, "ruby");
        let base = "",
          anno = "";
        for (const c of el.childNodes as Node[]) {
          if (c.nodeType === TEXT_NODE) base += (c as any).text;
          else if (c.nodeType === ELEMENT_NODE) {
            const ct = tag(c as HTMLElement);
            if (ct === "rt") anno += (c as HTMLElement).text;
            else if (ct !== "rp") base += (c as HTMLElement).text;
          }
        }
        out.push({ t: "ruby", base: normalizeWS(base).trim(), text: normalizeWS(anno).trim() });
        continue;
      }

      // Inline math: capture the whole <math> subtree, never descend into it.
      if (t === "math") {
        diag.hasMath = true;
        bump(diag.markCounts, "math");
        out.push({ t: "math", mathml: el.toString() });
        continue;
      }

      if (DECORATORS[t]) {
        bump(diag.markCounts, DECORATORS[t]);
        out.push(...convertInlines(el, [...marks, DECORATORS[t]], markDefs));
        continue;
      }

      if (t === "a") {
        const types = epubType(el);
        const href = el.getAttribute("href") || "";
        if (types.includes("noteref") || types.includes("biblioref")) {
          const key = `m${counter}`;
          counter++;
          bump(diag.markCounts, "noteRef");
          out.push(
            ...convertInlines(
              el,
              [...marks, key],
              [...markDefs, { key, t: "noteRef", noteId: href.replace(/^.*#/, "") }],
            ),
          );
        } else if (href) {
          const key = `m${counter}`;
          counter++;
          bump(diag.markCounts, "link");
          out.push(...convertInlines(el, [...marks, key], [...markDefs, { key, t: "link", href }]));
        } else {
          out.push(...convertInlines(el, marks, markDefs));
        }
        continue;
      }

      if (INLINE_STRUCT.has(t)) {
        out.push(...convertInlines(el, marks, markDefs));
        continue;
      }

      // An unexpected element inside inline context: recurse, record it.
      bump(diag.unmappedTags, `inline:${t}`);
      out.push(...convertInlines(el, marks, markDefs));
    }
    // attach markDefs onto the first span that references a def (simplification: attach all to chapter-resolvable spans)
    if (markDefs.length) {
      for (const inl of out) {
        if (inl.t === "span" && inl.marks?.some((m) => markDefs.find((d) => d.key === m))) {
          (inl as TextSpan).markDefs = markDefs.filter((d) => inl.marks!.includes(d.key));
        }
      }
    }
    return out;
  }

  // ---- block pass ----
  function convertBlocks(parent: HTMLElement): Block[] {
    const out: Block[] = [];
    let pending: Inline[] = [];
    const flush = () => {
      if (pending.some((i) => i.t === "br" || (i.t === "span" && i.text.trim()))) {
        out.push({ t: "paragraph", id: nextId(), inlines: trimInlineEdges(pending) });
        bump(diag.blockCounts, "paragraph");
      }
      pending = [];
    };

    for (const node of parent.childNodes as Node[]) {
      if (node.nodeType === TEXT_NODE) {
        const text = normalizeWS((node as any).text as string);
        if (text.trim()) pending.push({ t: "span", text });
        continue;
      }
      if (node.nodeType !== ELEMENT_NODE) continue;
      const el = node as HTMLElement;
      const t = tag(el);

      if (SKIP_TAGS.has(t)) continue;

      // Inline element at block level. If it actually wraps block content
      // (e.g. <a> around <p>/<img>), promote to block handling instead of
      // flattening — otherwise accumulate into a paragraph.
      if (DECORATORS[t] || INLINE_STRUCT.has(t)) {
        if (hasBlockContent(el)) {
          flush();
          out.push(...convertBlocks(el));
        } else pending.push(...convertInlines(el, [], []));
        continue;
      }

      flush();

      // Notes are pulled out of the flow, keyed by id.
      const types = epubType(el);
      if (types.some((x) => NOTE_TYPES.has(x)) && el.getAttribute("id")) {
        notes[el.getAttribute("id")!] = convertBlocks(el);
        diag.noteCount++;
        continue;
      }

      // Page-break markers become structural anchors, not flowed content.
      if (types.includes("pagebreak")) {
        bump(diag.blockCounts, "pageBreak");
        out.push({
          t: "pageBreak",
          id: nextId(),
          label: el.getAttribute("title") || el.text.trim() || undefined,
        });
        continue;
      }

      const block = convertBlock(el, t);
      if (block) out.push(withMeta(block, el)); // attach lang/dir uniformly
    }
    flush();
    return out;
  }

  // Attach multilingual / direction metadata to any block (lang switches ~21%
  // of fixtures; RTL present). lang/dir come straight from attributes.
  function withMeta(b: Block, el: HTMLElement): Block {
    const lang = el.getAttribute("xml:lang") || el.getAttribute("lang");
    if (lang) (b as { lang?: string }).lang = lang;
    const d = (el.getAttribute("dir") || "").toLowerCase();
    if (d === "rtl" || d === "ltr") (b as { dir?: "ltr" | "rtl" }).dir = d;
    return b;
  }

  function isVerse(el: HTMLElement): boolean {
    const cls = (el.getAttribute("class") || "").toLowerCase();
    const ty = epubType(el).join(" ");
    return /\b(verse|poem|stanza)\b/.test(ty) || /\b(verse|poem|stanza)\b/.test(cls);
  }
  function verseLines(el: HTMLElement): VerseLine[] {
    const lines: VerseLine[] = [];
    const lineEls = (el.childNodes as Node[]).filter(
      (n) => n.nodeType === ELEMENT_NODE && ["p", "div"].includes(tag(n as HTMLElement)),
    ) as HTMLElement[];
    if (lineEls.length) {
      for (const k of lineEls) lines.push({ inlines: trimInlineEdges(convertInlines(k, [], [])) });
    } else {
      let cur: Inline[] = [];
      for (const inl of convertInlines(el, [], [])) {
        if (inl.t === "br") {
          if (cur.length) lines.push({ inlines: cur });
          cur = [];
        } else cur.push(inl);
      }
      if (cur.length) lines.push({ inlines: cur });
    }
    return lines;
  }
  function directRows(table: HTMLElement): HTMLElement[] {
    const rows: HTMLElement[] = [];
    for (const n of table.childNodes as Node[]) {
      if (n.nodeType !== ELEMENT_NODE) continue;
      const ct = tag(n as HTMLElement);
      if (ct === "tr") rows.push(n as HTMLElement);
      else if (ct === "thead" || ct === "tbody" || ct === "tfoot") {
        for (const r of (n as HTMLElement).childNodes as Node[])
          if (r.nodeType === ELEMENT_NODE && tag(r as HTMLElement) === "tr")
            rows.push(r as HTMLElement);
      }
    }
    return rows;
  }
  function directCells(tr: HTMLElement): HTMLElement[] {
    return (tr.childNodes as Node[]).filter(
      (n) => n.nodeType === ELEMENT_NODE && ["td", "th"].includes(tag(n as HTMLElement)),
    ) as HTMLElement[];
  }

  function convertBlock(el: HTMLElement, t: string): Block | null {
    const id = nextId();
    const role = roleOf(el);

    // Verse / poetry — preserve line structure (would otherwise flatten to paras).
    if (isVerse(el) && t !== "table") {
      bump(diag.blockCounts, "verse");
      return { t: "verse", id, role, lines: verseLines(el) };
    }
    if (t === "dl") {
      bump(diag.blockCounts, "definitionList");
      const items: { term: Inline[]; definition: Block[] }[] = [];
      let curTerm: Inline[] | null = null;
      for (const n of el.childNodes as Node[]) {
        if (n.nodeType !== ELEMENT_NODE) continue;
        const ct = tag(n as HTMLElement);
        if (ct === "dt") curTerm = convertInlines(n as HTMLElement, [], []);
        else if (ct === "dd") {
          items.push({ term: curTerm || [], definition: convertBlocks(n as HTMLElement) });
          curTerm = null;
        }
      }
      return { t: "definitionList", id, items };
    }

    if (t === "p") {
      bump(diag.blockCounts, "paragraph");
      return { t: "paragraph", id, role, inlines: trimInlineEdges(convertInlines(el, [], [])) };
    }
    if (HEADINGS[t]) {
      bump(diag.blockCounts, "heading");
      return {
        t: "heading",
        id,
        level: HEADINGS[t],
        inlines: trimInlineEdges(convertInlines(el, [], [])),
      };
    }
    if (t === "blockquote") {
      bump(diag.blockCounts, "blockquote");
      return { t: "blockquote", id, role, children: convertBlocks(el) };
    }
    if (t === "ul" || t === "ol") {
      bump(diag.blockCounts, "list");
      const items = (el.querySelectorAll(":scope > li") as HTMLElement[]).map((li) =>
        convertBlocks(li),
      );
      return { t: "list", id, ordered: t === "ol", items };
    }
    if (t === "pre") {
      bump(diag.blockCounts, "code");
      return { t: "code", id, text: el.text };
    }
    if (t === "hr") {
      bump(diag.blockCounts, "thematicBreak");
      return { t: "thematicBreak", id };
    }
    if (t === "img") return imageBlock(el, id);
    if (t === "figure") {
      const img = el.querySelector("img") as HTMLElement | null;
      const cap = el.querySelector("figcaption") as HTMLElement | null;
      if (img) {
        const b = imageBlock(img, id);
        if (cap) (b as { caption?: Block[] }).caption = convertBlocks(cap);
        return b;
      }
      bump(diag.blockCounts, "container");
      return { t: "container", id, role, children: convertBlocks(el) };
    }
    if (t === "table") {
      diag.hasTable = true;
      bump(diag.blockCounts, "table");
      // Direct rows/cells only — nested tables are converted inside a cell's
      // blocks, so descending via querySelectorAll would double-count them.
      const rows: TableRow[] = directRows(el).map((tr) => ({
        cells: directCells(tr).map(
          (td): TableCell => ({
            header: tag(td) === "th",
            blocks: convertBlocks(td),
            colspan: td.getAttribute("colspan") ? Number(td.getAttribute("colspan")) : undefined,
            rowspan: td.getAttribute("rowspan") ? Number(td.getAttribute("rowspan")) : undefined,
          }),
        ),
      }));
      const capEl = (el.childNodes as Node[]).find(
        (n) => n.nodeType === ELEMENT_NODE && tag(n as HTMLElement) === "caption",
      ) as HTMLElement | undefined;
      return { t: "table", id, rows, ...(capEl ? { caption: convertBlocks(capEl) } : {}) };
    }
    if (t === "math") {
      diag.hasMath = true;
      bump(diag.blockCounts, "math");
      return { t: "math", id, mathml: el.toString() };
    }
    if (t === "video" || t === "audio") {
      bump(diag.blockCounts, "embed");
      const src =
        el.getAttribute("src") ||
        (el.querySelector("source") as HTMLElement | null)?.getAttribute("src") ||
        "";
      return {
        t: "embed",
        id,
        kind: t,
        resource: src,
        poster: el.getAttribute("poster") || undefined,
      };
    }
    if (t === "svg") {
      diag.hasSvg = true;
      // Common cover / full-page-bitmap pattern: <svg><image xlink:href="…"/></svg>.
      // When the SVG is a pure wrapper around a single raster image (no vector
      // drawing elements), convert it to a native `image` block so it renders
      // without the raw-SVG `foreign` escape hatch — which iOS drops entirely.
      // Genuine vector art (paths, shapes, text) still falls through to foreign.
      const imgs = el.querySelectorAll("image") as HTMLElement[];
      const hasVector = !!el.querySelector(
        "path, rect, circle, ellipse, line, polygon, polyline, text, use",
      );
      if (imgs.length === 1 && !hasVector) {
        const im = imgs[0];
        const href =
          im.getAttribute("data-ccd-src") ||
          im.getAttribute("xlink:href") ||
          im.getAttribute("href");
        if (href) {
          bump(diag.blockCounts, "image");
          return {
            t: "image",
            id,
            resource: href,
            alt: el.getAttribute("aria-label") || undefined,
          };
        }
      }
    }
    if (FOREIGN_TAGS.has(t)) {
      if (t === "svg") diag.hasSvg = true;
      bump(diag.unmappedTags, t);
      diag.foreignCount++;
      bump(diag.blockCounts, "foreign");
      return { t: "foreign", id, html: el.toString() };
    }
    // Generic containers (div/section/article/...): recurse, preserve role.
    if (KNOWN_BLOCK.has(t)) {
      const children = convertBlocks(el);
      if (!children.length) return null;
      bump(diag.blockCounts, "container");
      return { t: "container", id, role, children };
    }

    // Truly unknown tag — record it, but try to keep the content.
    bump(diag.unmappedTags, t);
    const children = convertBlocks(el);
    if (!children.length) {
      diag.foreignCount++;
      bump(diag.blockCounts, "foreign");
      return { t: "foreign", id, html: el.toString() };
    }
    bump(diag.blockCounts, "container");
    return { t: "container", id, role, children };
  }

  function imageBlock(el: HTMLElement, id: string): Block {
    bump(diag.blockCounts, "image");
    // Prefer the portable in-EPUB href (data-ccd-src) over the parser's rewritten
    // absolute temp path, so the handle resolves on every client.
    return {
      t: "image",
      id,
      resource: el.getAttribute("data-ccd-src") || el.getAttribute("src") || "",
      alt: el.getAttribute("alt") || undefined,
    };
  }

  const blocks = convertBlocks(body as HTMLElement);
  return { blocks, notes, diagnostics: diag };
}
