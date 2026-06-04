// Global vitest setup: point the whole data root (DB + book files + caches) at a
// throwaway temp dir BEFORE any module opens the DB or storage, so tests never
// touch the real data/. Each test file runs in its own fork → its own temp dir.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "compendus-test-"));
process.env.COMPENDUS_DATA_DIR = dir;

process.on("exit", () => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});
