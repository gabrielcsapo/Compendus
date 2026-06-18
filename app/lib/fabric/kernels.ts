/**
 * Kernel registry — code mobility for the Idle Fleet.
 *
 * A kernel is a self-contained, platform-neutral ESM bundle (built by
 * scripts/build-kernels.ts) that fleet hosts fetch by content hash and
 * execute: payload in, result out. The server registers each built kernel as
 * a content-addressed fabric artifact at boot; work kinds reference kernels
 * via `payload.kernelHash`, and any host with a JS engine — the Node harness
 * today, the app's WKWebView host next — can serve them. Shipping new compute
 * to the whole fleet becomes a server deploy, not an app release, and version
 * skew disappears because the hash IS the contract.
 *
 * Trust model: household — kernels only come from this server, verified by
 * hash on the host before execution.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { eq } from "drizzle-orm";
import { db, fabricArtifacts } from "../db";
import { blobPathFor } from "./index";

const kernelHashes = new Map<string, string>(); // name → sha256

/**
 * Content-address every built kernel into the artifact store. Idempotent;
 * called at server boot. Unchanged kernels keep their hash (and any cached
 * copies on devices stay valid); edited kernels get a new hash automatically.
 */
export function registerKernels(): void {
  const dist = join(process.cwd(), "kernels/dist");
  if (!existsSync(dist)) return;
  for (const file of readdirSync(dist).filter((f) => f.endsWith(".mjs"))) {
    const name = basename(file, ".mjs");
    const bytes = readFileSync(join(dist, file));
    const hash = createHash("sha256").update(bytes).digest("hex");
    kernelHashes.set(name, hash);
    const blobPath = blobPathFor(hash);
    if (!existsSync(blobPath)) {
      mkdirSync(dirname(blobPath), { recursive: true });
      writeFileSync(blobPath, bytes);
    }
    if (!db.select().from(fabricArtifacts).where(eq(fabricArtifacts.hash, hash)).get()) {
      db.insert(fabricArtifacts)
        .values({
          hash,
          kind: "js-kernel",
          modelId: name,
          mime: "text/javascript",
          bytes: bytes.length,
          path: blobPath,
        })
        .run();
    }
  }
}

/** Hash for a registered kernel name (throws if the bundle wasn't built). */
export function kernelHashFor(name: string): string {
  const hash = kernelHashes.get(name);
  if (!hash) throw new Error(`kernel "${name}" not registered — run build:kernels`);
  return hash;
}

export function kernelNames(): string[] {
  return [...kernelHashes.keys()];
}
