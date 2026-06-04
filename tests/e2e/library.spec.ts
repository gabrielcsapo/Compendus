import { test, expect } from "./fixtures.js";
import { BOOKS } from "./constants.js";

/**
 * Library grid lists seeded books, and site search finds a book by its unique
 * title (and excludes non-matches).
 */
test.describe("library + search", () => {
  test("library grid lists seeded books", async ({ page }) => {
    await page.goto("/");

    // The grid is virtualized (only a window of cards is in the DOM at once), so
    // assert robustly: the grid is populated and renders seeded book content.
    // Every card here is a seeded book — the DB is freshly seeded per run.
    await expect(page.getByText(/E2E Filler Book \d{3}/).first()).toBeVisible({ timeout: 10_000 });
    expect(await page.locator('a[href^="/book/"]').count()).toBeGreaterThanOrEqual(12);
  });

  test("search finds the unique title and excludes non-matches", async ({ page }) => {
    // The site search opens a ⌘K palette; the /search route is the canonical,
    // linkable surface for a query, so assert against it directly.
    await page.goto(`/search?q=${encodeURIComponent("Zephyrus")}`);

    // A result card renders the title in both an <h3> and its wrapping link, so
    // scope to the first match to avoid a strict-mode multiple-elements error.
    await expect(page.getByText(BOOKS.searchable.title).first()).toBeVisible({ timeout: 10_000 });
    // A book that doesn't match the query must not appear in results.
    await expect(page.getByText(BOOKS.processing.title)).toHaveCount(0);
  });
});
