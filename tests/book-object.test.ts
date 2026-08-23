import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BookObject } from "../app/components/BookObject";
import type { BookType } from "../app/lib/book-types";

describe("BookObject", () => {
  it.each<BookType>(["ebook", "audiobook", "comic"])(
    "exposes the %s type for its gated physical treatment",
    (type) => {
      const markup = renderToStaticMarkup(BookObject({ type, children: "Cover" }));

      expect(markup).toContain(`data-book-type="${type}"`);
      expect(markup).toContain("book-object-surface");
    },
  );
});
