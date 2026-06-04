/**
 * CCD → HTML for the web reader. The web *is* a browser, so rendering CCD to a
 * constrained HTML string (with layout intents as inline styles) is the native
 * path — and it lets the existing CSS-column pagination + locator machinery work
 * unchanged. `bundleToTextContent` adapts a ContentBundle into the reader's
 * existing `TextContent` shape so nothing downstream changes.
 */
import type {
  ContentBundle,
  Block,
  Inline,
  TextSpan,
  MarkDef,
  StyleHint,
  TableCell,
} from "./types.js";
import type { TextContent, NormalizedChapter, TocEntry as ReaderToc } from "../reader/types.js";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const DECORATOR_TAG: Record<string, [string, string]> = {
  strong: ["<strong>", "</strong>"],
  em: ["<em>", "</em>"],
  code: ["<code>", "</code>"],
  sup: ["<sup>", "</sup>"],
  sub: ["<sub>", "</sub>"],
  underline: ["<u>", "</u>"],
  strike: ["<s>", "</s>"],
  smallCaps: ['<span style="font-variant:small-caps">', "</span>"],
  allCaps: ['<span style="text-transform:uppercase">', "</span>"],
};

function renderSpan(span: TextSpan, bookId: string): string {
  let open = "",
    close = "";
  const defs = new Map((span.markDefs || []).map((d) => [d.key, d]));
  for (const m of span.marks || []) {
    const def = defs.get(m);
    if (def) {
      const [o, c] = renderMarkDef(def, bookId);
      open += o;
      close = c + close;
    } else if (DECORATOR_TAG[m]) {
      open += DECORATOR_TAG[m][0];
      close = DECORATOR_TAG[m][1] + close;
    }
  }
  const langAttr = span.lang ? ` lang="${esc(span.lang)}"` : "";
  const inner = esc(span.text);
  return langAttr && !open ? `<span${langAttr}>${inner}</span>` : open + inner + close;
}

function renderMarkDef(def: MarkDef, _bookId: string): [string, string] {
  switch (def.t) {
    case "link":
      return [
        `<a href="${esc(def.href)}"${def.target ? ` data-target="${esc(def.target)}"` : ""}>`,
        "</a>",
      ];
    case "noteRef":
      return [`<a data-footnote-ref="true" href="#${esc(def.noteId)}">`, "</a>"];
    case "color":
      return [`<span style="color:${esc(def.value)}">`, "</span>"];
    case "font":
      return [
        `<span style="${def.family ? `font-family:${esc(def.family)};` : ""}${def.scale ? `font-size:${def.scale}em` : ""}">`,
        "</span>",
      ];
  }
}

function renderInlines(inlines: Inline[], bookId: string): string {
  let out = "";
  for (const i of inlines) {
    if (i.t === "span") out += renderSpan(i, bookId);
    else if (i.t === "br") out += "<br/>";
    else if (i.t === "ruby") out += `<ruby>${esc(i.base)}<rt>${esc(i.text)}</rt></ruby>`;
    else if (i.t === "math") out += i.mathml || `<span class="ccd-math">${esc(i.tex || "")}</span>`;
  }
  return out;
}

function styleAttr(s: StyleHint | undefined): string {
  if (!s) return "";
  const css: string[] = [];
  if (s.align)
    css.push(`text-align:${s.align === "start" ? "left" : s.align === "end" ? "right" : s.align}`);
  if (s.indent) css.push(`text-indent:${s.indent}em`);
  if (s.spaceBefore) css.push(`margin-top:${s.spaceBefore}em`);
  if (s.spaceAfter) css.push(`margin-bottom:${s.spaceAfter}em`);
  if (s.direction) css.push(`direction:${s.direction}`);
  return css.length ? ` style="${css.join(";")}"` : "";
}
function metaAttr(b: { lang?: string; dir?: string }): string {
  return `${b.lang ? ` lang="${esc(b.lang)}"` : ""}${b.dir ? ` dir="${b.dir}"` : ""}`;
}

function imgSrc(resource: string, bookId: string): string {
  if (/^https?:|^data:/.test(resource)) return resource;
  return `/api/reader/${bookId}/resource/${encodeURIComponent(resource)}`;
}

/**
 * Rewrite SVG `<image>` hrefs in raw foreign HTML so they resolve via the resource
 * API. The EPUB parser emits a portable `data-ccd-src` (in-EPUB path) alongside the
 * rewritten temp-dir xlink:href; point the href at the resolvable resource URL.
 */
function rewriteForeignHtml(html: string, bookId: string): string {
  return html.replace(/<image([^>]*)>/gi, (tag, attrs: string) => {
    const ccdMatch = attrs.match(/data-ccd-src\s*=\s*["']([^"']+)["']/i);
    if (!ccdMatch) return tag;
    const newUrl = imgSrc(ccdMatch[1], bookId);
    return tag.replace(/((?:xlink:)?href\s*=\s*["'])[^"']+(["'])/i, `$1${newUrl}$2`);
  });
}

function renderBlock(b: Block, bookId: string): string {
  const m = "id" in b ? metaAttr(b) : "";
  switch (b.t) {
    case "paragraph":
      return `<p id="${b.id}"${styleAttr(b.style)}${m}${b.style?.dropCap ? ' class="ccd-dropcap"' : ""}>${renderInlines(b.inlines, bookId)}</p>`;
    case "heading":
      return `<h${b.level} id="${b.id}"${styleAttr(b.style)}${m}>${renderInlines(b.inlines, bookId)}</h${b.level}>`;
    case "blockquote":
      return `<blockquote id="${b.id}"${m}>${b.children.map((c) => renderBlock(c, bookId)).join("")}</blockquote>`;
    case "list":
      return `<${b.ordered ? "ol" : "ul"} id="${b.id}"${b.ordered && b.start ? ` start="${b.start}"` : ""}>${b.items.map((it) => `<li>${it.map((c) => renderBlock(c, bookId)).join("")}</li>`).join("")}</${b.ordered ? "ol" : "ul"}>`;
    case "definitionList":
      return `<dl id="${b.id}">${b.items.map((it) => `<dt>${renderInlines(it.term, bookId)}</dt><dd>${it.definition.map((c) => renderBlock(c, bookId)).join("")}</dd>`).join("")}</dl>`;
    case "verse":
      return `<div id="${b.id}" class="ccd-verse"${m}>${b.lines.map((ln) => `<span class="ccd-line"${ln.indent ? ` style="padding-left:${ln.indent}em"` : ""}>${renderInlines(ln.inlines, bookId)}</span>`).join("<br/>")}</div>`;
    case "code":
      return `<pre id="${b.id}"><code>${esc(b.text)}</code></pre>`;
    case "table":
      return `<table id="${b.id}">${b.rows.map((r) => `<tr>${r.cells.map((c) => renderCell(c, bookId)).join("")}</tr>`).join("")}</table>${b.caption ? `<div class="ccd-caption">${b.caption.map((c) => renderBlock(c, bookId)).join("")}</div>` : ""}`;
    case "image":
      return `<figure id="${b.id}"${b.float ? ` style="float:${b.float === "start" ? "left" : "right"}"` : ""}><img src="${imgSrc(b.resource, bookId)}"${b.alt ? ` alt="${esc(b.alt)}"` : ""}${b.widthPct ? ` style="width:${b.widthPct}%"` : ""}/>${b.caption ? `<figcaption>${b.caption.map((c) => renderBlock(c, bookId)).join("")}</figcaption>` : ""}</figure>`;
    case "embed":
      return `<${b.kind} id="${b.id}" controls src="${imgSrc(b.resource, bookId)}"></${b.kind}>`;
    case "math":
      return `<div id="${b.id}" class="ccd-math-block">${b.mathml || esc(b.tex || "")}</div>`;
    case "pageBreak":
      return `<span id="${b.id}" class="ccd-pagebreak" data-page="${b.label ? esc(b.label) : ""}"></span>`;
    case "thematicBreak":
      return `<hr id="${b.id}"/>`;
    case "container":
      return `<div id="${b.id}"${b.frame ? ` class="ccd-frame ccd-frame-${b.frame}"` : ""}${m}>${b.children.map((c) => renderBlock(c, bookId)).join("")}</div>`;
    case "foreign":
      return rewriteForeignHtml(b.html, bookId);
  }
}

function renderCell(c: TableCell, bookId: string): string {
  const tag = c.header ? "th" : "td";
  const span = `${c.colspan && c.colspan > 1 ? ` colspan="${c.colspan}"` : ""}${c.rowspan && c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ""}`;
  return `<${tag}${span}>${c.blocks.map((b) => renderBlock(b, bookId)).join("")}</${tag}>`;
}

/** Plain reading text of a block tree (for char offsets / pagination estimate). */
function blockText(blocks: Block[]): string {
  let s = "";
  for (const b of blocks) {
    switch (b.t) {
      case "paragraph":
      case "heading":
        s += inlineText(b.inlines) + "\n";
        break;
      case "blockquote":
      case "container":
        s += blockText(b.children);
        break;
      case "list":
        for (const it of b.items) s += blockText(it);
        break;
      case "verse":
        for (const ln of b.lines) s += inlineText(ln.inlines) + "\n";
        break;
      case "definitionList":
        for (const it of b.items) s += inlineText(it.term) + "\n" + blockText(it.definition);
        break;
      case "table":
        for (const r of b.rows) for (const c of r.cells) s += blockText(c.blocks);
        if (b.caption) s += blockText(b.caption);
        break;
      case "image":
        if (b.caption) s += blockText(b.caption);
        break;
      case "code":
        s += b.text + "\n";
        break;
    }
  }
  return s;
}
function inlineText(inlines: Inline[]): string {
  let s = "";
  for (const i of inlines) {
    if (i.t === "span") s += i.text;
    else if (i.t === "ruby") s += i.base;
  }
  return s;
}

export function renderChapterHtml(blocks: Block[], bookId: string): string {
  return blocks.map((b) => renderBlock(b, bookId)).join("");
}

/** Adapt a CCD bundle into the reader's existing TextContent shape. */
export function bundleToTextContent(bundle: ContentBundle, bookId: string): TextContent {
  const chapters: NormalizedChapter[] = bundle.chapters.map((ch) => ({
    id: ch.id,
    title: bundle.readingOrder.find((r) => r.spineIndex === ch.spineIndex)?.title ?? "",
    html: renderChapterHtml(ch.blocks, bookId),
    text: blockText(ch.blocks),
    spineIndex: ch.spineIndex,
    characterStart: ch.virtualStart,
    characterEnd: ch.virtualStart + ch.virtualLength,
    cssFiles: [], // CCD encodes style inline — no external publisher CSS
    href: ch.href ?? ch.id,
  }));
  const toc: ReaderToc[] = mapToc(bundle.toc, bundle.totalVirtual, bundle.chapters);
  // Internal-link resolution: map the spine href, its basename, and the id to a
  // 0–1 position (same keys the EPUB parser produced) so cross-chapter links work.
  const chapterHrefMap: Record<string, number> = {};
  for (const ch of chapters) {
    const pos = bundle.totalVirtual ? ch.characterStart / bundle.totalVirtual : 0;
    if (ch.href) {
      chapterHrefMap[ch.href] = pos;
      const base = ch.href.split("/").pop();
      if (base) chapterHrefMap[base] = pos;
    }
    chapterHrefMap[ch.id] = pos;
  }
  return {
    type: "text",
    bookId,
    format: bundle.sourceFormat as TextContent["format"],
    chapters,
    totalCharacters: bundle.totalVirtual,
    toc,
    ...(bundle.isFixedLayout ? { isFixedLayout: true } : {}),
    chapterHrefMap,
  };
}

function mapToc(
  items: ContentBundle["toc"],
  totalVirtual: number,
  chapters: ContentBundle["chapters"],
): ReaderToc[] {
  const startOf = (spineIndex: number) =>
    chapters.find((c) => c.spineIndex === spineIndex)?.virtualStart ?? 0;
  const walk = (entries: ContentBundle["toc"]): ReaderToc[] =>
    entries.map((e) => ({
      title: e.title,
      position: totalVirtual ? startOf(e.spineIndex) / totalVirtual : 0,
      level: e.level,
      ...(e.children?.length ? { children: walk(e.children) } : {}),
    }));
  return walk(items);
}
