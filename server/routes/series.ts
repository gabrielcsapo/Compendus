import { Hono } from "hono";
import { getSeriesWithCovers } from "../../app/actions/series";

const app = new Hono();

// GET /api/series - list all series with cover data
app.get("/api/series", async (c) => {
  try {
    const baseUrl = new URL(c.req.url).origin;
    const seriesList = await getSeriesWithCovers();

    // Transform cover paths to URLs
    const series = seriesList.map(s => ({
      name: s.name,
      bookCount: s.bookCount,
      coverBooks: s.coverBooks.map(book => ({
        id: book.id,
        coverUrl: book.coverPath ? `${baseUrl}/covers/${book.id}.thumb.jpg?v=${book.updatedAt?.getTime() || ""}` : null,
      })),
    }));

    return c.json({ success: true, series });
  } catch (error) {
    console.error("API series error:", error);
    return c.json({ success: false, error: "Failed to list series", code: "SERIES_ERROR" }, 500);
  }
});

export { app as seriesRoutes };
