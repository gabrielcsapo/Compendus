import { defineConfig, devices } from "@playwright/test";
import { E2E_PORT, E2E_BASE_URL, E2E_DATA_DIR } from "./tests/e2e/constants";

/**
 * Web e2e config. Boots the PRODUCTION server (`pnpm build` → `node server.ts`)
 * pointed at a seeded, isolated COMPENDUS_DATA_DIR, then drives it with Chromium.
 * Mirrors what ships, and is hermetic enough to run identically on CI.
 *
 * Run: `pnpm test:e2e` (add `--ui` locally to debug).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  // Shared seeded DB → keep it serial + single-worker for deterministic state.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./tests/e2e/global-setup.ts",

  use: {
    baseURL: E2E_BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    command: "pnpm build && node --import tsx server.ts",
    url: E2E_BASE_URL,
    // Generous: the command does a full prod build (RSC + worker) before serving.
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      COMPENDUS_DATA_DIR: E2E_DATA_DIR,
      PORT: String(E2E_PORT),
      NODE_ENV: "production",
    },
  },
});
