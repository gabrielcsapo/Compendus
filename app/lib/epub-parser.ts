import JSZip from "jszip";
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from "fs";
import { resolve } from "path";

// ── Public types ──

export interface EpubSpineItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string;
  linear: string;
}

export interface EpubTocItem {
  label: string;
  href: string;
  id: string;
  playOrder: string;
  children?: EpubTocItem[];
}

export interface EpubMetadata {
  title: string;
  language: string;
  identifier: { id: string; scheme?: string; [key: string]: string | undefined };
  creator?: { contributor: string; fileAs?: string; role?: string }[];
  contributor?: { contributor: string; fileAs?: string; role?: string }[];
  publisher?: string;
  description?: string;
  date?: Record<string, string>;
  metas: Record<string, string>;
  subject?: { subject: string }[];
}

export interface EpubChapter {
  html: string;
  css?: { id: string; href: string; epubPath: string }[];
}

export interface EpubParser {
  getSpine(): EpubSpineItem[];
  getToc(): EpubTocItem[];
  getMetadata(): EpubMetadata;
  loadChapter(id: string): Promise<EpubChapter>;
  getCoverImage(): string;
  getResource(path: string): Promise<Buffer | null>;
  destroy(): void;
}

// ── Manifest item (internal) ──

interface ManifestItem {
  id: string;
  href: string;        // full path within ZIP (e.g. "OEBPS/chapter1.xhtml")
  mediaType: string;
  properties: string;
  mediaOverlay: string;
}

// ── MIME types for resources to save to disk ──

const RESOURCE_MIME_PREFIXES = new Set([
  "image/", "video/", "audio/", "font/", "text/css",
  "application/font", "application/x-font",
]);

function shouldSaveResource(mediaType: string): boolean {
  for (const prefix of RESOURCE_MIME_PREFIXES) {
    if (mediaType.startsWith(prefix)) return true;
  }
  return false;
}

// ── Path utilities ──

/** Join POSIX-style paths (for ZIP internal paths) */
function joinPosix(...parts: string[]): string {
  const segments: string[] = [];
  for (const part of parts) {
    for (const seg of part.split("/")) {
      if (seg === ".." && segments.length > 0) segments.pop();
      else if (seg && seg !== ".") segments.push(seg);
    }
  }
  return segments.join("/");
}

function dirnamePosix(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx >= 0 ? p.substring(0, idx) : "";
}

// ── Init function ──

export async function initEpubFile(
  epubInput: Uint8Array | Buffer | string,
  resourceSaveDir = "./images",
): Promise<EpubParser> {
  const epub = new EpubFileParser(epubInput, resourceSaveDir);
  await epub.load();
  await epub.parse();
  return epub;
}

// ── Main parser class ──

class EpubFileParser implements EpubParser {
  private zip!: JSZip;
  private namesMap!: Map<string, string>; // lowercase → actual name
  private opfDir = "";
  private manifest: Record<string, ManifestItem> = {};
  private spine: EpubSpineItem[] = [];
  private navMap: EpubTocItem[] = [];
  private metadata!: EpubMetadata;
  private hrefToIdMap: Record<string, string> = {};
  private savedPaths: string[] = [];
  private chapterCache = new Map<string, EpubChapter>();
  private resourceSaveDir: string;
  private input: Uint8Array | Buffer | string;

  constructor(input: Uint8Array | Buffer | string, resourceSaveDir: string) {
    this.input = input;
    this.resourceSaveDir = resourceSaveDir;
    if (!existsSync(this.resourceSaveDir)) {
      mkdirSync(this.resourceSaveDir, { recursive: true });
    }
  }

  async load() {
    const data = typeof this.input === "string"
      ? (await import("fs")).readFileSync(this.input)
      : this.input;
    this.zip = await new JSZip().loadAsync(data);
    this.namesMap = new Map(
      Object.keys(this.zip.files).map((n) => [n.toLowerCase(), n]),
    );
  }

  // ── ZIP helpers ──

  private hasFile(name: string): boolean {
    return this.namesMap.has(name.toLowerCase());
  }

  private getActualName(name: string): string | undefined {
    return this.namesMap.get(name.toLowerCase());
  }

  private async readFile(name: string): Promise<string> {
    const actual = this.getActualName(name);
    if (!actual) return "";
    const file = this.zip.file(actual);
    if (!file) return "";
    return file.async("string");
  }

  private async readBinary(name: string): Promise<Uint8Array> {
    const actual = this.getActualName(name);
    if (!actual) return new Uint8Array();
    const file = this.zip.file(actual);
    if (!file) return new Uint8Array();
    return file.async("uint8array");
  }

  // ── Parse entry point ──

  async parse() {
    // 1. container.xml → find OPF path
    const containerXml = await this.readFile("META-INF/container.xml");
    if (!containerXml && this.hasFile("meta-inf/container.xml")) {
      // Some EPUBs use lowercase
    }
    const rawContainer = containerXml || await this.readFile("meta-inf/container.xml");
    const opfPath = this.parseContainer(rawContainer);
    this.opfDir = dirnamePosix(opfPath);

    // 2. Parse OPF
    const opfXml = await this.readFile(opfPath);
    this.parseOpf(opfXml);

    // 3. Save resources to disk
    await this.saveResources();

    // 4. Parse TOC (NCX or EPUB 3 nav)
    await this.parseToc();
  }

  // ── container.xml ──

  private parseContainer(xml: string): string {
    const match = xml.match(/full-path\s*=\s*["']([^"']+)["']/i);
    if (!match) throw new Error("No rootfile full-path found in container.xml");
    return match[1];
  }

  // ── OPF parsing ──

  private parseOpf(xml: string) {
    this.metadata = this.parseMetadata(xml);
    this.parseManifest(xml);
    this.parseSpine(xml);
  }

  private parseMetadata(xml: string): EpubMetadata {
    // Extract the <metadata> block
    const metaBlock = xml.match(/<metadata[^>]*>([\s\S]*?)<\/metadata>/i)?.[1] || "";

    const getText = (tag: string): string => {
      const re = new RegExp(`<(?:dc:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:dc:)?${tag}>`, "i");
      const m = metaBlock.match(re);
      return m ? decodeEntities(m[1].trim()) : "";
    };

    // Parse creators
    const creators: { contributor: string; fileAs?: string; role?: string }[] = [];
    const creatorRe = /<(?:dc:)?creator([^>]*)>([\s\S]*?)<\/(?:dc:)?creator>/gi;
    let cm;
    while ((cm = creatorRe.exec(metaBlock)) !== null) {
      const attrs = cm[1];
      const name = decodeEntities(cm[2].trim());
      const fileAs = attrs.match(/(?:opf:)?file-as\s*=\s*["']([^"']+)["']/i)?.[1] || "";
      const role = attrs.match(/(?:opf:)?role\s*=\s*["']([^"']+)["']/i)?.[1] || "";
      creators.push({ contributor: name, fileAs, role });
    }

    // Parse contributors
    const contributors: { contributor: string; fileAs?: string; role?: string }[] = [];
    const contribRe = /<(?:dc:)?contributor([^>]*)>([\s\S]*?)<\/(?:dc:)?contributor>/gi;
    while ((cm = contribRe.exec(metaBlock)) !== null) {
      const attrs = cm[1];
      const name = decodeEntities(cm[2].trim());
      const fileAs = attrs.match(/(?:opf:)?file-as\s*=\s*["']([^"']+)["']/i)?.[1] || "";
      const role = attrs.match(/(?:opf:)?role\s*=\s*["']([^"']+)["']/i)?.[1] || "";
      contributors.push({ contributor: name, fileAs, role });
    }

    // Parse identifier
    const identifierRe = /<(?:dc:)?identifier([^>]*)>([\s\S]*?)<\/(?:dc:)?identifier>/gi;
    let identifier: EpubMetadata["identifier"] = { id: "" };
    while ((cm = identifierRe.exec(metaBlock)) !== null) {
      const attrs = cm[1];
      const id = decodeEntities(cm[2].trim());
      const scheme = attrs.match(/(?:opf:)?scheme\s*=\s*["']([^"']+)["']/i)?.[1] || "";
      identifier = { id, scheme };
    }

    // Parse dates
    const dateMap: Record<string, string> = {};
    const dateRe = /<(?:dc:)?date([^>]*)>([\s\S]*?)<\/(?:dc:)?date>/gi;
    while ((cm = dateRe.exec(metaBlock)) !== null) {
      const attrs = cm[1];
      const dateVal = decodeEntities(cm[2].trim());
      const event = attrs.match(/(?:opf:)?event\s*=\s*["']([^"']+)["']/i)?.[1] || "publication";
      dateMap[event] = dateVal;
    }

    // Parse <meta> tags
    const metas: Record<string, string> = {};
    const metaRe = /<meta\s+([^>]+?)\/?>(?:([\s\S]*?)<\/meta>)?/gi;
    while ((cm = metaRe.exec(metaBlock)) !== null) {
      const attrs = cm[1];
      const content = cm[2]?.trim();
      const name = attrs.match(/name\s*=\s*["']([^"']+)["']/i)?.[1];
      const metaContent = attrs.match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
      const property = attrs.match(/property\s*=\s*["']([^"']+)["']/i)?.[1];
      if (name && metaContent) {
        metas[name] = metaContent;
      } else if (property && content) {
        metas[property] = content;
      }
    }

    // Parse subjects
    const subjects: { subject: string }[] = [];
    const subjectRe = /<(?:dc:)?subject[^>]*>([\s\S]*?)<\/(?:dc:)?subject>/gi;
    while ((cm = subjectRe.exec(metaBlock)) !== null) {
      subjects.push({ subject: decodeEntities(cm[1].trim()) });
    }

    const result: EpubMetadata = {
      title: getText("title"),
      language: getText("language"),
      identifier,
      metas,
    };
    if (creators.length > 0) result.creator = creators;
    if (contributors.length > 0) result.contributor = contributors;
    const publisher = getText("publisher");
    if (publisher) result.publisher = publisher;
    const description = getText("description");
    if (description) result.description = description;
    if (Object.keys(dateMap).length > 0) result.date = dateMap;
    if (subjects.length > 0) result.subject = subjects;

    return result;
  }

  private parseManifest(xml: string) {
    const manifestBlock = xml.match(/<manifest[^>]*>([\s\S]*?)<\/manifest>/i)?.[1] || "";
    const itemRe = /<item\s+([^>]+?)\/?>/gi;
    let m;
    while ((m = itemRe.exec(manifestBlock)) !== null) {
      const attrs = m[1];
      const id = attrs.match(/id\s*=\s*["']([^"']+)["']/i)?.[1];
      const href = attrs.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
      const mediaType = attrs.match(/media-type\s*=\s*["']([^"']+)["']/i)?.[1];
      const properties = attrs.match(/properties\s*=\s*["']([^"']+)["']/i)?.[1] || "";
      const mediaOverlay = attrs.match(/media-overlay\s*=\s*["']([^"']+)["']/i)?.[1] || "";
      if (!id || !href || !mediaType) continue;

      const fullHref = joinPosix(this.opfDir, decodeURIComponent(href));
      this.manifest[id] = { id, href: fullHref, mediaType, properties, mediaOverlay };
      this.hrefToIdMap[fullHref] = id;
    }
  }

  private parseSpine(xml: string) {
    const spineBlock = xml.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i)?.[1] || "";
    const itemrefRe = /<itemref\s+([^>]+?)\/?>/gi;
    let m;
    while ((m = itemrefRe.exec(spineBlock)) !== null) {
      const attrs = m[1];
      const idref = attrs.match(/idref\s*=\s*["']([^"']+)["']/i)?.[1];
      const linear = attrs.match(/linear\s*=\s*["']([^"']+)["']/i)?.[1] || "yes";
      if (!idref) continue;
      const item = this.manifest[idref];
      if (!item) continue;
      this.spine.push({
        id: item.id,
        href: item.href,
        mediaType: item.mediaType,
        properties: item.properties,
        linear,
      });
    }
  }

  // ── Save resources to disk ──

  private async saveResources() {
    for (const id in this.manifest) {
      const item = this.manifest[id];
      if (!shouldSaveResource(item.mediaType)) continue;
      try {
        const data = await this.readBinary(item.href);
        if (data.length === 0) continue;
        const fileName = item.href.replace(/\//g, "_");
        const filePath = resolve(this.resourceSaveDir, fileName);
        writeFileSync(filePath, data);
        this.savedPaths.push(filePath);
      } catch {
        // Skip resources that fail to extract
      }
    }
  }

  // ── TOC parsing ──

  private async parseToc() {
    // Try EPUB 3 nav document first
    const navItem = Object.values(this.manifest).find(
      (item) => item.properties.includes("nav"),
    );
    if (navItem) {
      const navHtml = await this.readFile(navItem.href);
      const navToc = this.parseEpub3Nav(navHtml, dirnamePosix(navItem.href));
      if (navToc.length > 0) {
        this.navMap = navToc;
        return;
      }
    }

    // Fall back to NCX (EPUB 2)
    const ncxItem = Object.values(this.manifest).find(
      (item) => item.mediaType === "application/x-dtbncx+xml",
    );
    if (!ncxItem) {
      // Try spine toc attribute
      return;
    }

    const ncxXml = await this.readFile(ncxItem.href);
    const ncxDir = dirnamePosix(ncxItem.href);
    this.navMap = this.parseNcxNavMap(ncxXml, ncxDir);
  }

  /** Parse EPUB 3 navigation document */
  private parseEpub3Nav(html: string, navDir: string): EpubTocItem[] {
    // Find <nav epub:type="toc"> block
    const navMatch = html.match(/<nav[^>]*epub:type\s*=\s*["']toc["'][^>]*>([\s\S]*?)<\/nav>/i);
    if (!navMatch) return [];
    return this.parseOlItems(navMatch[1], navDir);
  }

  /** Recursively parse <ol>/<li>/<a> structure */
  private parseOlItems(html: string, baseDir: string): EpubTocItem[] {
    const items: EpubTocItem[] = [];
    // Find top-level <ol> using stack-based matching
    const olContent = extractOutermostTag(html, "ol");
    if (!olContent) return items;

    // Split into <li> items - use a simple stack approach
    const liParts = splitLiItems(olContent);

    for (const liHtml of liParts) {
      // Extract first <a> tag
      const aMatch = liHtml.match(/<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
      if (!aMatch) {
        // Try <span> (some navs use span for section headers)
        const spanMatch = liHtml.match(/<span[^>]*>([\s\S]*?)<\/span>/i);
        if (spanMatch) {
          const label = stripTags(spanMatch[1]).trim();
          const children = this.parseOlItems(liHtml, baseDir);
          if (label) {
            items.push({ label, href: "", id: "", playOrder: "", children: children.length > 0 ? children : undefined });
          }
        }
        continue;
      }

      const rawHref = decodeURIComponent(aMatch[1]);
      const label = stripTags(aMatch[2]).trim();
      const fullHref = joinPosix(baseDir, rawHref);
      const hrefPath = fullHref.split("#")[0];
      const id = this.hrefToIdMap[hrefPath] || "";

      // Check for nested <ol> inside this <li>
      const children = this.parseOlItems(liHtml.substring(liHtml.indexOf("</a>") + 4), baseDir);

      items.push({
        label,
        href: fullHref,
        id,
        playOrder: "",
        children: children.length > 0 ? children : undefined,
      });
    }

    return items;
  }

  /** Parse NCX navMap */
  private parseNcxNavMap(ncxXml: string, ncxDir: string): EpubTocItem[] {
    const navMapMatch = ncxXml.match(/<navMap[^>]*>([\s\S]*?)<\/navMap>/i);
    if (!navMapMatch) return [];
    return this.parseNavPoints(navMapMatch[1], ncxDir);
  }

  /** Recursively parse <navPoint> elements */
  private parseNavPoints(xml: string, ncxDir: string): EpubTocItem[] {
    const items: EpubTocItem[] = [];
    // Match top-level navPoint elements (not nested ones)
    // We need to handle nesting carefully
    const navPoints = splitNavPoints(xml);

    for (const npXml of navPoints) {
      const labelMatch = npXml.match(/<navLabel[^>]*>\s*<text[^>]*>([\s\S]*?)<\/text>\s*<\/navLabel>/i);
      const contentMatch = npXml.match(/<content[^>]*src\s*=\s*["']([^"']+)["'][^>]*\/?>/i);
      const playOrderMatch = npXml.match(/playOrder\s*=\s*["']([^"']+)["']/i);

      const label = labelMatch ? decodeEntities(labelMatch[1].trim()) : "";
      const rawSrc = contentMatch ? decodeURIComponent(contentMatch[1]) : "";
      const fullHref = rawSrc ? joinPosix(ncxDir, rawSrc) : "";
      const hrefPath = fullHref.split("#")[0];
      const id = this.hrefToIdMap[hrefPath] || "";
      const playOrder = playOrderMatch ? playOrderMatch[1] : "";

      // Check for nested navPoints
      const innerContent = getNavPointInnerContent(npXml);
      const children = innerContent ? this.parseNavPoints(innerContent, ncxDir) : [];

      items.push({
        label,
        href: fullHref,
        id,
        playOrder,
        children: children.length > 0 ? children : undefined,
      });
    }

    return items;
  }

  // ── Public API ──

  getSpine(): EpubSpineItem[] {
    return this.spine;
  }

  getToc(): EpubTocItem[] {
    return this.navMap;
  }

  getMetadata(): EpubMetadata {
    return this.metadata;
  }

  async loadChapter(id: string): Promise<EpubChapter> {
    if (this.chapterCache.has(id)) {
      return this.chapterCache.get(id)!;
    }

    const item = this.manifest[id];
    if (!item) return { html: "" };

    const rawHtml = await this.readFile(item.href);
    const htmlDir = dirnamePosix(item.href);

    // Extract body content
    const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    let bodyHtml = bodyMatch ? bodyMatch[1] : rawHtml;

    // Rewrite resource URLs in body
    bodyHtml = this.rewriteResourceUrls(bodyHtml, htmlDir);

    // Extract CSS links
    const css: { id: string; href: string; epubPath: string }[] = [];
    const headMatch = rawHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    if (headMatch) {
      const linkRe = /<link[^>]*href\s*=\s*["']([^"']+\.css)["'][^>]*\/?>/gi;
      let lm;
      while ((lm = linkRe.exec(headMatch[1])) !== null) {
        const cssHref = joinPosix(htmlDir, lm[1]);
        const cssName = cssHref.replace(/\//g, "_");
        const cssPath = resolve(this.resourceSaveDir, cssName);
        // Rewrite url() references in CSS if the file exists on disk
        try {
          if (existsSync(cssPath)) {
            const { readFileSync: readFs } = await import("fs");
            let cssContent = readFs(cssPath, "utf-8");
            cssContent = cssContent.replace(/url\(([^)]*)\)/g, (_, url: string) => {
              url = url.replace(/['"]/g, "").trim();
              if (url.startsWith("data:") || url.startsWith("http")) return `url(${url})`;
              const resolvedUrl = joinPosix(dirnamePosix(cssHref), url).replace(/\//g, "_");
              const resolvedPath = resolve(this.resourceSaveDir, resolvedUrl);
              return `url(${resolvedPath})`;
            });
            writeFileSync(cssPath, cssContent);
          }
        } catch {
          // CSS rewriting is non-fatal
        }
        css.push({ id: cssName, href: cssPath, epubPath: cssHref });
      }
    }

    const chapter: EpubChapter = { html: bodyHtml, css };
    this.chapterCache.set(id, chapter);
    return chapter;
  }

  getCoverImage(): string {
    // Method 1: manifest item with properties="cover-image"
    const coverImageItem = Object.values(this.manifest).find(
      (item) => item.properties.includes("cover-image"),
    );
    if (coverImageItem) {
      const fileName = coverImageItem.href.replace(/\//g, "_");
      return resolve(this.resourceSaveDir, fileName);
    }

    // Method 2: meta cover tag
    const coverId = this.metadata?.metas?.["cover"];
    if (coverId && this.manifest[coverId]) {
      const item = this.manifest[coverId];
      const fileName = item.href.replace(/\//g, "_");
      return resolve(this.resourceSaveDir, fileName);
    }

    // Method 3: look for common cover filenames in manifest
    const coverPatterns = [/cover\.(jpe?g|png|gif|webp|svg)$/i, /cover[-_]?image/i];
    for (const pattern of coverPatterns) {
      const item = Object.values(this.manifest).find(
        (it) => it.mediaType.startsWith("image/") && pattern.test(it.href),
      );
      if (item) {
        const fileName = item.href.replace(/\//g, "_");
        return resolve(this.resourceSaveDir, fileName);
      }
    }

    return "";
  }

  async getResource(resourcePath: string): Promise<Buffer | null> {
    // Try multiple path resolutions
    const pathsToTry = [
      resourcePath,
      joinPosix(this.opfDir, resourcePath),
      `OEBPS/${resourcePath}`,
      `OPS/${resourcePath}`,
      `EPUB/${resourcePath}`,
      resourcePath.replace(/^\/+/, ""),
    ];

    for (const p of pathsToTry) {
      const actual = this.getActualName(p);
      if (actual) {
        const file = this.zip.file(actual);
        if (file) {
          const data = await file.async("nodebuffer");
          return data;
        }
      }
    }

    // Try by filename
    const fileName = resourcePath.split("/").pop();
    if (fileName) {
      for (const [, actual] of this.namesMap) {
        if (actual.endsWith(`/${fileName}`) || actual === fileName) {
          const file = this.zip.file(actual);
          if (file) {
            return await file.async("nodebuffer");
          }
        }
      }
    }

    return null;
  }

  destroy() {
    for (const filePath of this.savedPaths) {
      try {
        if (existsSync(filePath)) unlinkSync(filePath);
      } catch {
        // Ignore cleanup errors
      }
    }
    this.savedPaths.length = 0;
    this.chapterCache.clear();
  }

  // ── Resource URL rewriting ──

  private rewriteResourceUrls(html: string, htmlDir: string): string {
    // Rewrite <img>, <video>, <audio>, <source> src
    html = html.replace(/<(img|video|audio|source)([^>]*)>/gi, (_tag, _tagName, attrs: string) => {
      const srcMatch = attrs.match(/src\s*=\s*["']([^"']+)["']/i);
      if (srcMatch) {
        const src = srcMatch[1];
        if (!src.startsWith("http") && !src.startsWith("data:")) {
          const resolved = joinPosix(htmlDir, src).replace(/\//g, "_");
          const newSrc = resolve(this.resourceSaveDir, resolved);
          attrs = attrs.replace(srcMatch[0], `src="${newSrc}"`);
        }
      }
      const posterMatch = attrs.match(/poster\s*=\s*["']([^"']+)["']/i);
      if (posterMatch) {
        const poster = posterMatch[1];
        if (!poster.startsWith("http") && !poster.startsWith("data:")) {
          const resolved = joinPosix(htmlDir, poster).replace(/\//g, "_");
          const newPoster = resolve(this.resourceSaveDir, resolved);
          attrs = attrs.replace(posterMatch[0], `poster="${newPoster}"`);
        }
      }
      return `<${_tagName}${attrs}>`;
    });

    // Rewrite <image> xlink:href (SVG)
    html = html.replace(/<image([^>]*)>/gi, (_tag, attrs: string) => {
      const hrefMatch = attrs.match(/(?:xlink:)?href\s*=\s*["']([^"']+)["']/i);
      if (hrefMatch) {
        const href = hrefMatch[1];
        if (!href.startsWith("http") && !href.startsWith("data:")) {
          const resolved = joinPosix(htmlDir, href).replace(/\//g, "_");
          const newHref = resolve(this.resourceSaveDir, resolved);
          attrs = attrs.replace(hrefMatch[0], hrefMatch[0].replace(href, newHref));
        }
      }
      return `<image${attrs}>`;
    });

    return html;
  }
}

// ── Utility functions ──

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

/** Extract content of the outermost occurrence of a tag, handling nested same-tags */
function extractOutermostTag(html: string, tagName: string): string | null {
  const openRe = new RegExp(`<${tagName}(\\s[^>]*)?>`, "gi");
  const firstOpen = openRe.exec(html);
  if (!firstOpen) return null;

  const contentStart = firstOpen.index + firstOpen[0].length;
  let depth = 1;
  // Scan for open/close tags after the first open
  const combinedRe = new RegExp(`<(/?)(${tagName})(\\s[^>]*)?>`, "gi");
  combinedRe.lastIndex = contentStart;
  let m;
  while ((m = combinedRe.exec(html)) !== null) {
    if (m[1] === "/") {
      depth--;
      if (depth === 0) {
        return html.substring(contentStart, m.index);
      }
    } else {
      depth++;
    }
  }
  // If no matching close found, return everything after the open tag
  return html.substring(contentStart);
}

/** Split top-level <li> items from an <ol> block */
function splitLiItems(olContent: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let current = "";
  let inLi = false;

  // Simple tag-based splitter
  const tagRe = /<(\/?)li(\s[^>]*)?>/gi;
  let lastIdx = 0;
  let m;

  while ((m = tagRe.exec(olContent)) !== null) {
    const isClose = m[1] === "/";
    if (!isClose) {
      if (depth === 0) {
        inLi = true;
        lastIdx = m.index + m[0].length;
        current = "";
      }
      depth++;
    } else {
      depth--;
      if (depth === 0 && inLi) {
        current = olContent.substring(lastIdx, m.index);
        items.push(current);
        inLi = false;
      }
    }
  }

  return items;
}

/** Split top-level <navPoint> elements */
function splitNavPoints(xml: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let startIdx = -1;

  const tagRe = /<(\/?)navPoint(\s[^>]*)?(?:\/)?>|<navPoint(\s[^>]*)?\/>/gi;
  let m;

  while ((m = tagRe.exec(xml)) !== null) {
    const fullMatch = m[0];
    // Self-closing <navPoint ... />
    if (fullMatch.endsWith("/>") && !m[1]) {
      if (depth === 0) {
        items.push(fullMatch);
      }
      continue;
    }
    const isClose = m[1] === "/";
    if (!isClose) {
      if (depth === 0) {
        startIdx = m.index;
      }
      depth++;
    } else {
      depth--;
      if (depth === 0 && startIdx >= 0) {
        items.push(xml.substring(startIdx, m.index + m[0].length));
        startIdx = -1;
      }
    }
  }

  return items;
}

/** Get inner content of a navPoint (after the first navLabel+content, before closing tag) */
function getNavPointInnerContent(npXml: string): string | null {
  // Find nested navPoint elements within this navPoint
  // Remove the outer <navPoint> opening and closing tags, navLabel, and content
  const innerMatch = npXml.match(/<navPoint[^>]*>([\s\S]*)<\/navPoint>\s*$/i);
  if (!innerMatch) return null;
  const inner = innerMatch[1];
  // Check if there are nested navPoints
  if (/<navPoint[\s>]/i.test(inner)) {
    return inner;
  }
  return null;
}
