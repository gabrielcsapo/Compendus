import { test, expect } from "./fixtures.js";
import { BOOKS, READER_GATE } from "./constants.js";

/**
 * The core CCD-migration guarantee, end-to-end through the real web reader:
 * a book with a ready CCD bundle renders, while a not-yet-ready / failed book
 * surfaces a clear gate instead of a blank or broken reader.
 */
test.describe("web reader: render + readiness gating", () => {
  test("ready book opens the reader (no gate, content loaded)", async ({ page }) => {
    await page.goto(`/book/${BOOKS.ready.id}/read`);

    // Neither gate message appears for a ready book.
    await expect(page.getByText(READER_GATE.processing)).toHaveCount(0);
    await expect(page.getByText(READER_GATE.failed)).toHaveCount(0);

    // The loading state resolves and the reader chrome shows the book title.
    await expect(page.getByText("Loading book...")).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(BOOKS.ready.title)).toBeVisible();
  });

  test("processing book is gated with 'still being prepared'", async ({ page }) => {
    await page.goto(`/book/${BOOKS.processing.id}/read`);
    await expect(page.getByText(new RegExp(READER_GATE.processing, "i"))).toBeVisible({
      timeout: 15_000,
    });
  });

  test("failed book is gated with 'couldn't be prepared'", async ({ page }) => {
    await page.goto(`/book/${BOOKS.failed.id}/read`);
    await expect(page.getByText(new RegExp(READER_GATE.failed, "i"))).toBeVisible({
      timeout: 15_000,
    });
  });
});
