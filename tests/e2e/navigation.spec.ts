import { test, expect } from "./fixtures.js";
import { BOOKS } from "./constants.js";

/**
 * Top-level navigation: the Library + Wander nav icons route correctly, and the
 * book-detail → reader hand-off works.
 */
test.describe("navigation", () => {
  test("Wander and Library nav icons route correctly", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "Wander the Living Library" }).click();
    await expect(page).toHaveURL(/\/wander$/);

    await page.getByRole("link", { name: "Library", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("book detail → Start Reading opens the reader", async ({ page }) => {
    await page.goto(`/book/${BOOKS.ready.id}`);
    await expect(page.getByRole("heading", { name: BOOKS.ready.title })).toBeVisible();

    await page.getByRole("link", { name: /Start Reading|Continue Reading/i }).click();
    await expect(page).toHaveURL(new RegExp(`/book/${BOOKS.ready.id}/read`));
    await expect(page.getByText("Loading book...")).toBeHidden({ timeout: 15_000 });
  });
});
