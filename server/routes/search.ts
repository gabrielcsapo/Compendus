import { Hono } from "hono";
import { apiSearchBooks } from "../../app/lib/api/search";

const app = new Hono();

// GET /api/search?q=query&limit=20&offset=0
app.get("/api/search", async (c) => {
  const profileId = c.get("profileId");
  const query = c.req.query("q") || "";
  const limit = parseInt(c.req.query("limit") || "20", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const baseUrl = new URL(c.req.url).origin;
  const result = await apiSearchBooks(query, { limit, offset }, baseUrl, profileId);
  return c.json(result, result.success ? 200 : 400);
});

export { app as searchRoutes };
