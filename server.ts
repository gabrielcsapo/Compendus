import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createServer } from "react-flight-router/server";
import { app as apiApp } from "./server/index.js";
import { startJobProcessor } from "./app/lib/queue.js";

async function main() {
  const flightApp = await createServer({ buildDir: "./dist" });

  // Create the unified server: API routes first, then flight router for pages
  const app = new Hono();

  // Mount all API and asset routes (matched before the page catch-all)
  app.route("/", apiApp);

  // Mount flight router for all page requests (RSC, SSR, actions, static assets)
  app.all("*", (c) => flightApp.fetch(c.req.raw));

  const server = serve({ fetch: app.fetch, port: 3000 }, (info) => {
    console.log(`[Compendus] Server running at http://localhost:${info.port}`);
  });

  // Disable default timeouts so large file uploads (1GB+ audiobooks) don't get killed
  server.setTimeout(0);
  (server as any).requestTimeout = 0;
  (server as any).headersTimeout = 0;

  // Start background job processor (transcription, conversion queue)
  startJobProcessor();
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
