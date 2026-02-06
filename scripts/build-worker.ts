/**
 * Build script for the parser worker
 * Bundles the worker and its dependencies into a single JS file
 */
import { build } from "esbuild";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

async function buildWorker() {
  console.log("[Worker Build] Building parser worker...");

  const startTime = performance.now();

  await build({
    entryPoints: [join(rootDir, "app/lib/reader/parser-worker.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    outfile: join(rootDir, "dist/worker/parser-worker.mjs"),
    external: [
      // Node.js built-ins
      "fs",
      "fs/promises",
      "path",
      "url",
      "worker_threads",
      "crypto",
      "stream",
      "buffer",
      "util",
      "events",
      "os",
      "zlib",
      // Native modules that can't be bundled
      "better-sqlite3",
      "canvas",
      "sharp",
    ],
    // Ensure we can resolve all internal modules
    resolveExtensions: [".ts", ".js", ".mjs"],
    // Keep names for debugging
    keepNames: true,
    // Source maps for debugging
    sourcemap: true,
    // Log level
    logLevel: "info",
  });

  const duration = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`[Worker Build] Done in ${duration}s`);
}

buildWorker().catch((error) => {
  console.error("[Worker Build] Failed:", error);
  process.exit(1);
});
