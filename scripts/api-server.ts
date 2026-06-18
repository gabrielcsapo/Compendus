/**
 * Standalone API server — the Hono app without the flight router. Used by the
 * fabric/substrate E2E flows and as a dev workaround while `pnpm dev`'s SSR
 * environment has the react-server condition issue.
 *
 * Usage: [COMPENDUS_DATA_DIR=...] pnpm tsx scripts/api-server.ts [--port 3002]
 */
import { serve } from "@hono/node-server";
import { app } from "../server/index";

const i = process.argv.indexOf("--port");
const port = i >= 0 ? parseInt(process.argv[i + 1], 10) : 3002;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `[api-server] listening on :${info.port} (data: ${process.env.COMPENDUS_DATA_DIR || "./data"})`,
  );
});
