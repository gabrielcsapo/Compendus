/**
 * Validation spike for the concept-centric + compression substrate (the rewrite).
 *
 * Takes a REAL book, builds the cheap signals — concepts (YAKE keyphrases),
 * compression-based salience (zstd/deflate against a corpus dictionary), and a
 * first-cut concept "prerequisite" ordering — with NO embeddings and NO GLiNER.
 * The point is to eyeball whether the cheap, CPU-only signals produce sensible
 * structure on real text before committing to the rewrite.
 *
 *   tsx scripts/concept-spike.ts [path-to-epub]
 */
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { parse } from "node-html-parser";
import { extractKeyphrases } from "../app/lib/knowledge/keyphrase";

const epub = process.argv[2] || "data/books/c44e8234-a118-4dfa-825e-eeba6c480230.epub";
const t0 = Date.now();

// --- 1. extract text from the epub (unzip + strip tags, file order) ----------
const dir = mkdtempSync(join(tmpdir(), "spike-"));
execSync(`unzip -o -q "${epub}" -d "${dir}"`);
function walk(d: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(x?html?|htm)$/i.test(name)) out.push(p);
  }
  return out;
}
const files = walk(dir).sort();
let text = "";
for (const f of files) {
  const root = parse(readFileSync(f, "utf8"));
  root.querySelectorAll("script,style").forEach((n) => n.remove());
  text += " " + root.text.replace(/\s+/g, " ");
}
rmSync(dir, { recursive: true, force: true });
text = text.replace(/\s+/g, " ").trim();

// --- 2. chunk into ~700-char passages on sentence boundaries -----------------
function chunk(s: string, size = 700): string[] {
  const sents = s.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  let cur = "";
  for (const sent of sents) {
    if ((cur + " " + sent).length > size && cur) {
      out.push(cur.trim());
      cur = sent;
    } else cur += " " + sent;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((p) => p.length > 80);
}
const passages = chunk(text);

// --- 3. concepts per passage (YAKE keyphrases) -------------------------------
const tk0 = Date.now();
const concepts: string[][] = passages.map((p) => extractKeyphrases(p, 6).map((k) => k.normalized));
const keyphraseMs = Date.now() - tk0;

const df = new Map<string, number>(); // document frequency
const firstSeen = new Map<string, number>(); // first passage index
const display = new Map<string, string>();
passages.forEach((p, i) => {
  const seen = new Set(concepts[i]);
  for (const c of seen) {
    df.set(c, (df.get(c) || 0) + 1);
    if (!firstSeen.has(c)) firstSeen.set(c, i);
  }
  for (const k of extractKeyphrases(p, 6))
    if (!display.has(k.normalized)) display.set(k.normalized, k.phrase);
});
const N = passages.length;
const idf = (c: string) => Math.log(N / (df.get(c) || 1));

// --- 4. compression salience: bits/char given a corpus dictionary ------------
// A ~32KB dictionary sampled across the book primes the compressor with the
// book's vocabulary; a passage that still compresses well (low bits/char) is
// redundant/boilerplate, one that resists is information-dense.
const sampleStep = Math.max(1, Math.floor(passages.length / 60));
let dictStr = "";
for (let i = 0; i < passages.length && dictStr.length < 32000; i += sampleStep)
  dictStr += passages[i] + " ";
const dictionary = Buffer.from(dictStr.slice(-32000));
function bitsPerChar(p: string): number {
  const sz = deflateSync(Buffer.from(p), { dictionary }).length;
  return (sz * 8) / p.length;
}
const salience = passages.map((p, i) => ({
  i,
  bpc: bitsPerChar(p),
  conceptIdf: concepts[i].reduce((s, c) => s + idf(c), 0),
  text: p,
}));

// --- 5. report ---------------------------------------------------------------
const snip = (s: string, n = 140) => (s.length > n ? s.slice(0, n) + "…" : s);
console.log(`\n=== concept spike — ${epub.split("/").pop()} ===`);
console.log(
  `text ${(text.length / 1000).toFixed(0)}k chars → ${N} passages → ${df.size} distinct concepts`,
);
console.log(
  `keyphrase pass: ${keyphraseMs}ms (${(keyphraseMs / N).toFixed(2)}ms/passage) · total ${Date.now() - t0}ms · rss ${Math.round(process.memoryUsage().rss / 1048576)}MB\n`,
);

console.log("TOP 25 CONCEPTS (by document frequency):");
const top = [...df.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
console.log(top.map(([c, n]) => `${display.get(c) || c} (${n})`).join("  ·  "));

console.log("\nSALIENCE — 8 LEAST salient passages (should be boilerplate/citations/TOC):");
for (const s of [...salience].sort((a, b) => a.bpc - b.bpc).slice(0, 8))
  console.log(`  bpc=${s.bpc.toFixed(2)}  ${snip(s.text)}`);
console.log("\nSALIENCE — 8 MOST salient passages (should be substantive prose):");
for (const s of [...salience].sort((a, b) => b.bpc - a.bpc).slice(0, 8))
  console.log(`  bpc=${s.bpc.toFixed(2)}  ${snip(s.text)}`);

console.log(
  "\nCONCEPT PREREQUISITE ORDERING (top-30 concepts by df, ordered by first appearance):",
);
console.log("  position(0-1)  df   concept   [foundational = early+broad, advanced = late/narrow]");
const ordered = top
  .concat([...df.entries()].sort((a, b) => b[1] - a[1]).slice(25, 30))
  .sort((a, b) => firstSeen.get(a[0])! - firstSeen.get(b[0])!);
for (const [c, n] of ordered)
  console.log(
    `  ${(firstSeen.get(c)! / N).toFixed(2)}          ${String(n).padStart(3)}  ${display.get(c) || c}`,
  );
