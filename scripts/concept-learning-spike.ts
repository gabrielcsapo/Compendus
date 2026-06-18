/**
 * Learning-signal validation spike — TIGHTENED.
 *
 * Cheap CPU-only learning signals on a REAL expository book (no embeddings, no
 * GLiNER):
 *   1. concepts (YAKE, stopword-filtered)
 *   2. salience — sequential novelty (deflate vs prior-passages dict) AFTER a
 *      boilerplate filter + skipping front matter (kills the position/ad bias)
 *   3. prerequisite order — compression asymmetry, DE-MEANED per concept to
 *      remove the frequency confound (a frequent concept covers everything; we
 *      want its SPECIFIC coverage beyond its own breadth)
 *
 *   tsx scripts/concept-learning-spike.ts [path.txt|path.epub]
 */
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { parse } from "node-html-parser";
import { extractKeyphrases } from "../app/lib/knowledge/keyphrase";

const input = process.argv[2] || `${process.env.HOME}/Downloads/gsie.txt`;
const t0 = Date.now();

let text = "";
if (/\.txt$/i.test(input)) text = readFileSync(input, "utf8");
else {
  const dir = mkdtempSync(join(tmpdir(), "spike-"));
  execSync(`unzip -o -q "${input}" -d "${dir}"`);
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((n) => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? walk(p) : /\.(x?html?|htm)$/i.test(n) ? [p] : [];
    });
  for (const f of walk(dir).sort()) {
    const root = parse(readFileSync(f, "utf8"));
    root.querySelectorAll("script,style").forEach((n) => n.remove());
    text += " " + root.text;
  }
  rmSync(dir, { recursive: true, force: true });
}
text = text.replace(/\s+/g, " ").trim();

function chunk(s: string, size = 700): string[] {
  const out: string[] = [];
  let cur = "";
  for (const sent of s.split(/(?<=[.!?])\s+/)) {
    if ((cur + " " + sent).length > size && cur) {
      out.push(cur.trim());
      cur = sent;
    } else cur += " " + sent;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((p) => p.length > 80);
}
const passages = chunk(text);
const N = passages.length;

// cheap boilerplate filter (stands in for proseScore): citations, legal, tables
function isBoilerplate(p: string): boolean {
  const digits = (p.match(/\d/g) || []).length / p.length;
  const caps = (p.match(/[A-Z]/g) || []).length / (p.match(/[a-zA-Z]/g) || [1]).length;
  return (
    digits > 0.12 ||
    caps > 0.38 ||
    /\b(isbn|copyright|trademark|all rights reserved|no responsibility|no liability|catalog|price discount)\b/i.test(
      p,
    )
  );
}

const STOP = new Set(
  (
    "the a an and or but if then so of to in on at for with as by from into out up down over the " +
    "is are was were be been being this that these those it its their there here you your we our they " +
    "them he she his her i me my will can may might would could should must do does did done not no yes " +
    "very just only also more most some any each other such than too s t re ve ll d m like said want " +
    "know really still something enough needed wanted get got one way thing things use used using make " +
    "made many much how when where which who what why about between both read book author page chapter " +
    "figure shown shows see also let now well good new first next another part end"
  ).split(" "),
);
const clean = (p: string): string[] =>
  extractKeyphrases(p, 8)
    .map((k) => k.normalized)
    .filter(
      (c) =>
        c.length >= 3 && !/^\d+$/.test(c) && c.split(" ").some((w) => w.length > 2 && !STOP.has(w)),
    );

const concepts: string[][] = passages.map(clean);
const df = new Map<string, number>();
const firstSeen = new Map<string, number>();
const display = new Map<string, string>();
passages.forEach((p, i) => {
  for (const c of new Set(concepts[i])) {
    df.set(c, (df.get(c) || 0) + 1);
    if (!firstSeen.has(c)) firstSeen.set(c, i);
  }
  for (const k of extractKeyphrases(p, 8))
    if (!display.has(k.normalized)) display.set(k.normalized, k.phrase);
});

// salience: sequential novelty over NON-boilerplate body passages
let prior = "";
const novelty = passages.map((p, i) => {
  const dict = Buffer.from(prior.slice(-32000));
  const sz = prior
    ? deflateSync(Buffer.from(p), { dictionary: dict }).length
    : deflateSync(Buffer.from(p)).length;
  prior += " " + p;
  return { i, bpc: (sz * 8) / p.length, boiler: isBoilerplate(p), lead: concepts[i].slice(0, 4) };
});

// prerequisite order — DE-MEANED compression asymmetry over top concepts
const topConcepts = [...df.entries()]
  .filter(([c]) => df.get(c)! >= 3 && c.split(" ").length <= 2)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 14)
  .map(([c]) => c);
const ctext = new Map(
  topConcepts.map((c) => [
    c,
    passages
      .filter((_, i) => concepts[i].includes(c))
      .join(" ")
      .slice(0, 40000),
  ]),
);
const csize = (s: string, d?: Buffer) =>
  deflateSync(Buffer.from(s), d ? { dictionary: d } : {}).length;
const help = (a: string, b: string) => {
  const B = ctext.get(b)!;
  const base = csize(B);
  return (base - csize(B, Buffer.from(ctext.get(a)!.slice(-32000)))) / base;
};
const H = new Map<string, Map<string, number>>();
for (const a of topConcepts) {
  const m = new Map<string, number>();
  for (const b of topConcepts) if (a !== b) m.set(b, help(a, b));
  H.set(a, m);
}
const broad = new Map(
  topConcepts.map((a) => [
    a,
    [...H.get(a)!.values()].reduce((s, v) => s + v, 0) / (topConcepts.length - 1),
  ]),
);
// dependency(a->b) = a's coverage of b BEYOND a's general breadth
const power = new Map<string, number>();
for (const a of topConcepts) {
  let net = 0;
  for (const b of topConcepts)
    if (a !== b) net += H.get(a)!.get(b)! - broad.get(a)! - (H.get(b)!.get(a)! - broad.get(b)!);
  power.set(a, net);
}

const snip = (s: string, n = 110) => (s.length > n ? s.slice(0, n) + "…" : s);
console.log(`\n=== learning spike (tightened) — ${input.split("/").pop()} ===`);
console.log(
  `${(text.length / 1000).toFixed(0)}k chars → ${N} passages → ${df.size} concepts · ${Date.now() - t0}ms · rss ${Math.round(process.memoryUsage().rss / 1048576)}MB`,
);

console.log(`\n[1] TOP CONCEPTS (df):`);
console.log(
  [...df.entries()]
    .filter(([c]) => c.split(" ").length <= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24)
    .map(([c, n]) => `${display.get(c) || c}(${n})`)
    .join("  ·  "),
);

console.log(
  `\n[2] SALIENCE — 8 highest-novelty BODY passages (boilerplate filtered, front matter skipped):`,
);
for (const s of novelty
  .filter((s) => !s.boiler && s.i > 3)
  .sort((a, b) => b.bpc - a.bpc)
  .slice(0, 8))
  console.log(`  bpc=${s.bpc.toFixed(2)} [${s.lead.join(", ")}]  ${snip(passages[s.i])}`);

console.log(`\n[3] PREREQUISITE ORDER (de-meaned compression asymmetry, teach-first → last):`);
for (const [c, p] of [...power.entries()].sort((a, b) => b[1] - a[1]))
  console.log(
    `    ${p >= 0 ? "+" : ""}${p.toFixed(3)}  df=${String(df.get(c)).padStart(2)}  pos=${(firstSeen.get(c)! / N).toFixed(2)}  ${display.get(c) || c}`,
  );
