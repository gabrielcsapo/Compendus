import { resolve } from "node:path";

/**
 * Shared constants for the web e2e suite. Imported by both the Node side
 * (playwright.config, global-setup, seed) and the browser side (specs), so it
 * must stay free of any server-only imports.
 */

/** Port the built server listens on for e2e (kept off :3000 so a dev server can coexist). */
export const E2E_PORT = 3100;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

/** Throwaway data root the seeded DB + book files live under (gitignored, wiped per run). */
export const E2E_DATA_DIR = resolve(import.meta.dirname, ".data");

/** The single admin profile seeded so RSC actions resolve a profile (cookie `compendus-profile`). */
export const ADMIN_PROFILE = { id: "e2e-admin", name: "E2E Admin" };

/** The books the specs assert against, by readiness state. */
export const BOOKS = {
  /** Reflowable book with a real CCD bundle on disk → reader renders. */
  ready: { id: "e2e-ready", title: "E2E Ready Reader", author: "Herman Melville" },
  /** No CCD yet → reader shows the "still being prepared" gate. */
  processing: { id: "e2e-processing", title: "E2E Processing Book", author: "Ada Lovelace" },
  /** ccdError set → reader shows the "couldn't be prepared" gate. */
  failed: { id: "e2e-failed", title: "E2E Failed Book", author: "Charles Babbage" },
  /** Unique title/author so the library + site search can find exactly one. */
  searchable: {
    id: "e2e-needle",
    title: "Zephyrus Quicksort Almanac",
    author: "Beatrix Searchwell",
  },
} as const;

/** Gate messages the reader server action returns (app/actions/reader.ts). */
export const READER_GATE = {
  processing: "still being prepared for reading",
  failed: "couldn't be prepared for reading",
} as const;

/** How many filler books to seed so the admin "Matched Files" section spans >1 page (pageSize 50). */
export const ADMIN_FILLER_COUNT = 60;
