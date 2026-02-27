/**
 * Custom MOBI parser — zero external dependencies, Node.js only.
 *
 * Supports MOBI7 (version 6) files with PalmDOC or HUFF/CDIC compression.
 * Replaces the unmaintained @lingo-reader/mobi-parser package.
 */
import {
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MobiSpineItem {
  id: string;
  text: string;
  start: number;
  end: number | undefined;
  size: number;
}

export interface MobiTocItem {
  label: string;
  href: string;
  children?: MobiTocItem[];
}

export interface MobiMetadata {
  identifier: string;
  title: string;
  author: string[];
  publisher: string;
  language: string;
  published: string;
  description: string;
  subject: string[];
  rights: string;
  contributor: string[];
}

export interface MobiProcessedChapter {
  html: string;
  css: Array<{ id: string; href: string }>;
}

export interface MobiParser {
  getFileInfo(): { fileName: string };
  getSpine(): MobiSpineItem[];
  getToc(): MobiTocItem[];
  getMetadata(): MobiMetadata;
  loadChapter(id: string): MobiProcessedChapter | undefined;
  getCoverImage(): string;
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const mobiEncoding: Record<number, string> = {
  1252: "windows-1252",
  65001: "utf-8",
};

/* prettier-ignore */
const mobiLang: Record<number, (string | null)[]> = {
  1:["ar","ar-SA","ar-IQ","ar-EG","ar-LY","ar-DZ","ar-MA","ar-TN","ar-OM","ar-YE","ar-SY","ar-JO","ar-LB","ar-KW","ar-AE","ar-BH","ar-QA"],
  2:["bg"],3:["ca"],4:["zh","zh-TW","zh-CN","zh-HK","zh-SG"],5:["cs"],6:["da"],
  7:["de","de-DE","de-CH","de-AT","de-LU","de-LI"],8:["el"],
  9:["en","en-US","en-GB","en-AU","en-CA","en-NZ","en-IE","en-ZA","en-JM",null,"en-BZ","en-TT","en-ZW","en-PH"],
  10:["es","es-ES","es-MX",null,"es-GT","es-CR","es-PA","es-DO","es-VE","es-CO","es-PE","es-AR","es-EC","es-CL","es-UY","es-PY","es-BO","es-SV","es-HN","es-NI","es-PR"],
  11:["fi"],12:["fr","fr-FR","fr-BE","fr-CA","fr-CH","fr-LU","fr-MC"],13:["he"],14:["hu"],15:["is"],
  16:["it","it-IT","it-CH"],17:["ja"],18:["ko"],19:["nl","nl-NL","nl-BE"],
  20:["no","nb","nn"],21:["pl"],22:["pt","pt-BR","pt-PT"],23:["rm"],24:["ro"],25:["ru"],
  26:["hr",null,"sr"],27:["sk"],28:["sq"],29:["sv","sv-SE","sv-FI"],30:["th"],31:["tr"],
  32:["ur"],33:["id"],34:["uk"],35:["be"],36:["sl"],37:["et"],38:["lv"],39:["lt"],41:["fa"],
  42:["vi"],43:["hy"],44:["az"],45:["eu"],46:["hsb"],47:["mk"],48:["st"],49:["ts"],50:["tn"],
  52:["xh"],53:["zu"],54:["af"],55:["ka"],56:["fo"],57:["hi"],58:["mt"],59:["se"],62:["ms"],
  63:["kk"],65:["sw"],67:["uz",null,"uz-UZ"],68:["tt"],69:["bn"],70:["pa"],71:["gu"],72:["or"],
  73:["ta"],74:["te"],75:["kn"],76:["ml"],77:["as"],78:["mr"],79:["sa"],82:["cy","cy-GB"],
  83:["gl","gl-ES"],87:["kok"],97:["ne"],98:["fy"],
};

const MimeToExt: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "text/css": "css",
  "application/xml": "xml",
  "application/xhtml+xml": "xhtml",
  "text/html": "html",
  "video/mp4": "mp4",
  "video/mkv": "mkv",
  "video/webm": "webm",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "font/ttf": "ttf",
  "font/otf": "otf",
  "font/woff": "woff",
  "font/woff2": "woff2",
  "font/eot": "eot",
  unknown: "bin",
};

const fileSignatures: [string, string][] = [
  ["ffd8ff", "image/jpeg"],
  ["89504e47", "image/png"],
  ["47494638", "image/gif"],
  ["424d", "image/bmp"],
  ["3c737667", "image/svg+xml"],
  ["00000018", "video/mp4"],
  ["00000020", "video/mp4"],
  ["1a45dfa3", "video/mkv"],
  ["1f43b675", "video/webm"],
  ["494433", "audio/mp3"],
  ["52494646", "audio/wav"],
  ["4f676753", "audio/ogg"],
  ["00010000", "font/ttf"],
  ["74727565", "font/ttf"],
  ["4f54544f", "font/otf"],
  ["774f4646", "font/woff"],
  ["774f4632", "font/woff2"],
  ["504c", "font/eot"],
];

const exthRecordTypes: Record<
  number,
  [string, "string" | "uint", boolean]
> = {
  100: ["creator", "string", true],
  101: ["publisher", "string", false],
  103: ["description", "string", false],
  104: ["isbn", "string", false],
  105: ["subject", "string", true],
  106: ["date", "string", false],
  108: ["contributor", "string", true],
  109: ["rights", "string", false],
  110: ["subjectCode", "string", true],
  112: ["source", "string", true],
  113: ["asin", "string", false],
  121: ["boundary", "uint", false],
  122: ["fixedLayout", "string", false],
  125: ["numResources", "uint", false],
  201: ["coverOffset", "uint", false],
  202: ["thumbnailOffset", "uint", false],
  503: ["title", "string", false],
  524: ["language", "string", true],
  527: ["pageProgressionDirection", "string", false],
};

const htmlEntityMap: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
};

const mbpPagebreakRegex = /<\s*(?:mbp:)?pagebreak[^>]*>/gi;

// ---------------------------------------------------------------------------
// Binary helpers
// ---------------------------------------------------------------------------

function getUint(buf: ArrayBuffer): number {
  const l = buf.byteLength;
  const fn = l === 4 ? "getUint32" : l === 2 ? "getUint16" : "getUint8";
  return new DataView(buf)[fn](0);
}

function getString(buf: ArrayBuffer): string {
  return new TextDecoder().decode(buf);
}

type StructDef = Record<string, [number, number, "string" | "uint"]>;

function getStruct(
  def: StructDef,
  buf: ArrayBuffer,
): Record<string, string | number> {
  const res: Record<string, string | number> = {};
  for (const key in def) {
    const [start, len, type] = def[key];
    res[key] =
      type === "string"
        ? getString(buf.slice(start, start + len))
        : getUint(buf.slice(start, start + len));
  }
  return res;
}

function concatTypedArrays(arrays: Uint8Array<ArrayBufferLike>[]): Uint8Array {
  const totalLength = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

function getVarLenFromEnd(arr: Uint8Array): number {
  let value = 0;
  for (const byte of arr.subarray(-4)) {
    if (byte & 128) value = 0;
    value = (value << 7) | (byte & 127);
  }
  return value;
}

function countBitsSet(x: number): number {
  let count = 0;
  for (; x > 0; x = x >> 1) {
    if ((x & 1) === 1) count++;
  }
  return count;
}

function bufferToArrayBuffer(data: Uint8Array | Buffer): ArrayBuffer {
  // Create a fresh ArrayBuffer copy to avoid SharedArrayBuffer issues
  const copy = new Uint8Array(data);
  return copy.buffer as ArrayBuffer;
}

// ---------------------------------------------------------------------------
// Decompression
// ---------------------------------------------------------------------------

function decompressPalmDOC(array: Uint8Array): Uint8Array {
  const output: number[] = [];
  for (let i = 0; i < array.length; i++) {
    const byte = array[i];
    if (byte === 0) {
      output.push(0);
    } else if (byte <= 8) {
      for (const x of array.subarray(i + 1, (i += byte) + 1)) output.push(x);
    } else if (byte <= 127) {
      output.push(byte);
    } else if (byte <= 191) {
      const bytes = (byte << 8) | array[i++ + 1];
      const distance = (bytes & 16383) >>> 3;
      const length = (bytes & 7) + 3;
      for (let j = 0; j < length; j++) output.push(output[output.length - distance]);
    } else {
      output.push(32, byte ^ 128);
    }
  }
  return Uint8Array.from(output);
}

function read32Bits(byteArray: Uint8Array, from: number): bigint {
  const startByte = from >> 3;
  const end = from + 32;
  const endByte = end >> 3;
  let bits = 0n;
  for (let i = startByte; i <= endByte; i++) {
    bits = (bits << 8n) | BigInt(byteArray[i] ?? 0);
  }
  return (bits >> (8n - BigInt(end & 7))) & 0xffffffffn;
}

interface HuffCdicHeaders {
  huffcdic: number;
  numHuffcdic: number;
}

function setupHuffCdic(
  headers: HuffCdicHeaders,
  loadRecord: (i: number) => ArrayBuffer,
): (data: Uint8Array) => Uint8Array {
  const huffRecord = loadRecord(headers.huffcdic);
  const huffDef: StructDef = {
    magic: [0, 4, "string"],
    offset1: [8, 4, "uint"],
    offset2: [12, 4, "uint"],
  };
  const huffParsed = getStruct(huffDef, huffRecord);
  const magic = huffParsed.magic as string;
  const offset1 = huffParsed.offset1 as number;
  const offset2 = huffParsed.offset2 as number;
  if (magic !== "HUFF") throw new Error("Invalid HUFF record");

  const table1 = Array.from({ length: 256 }, (_, i) => offset1 + i * 4)
    .map((off) => getUint(huffRecord.slice(off, off + 4)))
    .map((x) => [x & 128, x & 31, x >>> 8] as [number, number, number]);

  const table2: [number, number][] = [
    [0, 0],
    ...Array.from({ length: 32 }, (_, i) => offset2 + i * 8).map(
      (off) =>
        [
          getUint(huffRecord.slice(off, off + 4)),
          getUint(huffRecord.slice(off + 4, off + 8)),
        ] as [number, number],
    ),
  ];

  const cdicDef: StructDef = {
    magic: [0, 4, "string"],
    length: [4, 4, "uint"],
    numEntries: [8, 4, "uint"],
    codeLength: [12, 4, "uint"],
  };

  const dictionary: [Uint8Array<ArrayBufferLike>, boolean][] = [];
  for (let i = 1; i < headers.numHuffcdic; i++) {
    const record = loadRecord(headers.huffcdic + i);
    const cdic = getStruct(cdicDef, record);
    if (cdic.magic !== "CDIC") throw new Error("Invalid CDIC record");
    const n = Math.min(
      1 << (cdic.codeLength as number),
      (cdic.numEntries as number) - dictionary.length,
    );
    const buf = record.slice(cdic.length as number);
    for (let j = 0; j < n; j++) {
      const off = getUint(buf.slice(j * 2, j * 2 + 2));
      const x = getUint(buf.slice(off, off + 2));
      const length = x & 32767;
      const decompressed = !!(x & 32768);
      const value = new Uint8Array(buf.slice(off + 2, off + 2 + length));
      dictionary.push([value, decompressed]);
    }
  }

  const decompress = (byteArray: Uint8Array<ArrayBufferLike>): Uint8Array => {
    let output: Uint8Array<ArrayBufferLike> = new Uint8Array();
    const bitLength = byteArray.byteLength * 8;
    for (let i = 0; i < bitLength; ) {
      const bits = Number(read32Bits(byteArray, i));
      let [found, codeLength, value] = table1[bits >>> 24];
      if (!found) {
        while (bits >>> (32 - codeLength) < table2[codeLength][0])
          codeLength += 1;
        value = table2[codeLength][1];
      }
      i += codeLength;
      if (i > bitLength) break;
      const code = value - (bits >>> (32 - codeLength));
      let [result, isDecompressed] = dictionary[code];
      if (!isDecompressed) {
        result = decompress(result);
        dictionary[code] = [result, true];
      }
      output = concatTypedArrays([output, result]);
    }
    return output;
  };

  return decompress;
}

// ---------------------------------------------------------------------------
// Trailing entry removal
// ---------------------------------------------------------------------------

function makeTrailingEntryRemover(
  trailingFlags: number,
): (arr: Uint8Array) => Uint8Array {
  const multibyte = trailingFlags & 1;
  const numTrailingEntries = countBitsSet(trailingFlags >>> 1);
  return (array: Uint8Array): Uint8Array => {
    for (let i = 0; i < numTrailingEntries; i++) {
      const length = getVarLenFromEnd(array);
      array = array.subarray(0, -length || array.length);
    }
    if (multibyte) {
      const length = (array[array.length - 1] & 3) + 1;
      array = array.subarray(0, -length);
    }
    return array;
  };
}

// ---------------------------------------------------------------------------
// EXTH parsing
// ---------------------------------------------------------------------------

function parseExth(
  buf: ArrayBuffer,
  encoding: number,
): Record<string, string | number | string[] | number[]> {
  const headerDef: StructDef = {
    magic: [0, 4, "string"],
    length: [4, 4, "uint"],
    count: [8, 4, "uint"],
  };
  const exthParsed = getStruct(headerDef, buf);
  if (exthParsed.magic !== "EXTH") throw new Error("Invalid EXTH header");
  const exthCount = exthParsed.count as number;

  const dec = new TextDecoder(mobiEncoding[encoding] ?? "utf-8");
  const results: Record<string, unknown> = {};
  let offset = 12;
  for (let i = 0; i < exthCount; i++) {
    const type = getUint(buf.slice(offset, offset + 4));
    const length = getUint(buf.slice(offset + 4, offset + 8));
    if (type in exthRecordTypes) {
      const [name, typ, isMany] = exthRecordTypes[type];
      const data = buf.slice(offset + 8, offset + length);
      const value = typ === "uint" ? getUint(data) : dec.decode(data);
      if (isMany) {
        (results[name] as unknown[]) ??= [];
        (results[name] as unknown[]).push(value);
      } else {
        results[name] = value;
      }
    }
    offset += length;
  }
  return results as Record<string, string | number | string[] | number[]>;
}

// ---------------------------------------------------------------------------
// Resource helpers
// ---------------------------------------------------------------------------

function getFileMimeType(data: Uint8Array): string {
  const hex = Array.from(data.subarray(0, 12))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  for (const [sig, mime] of fileSignatures) {
    if (hex.startsWith(sig)) return mime;
  }
  return "unknown";
}

function saveResourceToDisk(
  data: Uint8Array,
  mimeType: string,
  filename: string,
  dir: string,
): string {
  const ext = MimeToExt[mimeType] ?? "bin";
  const fullPath = resolve(dir, `${filename}.${ext}`);
  writeFileSync(fullPath, data);
  return fullPath;
}

// ---------------------------------------------------------------------------
// HTML entity unescaping
// ---------------------------------------------------------------------------

function unescapeHTML(str: string): string {
  if (!str.includes("&")) return str;
  return str.replace(
    /&(#x[\dA-Fa-f]+|#\d+|[a-zA-Z]+);/g,
    (match, entity: string) => {
      if (entity.startsWith("#x"))
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      if (entity.startsWith("#"))
        return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      return htmlEntityMap[match] ?? match;
    },
  );
}

// ---------------------------------------------------------------------------
// TOC extraction — regex-based, tolerant of malformed HTML
// ---------------------------------------------------------------------------

function extractTocFromChapter(chapterText: string): MobiTocItem[] {
  const toc: MobiTocItem[] = [];
  const linkRegex =
    /<a[^>]*filepos\s*=\s*["']?(\d+)["']?[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(chapterText)) !== null) {
    const filepos = match[1];
    const rawLabel = match[2];
    // Strip nested HTML tags from label
    const label = rawLabel.replace(/<[^>]+>/g, "").trim();
    if (label) {
      toc.push({ label: unescapeHTML(label), href: `filepos:${filepos}` });
    }
  }
  return toc;
}

function findTocChapter(
  preamble: string,
  chapters: { text: string; start: number; end: number | undefined }[],
): { text: string } | undefined {
  // Look for <reference type="toc" filepos="NNN" />
  const refRegex = /<reference[^>]*type\s*=\s*["']?toc["']?[^>]*>/gi;
  const refs = preamble.match(refRegex);
  if (refs) {
    for (const ref of refs) {
      const fileposMatch = ref.match(/filepos\s*=\s*["']?(\d+)["']?/i);
      if (fileposMatch) {
        const tocPos = parseInt(fileposMatch[1], 10);
        const chapter = chapters.find(
          (ch) =>
            ch.start <= tocPos &&
            (ch.end === undefined || ch.end > tocPos),
        );
        if (chapter) return chapter;
      }
    }
  }
  // Fallback: find a chapter that looks like a TOC (many <a filepos=...> links)
  for (const ch of chapters) {
    const links = ch.text.match(/<a[^>]*filepos\s*=\s*/gi);
    if (links && links.length >= 3) return ch;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Main parser implementation
// ---------------------------------------------------------------------------

interface PdbHeader {
  name: string;
  type: string;
  creator: string;
  numRecords: number;
}

interface PalmDocHeader {
  compression: number;
  numTextRecords: number;
  recordSize: number;
  encryption: number;
}

interface MobiHeaderRaw {
  magic: string;
  length: number;
  type: number;
  encoding: number;
  uid: number;
  version: number;
  titleOffset: number;
  titleLength: number;
  localeRegion: number;
  localeLanguage: number;
  resourceStart: number;
  huffcdic: number;
  numHuffcdic: number;
  exthFlag: number;
  trailingFlags: number;
  indx: number;
}

const pdbHeaderDef: StructDef = {
  name: [0, 32, "string"],
  type: [60, 4, "string"],
  creator: [64, 4, "string"],
  numRecords: [76, 2, "uint"],
};

const palmdocHeaderDef: StructDef = {
  compression: [0, 2, "uint"],
  numTextRecords: [8, 2, "uint"],
  recordSize: [10, 2, "uint"],
  encryption: [12, 2, "uint"],
};

const mobiHeaderDef: StructDef = {
  magic: [16, 4, "string"],
  length: [20, 4, "uint"],
  type: [24, 4, "uint"],
  encoding: [28, 4, "uint"],
  uid: [32, 4, "uint"],
  version: [36, 4, "uint"],
  titleOffset: [84, 4, "uint"],
  titleLength: [88, 4, "uint"],
  localeRegion: [94, 1, "uint"],
  localeLanguage: [95, 1, "uint"],
  resourceStart: [108, 4, "uint"],
  huffcdic: [112, 4, "uint"],
  numHuffcdic: [116, 4, "uint"],
  exthFlag: [128, 4, "uint"],
  trailingFlags: [240, 4, "uint"],
  indx: [244, 4, "uint"],
};

class MobiFile implements MobiParser {
  private arrayBuffer: ArrayBuffer;
  private pdb!: PdbHeader;
  private palmdoc!: PalmDocHeader;
  private mobi!: MobiHeaderRaw;
  private exth: Record<string, unknown> = {};
  private recordOffsets: number[] = [];
  private chapters: MobiSpineItem[] = [];
  private idToChapter = new Map<number, MobiSpineItem>();
  private toc: MobiTocItem[] = [];
  private chapterCache = new Map<number, MobiProcessedChapter>();
  private resourceCache = new Map<string, string>();
  private resourceSaveDir: string;
  private textDecoder!: TextDecoder;
  private title = "";

  private recindexRegex = /recindex\s*=\s*["']?(\d+)["']?/;

  constructor(data: Uint8Array | Buffer, resourceSaveDir?: string) {
    this.arrayBuffer = bufferToArrayBuffer(
      data instanceof Buffer ? new Uint8Array(data) : data,
    );
    this.resourceSaveDir = resourceSaveDir ?? "./images";
    if (!existsSync(this.resourceSaveDir)) {
      mkdirSync(this.resourceSaveDir, { recursive: true });
    }
  }

  // -- Public API -----------------------------------------------------------

  getFileInfo() {
    return { fileName: this.title };
  }

  getSpine(): MobiSpineItem[] {
    return this.chapters;
  }

  getToc(): MobiTocItem[] {
    return this.toc;
  }

  getMetadata(): MobiMetadata {
    const e = this.exth as Record<string, unknown>;
    const titleFromExth = e.title as string | undefined;
    const langFromExth = e.language as string[] | string | undefined;
    const lang = Array.isArray(langFromExth)
      ? langFromExth[0]
      : (langFromExth as string | undefined);

    const localeLanguage =
      lang ??
      (mobiLang[this.mobi.localeLanguage]?.[this.mobi.localeRegion] ||
        mobiLang[this.mobi.localeLanguage]?.[0]) ??
      "";

    return {
      identifier: String(this.mobi.uid),
      title: titleFromExth ?? this.title,
      author: this.asStringArray(e.creator),
      publisher: (e.publisher as string) ?? "",
      language: localeLanguage,
      published: (e.date as string) ?? "",
      description: (e.description as string) ?? "",
      subject: this.asStringArray(e.subject),
      rights: (e.rights as string) ?? "",
      contributor: this.asStringArray(e.contributor),
    };
  }

  loadChapter(id: string): MobiProcessedChapter | undefined {
    const numId = parseInt(id, 10);
    if (Number.isNaN(numId)) return undefined;
    if (this.chapterCache.has(numId)) return this.chapterCache.get(numId)!;
    const chapter = this.idToChapter.get(numId);
    if (!chapter) return undefined;
    const processed = this.processChapterHtml(chapter.text);
    this.chapterCache.set(numId, processed);
    return processed;
  }

  getCoverImage(): string {
    if (this.resourceCache.has("cover")) return this.resourceCache.get("cover")!;
    const coverOffset =
      (this.exth as Record<string, unknown>).coverOffset ??
      (this.exth as Record<string, unknown>).thumbnailOffset;
    if (coverOffset === undefined || typeof coverOffset !== "number") return "";
    try {
      const resourceData = this.loadResourceRecord(coverOffset);
      if (!resourceData) return "";
      const mimeType = getFileMimeType(new Uint8Array(resourceData));
      if (mimeType === "unknown") return "";
      const path = saveResourceToDisk(
        new Uint8Array(resourceData),
        mimeType,
        "cover",
        this.resourceSaveDir,
      );
      this.resourceCache.set("cover", path);
      return path;
    } catch {
      return "";
    }
  }

  destroy(): void {
    this.chapterCache.clear();
    this.resourceCache.clear();
    // Clean up saved resources
    try {
      if (existsSync(this.resourceSaveDir)) {
        const files = readdirSync(this.resourceSaveDir);
        for (const f of files) {
          try {
            unlinkSync(resolve(this.resourceSaveDir, f));
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore cleanup errors
    }
  }

  // -- Initialization -------------------------------------------------------

  async init(): Promise<void> {
    this.parsePdbHeader();
    this.parseRecord0();
    await this.extractAndSplitText();
  }

  private parsePdbHeader(): void {
    this.pdb = getStruct(pdbHeaderDef, this.arrayBuffer) as unknown as PdbHeader;
    const numRecords = this.pdb.numRecords;
    this.recordOffsets = [];
    for (let i = 0; i < numRecords; i++) {
      const off = 78 + i * 8;
      this.recordOffsets.push(getUint(this.arrayBuffer.slice(off, off + 4)));
    }
  }

  private parseRecord0(): void {
    const record0 = this.getRecord(0);

    // PalmDOC header (first 16 bytes)
    this.palmdoc = getStruct(palmdocHeaderDef, record0) as unknown as PalmDocHeader;
    if (this.palmdoc.encryption !== 0) {
      throw new Error(
        "Encrypted MOBI files are not supported. The file requires a DRM key.",
      );
    }

    // MOBI header (starts at offset 16)
    // Only parse fields that exist within the header length
    this.mobi = getStruct(mobiHeaderDef, record0) as unknown as MobiHeaderRaw;
    if (this.mobi.magic !== "MOBI") {
      throw new Error("Invalid MOBI file: missing MOBI header magic");
    }

    // Encoding
    this.textDecoder = new TextDecoder(
      mobiEncoding[this.mobi.encoding] ?? "utf-8",
    );

    // Title from record 0
    try {
      const titleBuf = record0.slice(
        this.mobi.titleOffset,
        this.mobi.titleOffset + this.mobi.titleLength,
      );
      this.title = this.textDecoder.decode(titleBuf);
    } catch {
      this.title = this.pdb.name.replace(/\0/g, "").replace(/_/g, " ");
    }

    // EXTH header (if present)
    if (this.mobi.exthFlag & 0x40) {
      const exthOffset = 16 + this.mobi.length;
      try {
        this.exth = parseExth(
          record0.slice(exthOffset),
          this.mobi.encoding,
        );
      } catch {
        this.exth = {};
      }
    }
  }

  private async extractAndSplitText(): Promise<void> {
    // Set up decompression
    const loadRecord = (i: number) => this.getRecord(i);
    let decompress: (data: Uint8Array) => Uint8Array;

    if (this.palmdoc.compression === 2) {
      decompress = decompressPalmDOC;
    } else if (this.palmdoc.compression === 17480) {
      decompress = setupHuffCdic(
        {
          huffcdic: this.mobi.huffcdic,
          numHuffcdic: this.mobi.numHuffcdic,
        },
        loadRecord,
      );
    } else {
      // No compression or unknown — identity
      decompress = (d) => d;
    }

    // Set up trailing entry removal
    const removeTrailing = makeTrailingEntryRemover(
      this.mobi.trailingFlags,
    );

    // Decompress all text records
    const buffers: Uint8Array[] = [];
    for (let i = 1; i <= this.palmdoc.numTextRecords; i++) {
      try {
        const raw = new Uint8Array(this.getRecord(i));
        const trimmed = removeTrailing(raw);
        buffers.push(decompress(trimmed));
      } catch {
        // skip broken records
      }
    }
    const rawBytes = concatTypedArrays(buffers);

    // Build binary string (1 char = 1 byte) for filepos mapping
    const str = Array.from(rawBytes, (val) =>
      String.fromCharCode(val),
    ).join("");

    // Split by pagebreak markers
    const chapters: MobiSpineItem[] = [];
    const idToChapter = new Map<number, MobiSpineItem>();
    let id = 0;

    const matches = Array.from(str.matchAll(mbpPagebreakRegex));
    matches.unshift({
      index: 0,
      input: "",
      groups: undefined,
      0: "",
    } as unknown as RegExpExecArray);

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const start = match.index!;
      const matched = match[0];
      const end = matches[i + 1]?.index;
      const section = str.slice(start + matched.length, end);
      const buffer = Uint8Array.from(section, (c) => c.charCodeAt(0));
      const text = this.textDecoder.decode(buffer);
      const chapter: MobiSpineItem = {
        id: String(id),
        text,
        start,
        end,
        size: buffer.length,
      };
      chapters.push(chapter);
      idToChapter.set(id, chapter);
      id++;
    }

    if (chapters.length === 0) {
      // No pagebreaks found — treat entire text as single chapter
      const text = this.textDecoder.decode(rawBytes);
      const ch: MobiSpineItem = {
        id: "0",
        text,
        start: 0,
        end: undefined,
        size: rawBytes.length,
      };
      chapters.push(ch);
      idToChapter.set(0, ch);
    }

    // Trim last chapter: remove everything from </body> onward
    const lastCh = chapters[chapters.length - 1];
    const bodyCloseIdx = lastCh.text.indexOf("</body>");
    if (bodyCloseIdx !== -1) {
      lastCh.text = lastCh.text.slice(0, bodyCloseIdx);
    }

    // Trim first chapter: find <body and remove everything before and including it
    const firstCh = chapters[0];
    const bodyOpenIdx = firstCh.text.search(/<body[^>]*>/i);
    if (bodyOpenIdx !== -1) {
      const bodyTagEnd = firstCh.text.indexOf(">", bodyOpenIdx);
      if (bodyTagEnd !== -1) {
        // Save the preamble (before <body>) for TOC reference lookup
        const preamble = firstCh.text.slice(0, bodyOpenIdx);
        firstCh.text = firstCh.text.slice(bodyTagEnd + 1);

        // Extract TOC
        const tocChapter = findTocChapter(preamble, chapters);
        if (tocChapter) {
          this.toc = extractTocFromChapter(tocChapter.text);
        }
      }
    } else {
      // No <body> tag — try to find TOC anyway
      // Check for reference tags anywhere in the first chapter
      const tocChapter = findTocChapter(firstCh.text, chapters);
      if (tocChapter) {
        this.toc = extractTocFromChapter(tocChapter.text);
      }
    }

    this.chapters = chapters;
    this.idToChapter = idToChapter;
  }

  // -- Internal helpers -----------------------------------------------------

  private getRecord(index: number): ArrayBuffer {
    const offset = this.recordOffsets[index];
    const nextOffset =
      index + 1 < this.recordOffsets.length
        ? this.recordOffsets[index + 1]
        : this.arrayBuffer.byteLength;
    return this.arrayBuffer.slice(offset, nextOffset);
  }

  private loadResourceRecord(resourceIndex: number): ArrayBuffer | null {
    const recordIndex = this.mobi.resourceStart + resourceIndex;
    if (recordIndex >= this.recordOffsets.length) return null;
    return this.getRecord(recordIndex);
  }

  private processChapterHtml(text: string): MobiProcessedChapter {
    let html = text;

    // Replace <img recindex="N"> with saved resource paths
    html = html.replace(
      /<img([^>]*)>/gi,
      (match: string, attrs: string) => {
        const recMatch = attrs.match(this.recindexRegex);
        if (!recMatch) return match;
        const recIndex = parseInt(recMatch[1], 10) - 1; // recindex is 1-based
        const resourcePath = this.ensureResourceSaved(recIndex);
        if (!resourcePath) return match;
        // Replace recindex with src
        const newAttrs = attrs
          .replace(/recindex\s*=\s*["']?\d+["']?/gi, `src="${resourcePath}"`)
          .replace(
            /mediarecindex\s*=\s*["']?\d+["']?/gi,
            "",
          );
        return `<img${newAttrs}>`;
      },
    );

    // Replace filepos in anchors
    html = html.replace(
      /<a([^>]*)filepos\s*=\s*["']?(\d+)["']?([^>]*)>/gi,
      (_match: string, before: string, filepos: string, after: string) => {
        return `<a${before}href="filepos:${filepos}"${after}>`;
      },
    );

    return { html, css: [] };
  }

  private ensureResourceSaved(resourceIndex: number): string | null {
    const key = String(resourceIndex);
    if (this.resourceCache.has(key)) return this.resourceCache.get(key)!;
    try {
      const data = this.loadResourceRecord(resourceIndex);
      if (!data) return null;
      const bytes = new Uint8Array(data);
      const mimeType = getFileMimeType(bytes);
      if (mimeType === "unknown") return null;
      const path = saveResourceToDisk(
        bytes,
        mimeType,
        `resource-${resourceIndex}`,
        this.resourceSaveDir,
      );
      this.resourceCache.set(key, path);
      return path;
    } catch {
      return null;
    }
  }

  private asStringArray(val: unknown): string[] {
    if (Array.isArray(val)) return val.map(String);
    if (typeof val === "string") return [val];
    return [];
  }
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Parse a MOBI file (version 6 / MOBI7 format).
 */
export async function initMobiFile(
  file: Uint8Array | Buffer,
  resourceSaveDir?: string,
): Promise<MobiParser> {
  const parser = new MobiFile(file, resourceSaveDir);
  await parser.init();
  return parser;
}

/**
 * Stub for KF8/AZW3 parsing — not yet implemented.
 * Consumer code catches this error and falls back to MOBI7.
 */
export async function initKf8File(
  _file: Uint8Array | Buffer,
  _resourceSaveDir?: string,
): Promise<MobiParser> {
  throw new Error("KF8/AZW3 format is not supported by the custom parser");
}
