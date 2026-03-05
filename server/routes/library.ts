import { Hono } from "hono";
import { getBooks } from "../../app/actions/books";
import type { BookType } from "../../app/lib/book-types";

type SortOption = "recent" | "oldest" | "title-asc" | "title-desc";

const BOOKS_PER_PAGE = 24;

function getSortParams(sort: SortOption): {
  orderBy: "title" | "createdAt";
  order: "asc" | "desc";
} {
  switch (sort) {
    case "title-asc":
      return { orderBy: "title", order: "asc" };
    case "title-desc":
      return { orderBy: "title", order: "desc" };
    case "oldest":
      return { orderBy: "createdAt", order: "asc" };
    case "recent":
    default:
      return { orderBy: "createdAt", order: "desc" };
  }
}

export const libraryRoutes = new Hono();

libraryRoutes.get("/api/library", async (c) => {
  const profileId = c.get("profileId");
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const sort = (c.req.query("sort") as SortOption) || "recent";
  const typeParam = c.req.query("type") as BookType | null;
  const type = typeParam && ["audiobook", "ebook", "comic"].includes(typeParam) ? typeParam : undefined;
  const formatParam = c.req.query("format");
  const format = formatParam ? formatParam.split(",").filter(Boolean) : undefined;
  const series = c.req.query("series") || undefined;
  const { orderBy, order } = getSortParams(sort);

  const books = await getBooks({
    limit: BOOKS_PER_PAGE,
    offset,
    orderBy,
    order,
    type,
    format,
    series,
    profileId,
  });

  // Serialize dates as ISO strings for JSON consistency
  const serializedBooks = books.map((book) => ({
    ...book,
    createdAt: book.createdAt?.toISOString() ?? null,
    updatedAt: book.updatedAt?.toISOString() ?? null,
    lastReadAt: book.lastReadAt?.toISOString() ?? null,
    importedAt: book.importedAt?.toISOString() ?? null,
  }));

  return c.json({ books: serializedBooks });
});
