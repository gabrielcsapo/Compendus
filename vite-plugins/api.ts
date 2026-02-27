import type { Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Vite plugin that mounts the Hono API server as middleware on the dev server.
 * This eliminates the need for a separate API process during development.
 */
export function apiPlugin(): Plugin {
  return {
    name: "compendus-api",
    configureServer(server: ViteDevServer) {
      // Start the background job processor in dev mode
      server.ssrLoadModule("/app/lib/queue.ts").then(({ startJobProcessor }) => {
        startJobProcessor();
      }).catch((err) => {
        console.error("[API Plugin] Failed to start job processor:", err);
      });

      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url || "";

        // Check if this is an API/asset route that should be handled by Hono
        if (
          url.startsWith("/api/") ||
          url.startsWith("/books/") ||
          url.startsWith("/covers/") ||
          url.startsWith("/comic/") ||
          url.startsWith("/mobi-images/") ||
          isBookResource(url)
        ) {
          try {
            const { app } = await server.ssrLoadModule("/server/index.ts");
            const webRequest = toWebRequest(req);
            const response: Response = await app.fetch(webRequest);
            await writeWebResponse(res, response);
          } catch (error) {
            console.error("[API Plugin] Error:", error);
            res.statusCode = 500;
            res.end("Internal Server Error");
          }
        } else {
          next();
        }
      });
    },
  };
}

/**
 * Check if a URL is an EPUB/comic book resource (not a React route).
 * Routes like /book/:id/read and /book/:id/edit are React routes.
 * Anything else under /book/:id/* is a resource request.
 */
function isBookResource(url: string): boolean {
  const match = url.match(/^\/book\/[a-f0-9-]+\/(.+)$/);
  if (!match) return false;
  const pathPart = match[1].split("?")[0];
  return !/^(read|edit)(\..+)?$/.test(pathPart);
}

/** Convert Node.js IncomingMessage to Web API Request */
function toWebRequest(req: IncomingMessage): Request {
  const protocol = "http";
  const host = req.headers.host || "localhost";
  const url = new URL(req.url || "/", `${protocol}://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) {
      if (Array.isArray(value)) {
        for (const v of value) headers.append(key, v);
      } else {
        headers.set(key, value);
      }
    }
  }

  const method = req.method || "GET";
  const hasBody = method !== "GET" && method !== "HEAD";

  return new Request(url.toString(), {
    method,
    headers,
    body: hasBody ? (req as unknown as ReadableStream) : undefined,
    // @ts-expect-error - duplex is needed for streaming request bodies
    duplex: hasBody ? "half" : undefined,
  });
}

/** Write a Web API Response to Node.js ServerResponse */
async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;

  response.headers.forEach((value, key) => {
    // Skip transfer-encoding since Node.js handles chunked encoding itself
    if (key.toLowerCase() === "transfer-encoding") return;
    res.setHeader(key, value);
  });

  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } finally {
      reader.releaseLock();
    }
  }

  res.end();
}
