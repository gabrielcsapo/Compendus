import { seed } from "./seed.js";
import { E2E_DATA_DIR } from "./constants.js";

/**
 * Playwright global setup — runs once before the web server starts. Seeds the
 * isolated data root the server is pointed at (via webServer.env in the config),
 * so every request the suite makes hits a known, hermetic dataset.
 */
export default async function globalSetup() {
  await seed(E2E_DATA_DIR);
  // eslint-disable-next-line no-console
  console.log(`[e2e] seeded data root: ${E2E_DATA_DIR}`);
}
