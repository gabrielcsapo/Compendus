/**
 * Bundle fabric kernels: each kernels/src/<name>.ts becomes a self-contained,
 * platform-neutral ESM module in kernels/dist/. The server content-addresses
 * these at boot and fleet hosts fetch + execute them by hash — code mobility
 * for the Idle Fleet (one implementation runs on Node, WKWebView, anywhere
 * with a JS engine). Kernels must not import Node built-ins or natives.
 */
import { build } from "esbuild";
import { readdirSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(rootDir, "kernels/src");

// Skip dotfiles: macOS tar materializes xattrs as `._name.ts` AppleDouble
// sidecars on the deploy box, which are binary and break esbuild.
const entries = readdirSync(srcDir).filter((f) => f.endsWith(".ts") && !f.startsWith("."));
await Promise.all(
  entries.map((f) =>
    build({
      entryPoints: [join(srcDir, f)],
      outfile: join(rootDir, "kernels/dist", basename(f, ".ts") + ".mjs"),
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      minify: false,
      logLevel: "warning",
      // pdf-to-epub's DEFAULT png encoder lazy-imports sharp (native) and its
      // streamToFile branch lazy-imports node:fs; kernels never execute either
      // branch (pure-JS encoder injected, no streamToFile) — external keeps
      // the unexecuted imports from breaking the browser bundle.
      external: ["sharp", "node:fs"],
    }).then(() => console.log(`[Kernels] Built ${basename(f, ".ts")}.mjs`)),
  ),
);
