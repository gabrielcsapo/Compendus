import { test, expect } from "./fixtures.js";
import { ADMIN_FILLER_COUNT } from "./constants.js";

/**
 * The admin data page (server-action driven): the long "Matched Files" section
 * paginates, and its per-section search filters the list. Seeded with
 * ADMIN_FILLER_COUNT (60) source files + 1 (the searchable book) → 61 matched,
 * which spans 2 pages at the 50/page size.
 */
test.describe("admin data: pagination + search", () => {
  // Scope to the Matched Files <section> — its search placeholder is shared with
  // the Missing Files section, so all locators must be section-relative.
  const matchedSection = (page: import("@playwright/test").Page) =>
    page.locator("section").filter({ has: page.getByRole("heading", { name: /Matched Files/ }) });

  test("Matched Files section paginates across pages", async ({ page }) => {
    await page.goto("/admin");

    const section = matchedSection(page);
    await expect(section.getByRole("heading", { name: /Matched Files \(61\)/ })).toBeVisible({
      timeout: 15_000,
    });

    // Page 1 shows the first filler; the last filler lives on page 2.
    await expect(section.getByText("e2e-filler-001.epub")).toBeVisible();
    const lastFiller = `e2e-filler-${String(ADMIN_FILLER_COUNT).padStart(3, "0")}.epub`;
    await expect(section.getByText(lastFiller)).toHaveCount(0);

    await section.getByRole("button", { name: "Next" }).click();

    await expect(section.getByText(lastFiller)).toBeVisible({ timeout: 10_000 });
    await expect(section.getByText("e2e-filler-001.epub")).toHaveCount(0);
  });

  test("Matched Files search filters the list", async ({ page }) => {
    await page.goto("/admin");
    const section = matchedSection(page);
    await expect(section.getByRole("heading", { name: /Matched Files/ })).toBeVisible({
      timeout: 15_000,
    });

    await section.getByPlaceholder("Search by title, filename, or format...").fill("filler-007");

    await expect(section.getByText("e2e-filler-007.epub")).toBeVisible({ timeout: 10_000 });
    await expect(section.getByText("e2e-filler-001.epub")).toHaveCount(0);
  });
});
