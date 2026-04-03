/**
 * Build script for worker threads
 * Bundles the parser worker and processing worker into standalone JS files
 */
import { build } from "esbuild";
import { copyFile, mkdir } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

const SHARED_EXTERNALS = [
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
  "tty",
  "net",
  "zlib",
  "child_process",
  // Native modules that can't be bundled
  "better-sqlite3",
  "canvas",
  "sharp",
  // CBR/RAR parsing - has dynamic requires that don't work when bundled
  "node-unrar-js",
  // PDF cover rendering via GraphicsMagick CLI wrapper - breaks when bundled
  "gm",
  "pdf2pic",
  // ZIP handling - CJS module with dynamic requires that break in ESM bundles
  "adm-zip",
  // pdfjs-dist - complex init that fails in esbuild's __esm lazy-init pattern
  "pdfjs-dist",
  "pdfjs-dist/legacy/build/pdf.mjs",
];

const SHARED_OPTIONS = {
  bundle: true as const,
  platform: "node" as const,
  target: "node20",
  format: "esm" as const,
  external: SHARED_EXTERNALS,
  resolveExtensions: [".ts", ".js", ".mjs"],
  keepNames: true,
  sourcemap: true,
  logLevel: "info" as const,
  // Provide `require` for bundled CJS modules that use require() for Node built-ins
  banner: {
    js: `import { createRequire as __createRequire } from "module"; const require = __createRequire(import.meta.url);`,
  },
};

async function buildWorkers() {
  const startTime = performance.now();

  // Build both workers in parallel
  await Promise.all([
    // Parser worker (for reader content parsing)
    build({
      ...SHARED_OPTIONS,
      entryPoints: [join(rootDir, "app/lib/reader/parser-worker.ts")],
      outfile: join(rootDir, "dist/worker/parser-worker.mjs"),
    }).then(() => console.log("[Worker Build] Built parser-worker.mjs")),

    // Processing worker (for upload metadata/cover extraction, CBR conversion)
    build({
      ...SHARED_OPTIONS,
      entryPoints: [join(rootDir, "app/lib/processing/processing-worker.ts")],
      outfile: join(rootDir, "dist/worker/processing-worker.mjs"),
    }).then(() => console.log("[Worker Build] Built processing-worker.mjs")),
  ]);

  // Copy pdf.worker.mjs to dist/worker directory
  // pdfjs-dist requires this worker file to exist alongside the bundled parser-worker
  const pdfWorkerSrc = join(rootDir, "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");
  const pdfWorkerDest = join(rootDir, "dist/worker/pdf.worker.mjs");

  await mkdir(dirname(pdfWorkerDest), { recursive: true });
  await copyFile(pdfWorkerSrc, pdfWorkerDest);
  console.log("[Worker Build] Copied pdf.worker.mjs to dist/worker/");

  const duration = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`[Worker Build] Done in ${duration}s`);
}

buildWorkers().catch((error) => {
  console.error("[Worker Build] Failed:", error);
  process.exit(1);
});
