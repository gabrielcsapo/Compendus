import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Dedicated vitest config. Crucially this does NOT load the dev-server plugins
// from vite.config.ts (apiPlugin/flightRouter) — those boot the Hono app + the
// background job processor, which we never want during tests (it spews teardown
// errors and can touch the real DB). Module resolution mirrors tsconfig's `@/*`.
export default defineConfig({
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "app") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Points COMPENDUS_DATA_DIR at a temp dir before any test opens the DB/storage.
    setupFiles: ["tests/setup.ts"],
    // Per-file isolation (default fork pool) so each test that sets
    // COMPENDUS_DATA_DIR + imports the db gets a fresh module registry.
    pool: "forks",
  },
});
