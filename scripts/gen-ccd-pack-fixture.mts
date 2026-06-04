/**
 * Regenerate the iOS test fixture `moby-dick.ccdpack` — a real CCD pack produced
 * by the web pipeline (buildBundleFromEpub → buildCcdPack). The CCReader XCTest
 * `CCDPackTests` unpacks + renders it to guard server↔client CCD format drift.
 *
 * Run: pnpm exec tsx scripts/gen-ccd-pack-fixture.mts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildBundleFromEpub } from "../app/lib/content-ast/bundle";
import { buildCcdPack } from "../app/lib/processing/ccd-pack";

const src = resolve(import.meta.dirname, "..", "server/__fixtures__/epub/moby-dick.epub");
const out = resolve(
  import.meta.dirname,
  "..",
  "Compendus/CCReader/Tests/CCReaderTests/Samples/moby-dick.ccdpack",
);
const bundle = await buildBundleFromEpub(src, "moby", "epub");
writeFileSync(out, await buildCcdPack(bundle, readFileSync(src)));
console.log(`Wrote ${out}`);
