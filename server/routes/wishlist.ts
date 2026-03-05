import { Hono } from "hono";
import { getWantedBooks, addToWantedList } from "../../app/actions/wanted";
import { lookupByISBN, lookupGoogleBooksByISBN } from "../../app/lib/metadata";

const app = new Hono();

// GET /api/wishlist - get wishlist items
app.get("/api/wishlist", async (c) => {
  try {
    const profileId = c.get("profileId");
    const status = c.req.query("status") as "wishlist" | "searching" | "ordered" | undefined;
    const series = c.req.query("series");
    const limitParam = c.req.query("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    const result = await getWantedBooks({
      status: status || undefined,
      series: series || undefined,
      limit,
    }, profileId);

    return c.json({
      success: true,
      total: result.books.length,
      removed: result.removed,
      books: result.books.map((book) => ({
        id: book.id,
        title: book.title,
        subtitle: book.subtitle,
        authors: book.authors ? JSON.parse(book.authors) : [],
        publisher: book.publisher,
        publishedDate: book.publishedDate,
        description: book.description,
        isbn: book.isbn,
        isbn13: book.isbn13,
        isbn10: book.isbn10,
        language: book.language,
        pageCount: book.pageCount,
        series: book.series,
        seriesNumber: book.seriesNumber,
        coverUrl: book.coverUrl,
        status: book.status,
        priority: book.priority,
        notes: book.notes,
        source: book.source,
        createdAt: book.createdAt?.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Wishlist get error:", error);
    return c.json(
      {
        success: false,
        error: "Failed to retrieve wishlist",
        code: "WISHLIST_ERROR",
      },
      500,
    );
  }
});

// POST /api/wishlist/isbn/:isbn - add book to wishlist by ISBN
app.post("/api/wishlist/isbn/:isbn", async (c) => {
  try {
    const profileId = c.get("profileId");
    const isbn = c.req.param("isbn").replace(/[-\s]/g, "");

    // Validate ISBN format (10 or 13 digits)
    if (!/^(\d{10}|\d{13})$/.test(isbn)) {
      return c.json(
        {
          success: false,
          error: "Invalid ISBN format. Must be 10 or 13 digits.",
          code: "INVALID_ISBN",
        },
        400,
      );
    }

    // Parse request body for fallback title/author
    let bodyData: {
      status?: "wishlist" | "searching" | "ordered";
      priority?: number;
      notes?: string;
      title?: string;
      author?: string;
    } = {};
    try {
      const contentType = c.req.header("content-type");
      if (contentType?.includes("application/json")) {
        const body = await c.req.json();
        if (body.status) bodyData.status = body.status;
        if (body.priority !== undefined) bodyData.priority = body.priority;
        if (body.notes) bodyData.notes = body.notes;
        if (body.title) bodyData.title = body.title;
        if (body.author) bodyData.author = body.author;
      }
    } catch {
      // Ignore body parsing errors, use defaults
    }

    // Look up book metadata from external sources
    let metadata = await lookupGoogleBooksByISBN(isbn);

    if (!metadata) {
      metadata = await lookupByISBN(isbn);
    }

    // If no metadata found, check for fallback title/author
    if (!metadata) {
      if (bodyData.title) {
        metadata = {
          title: bodyData.title,
          subtitle: null,
          authors: bodyData.author ? [bodyData.author] : [],
          publisher: null,
          publishedDate: null,
          description: null,
          pageCount: null,
          isbn: isbn,
          isbn13: isbn.length === 13 ? isbn : null,
          isbn10: isbn.length === 10 ? isbn : null,
          language: "en",
          subjects: [],
          series: null,
          seriesNumber: null,
          coverUrl: null,
          coverUrlHQ: null,
          coverUrls: [],
          source: "manual" as const,
          sourceId: `manual-${isbn}`,
        };
      } else {
        return c.json(
          {
            success: false,
            error:
              "Book not found. Could not find metadata for this ISBN. You can provide 'title' and optionally 'author' in the request body to add it manually.",
            code: "BOOK_NOT_FOUND",
          },
          404,
        );
      }
    }

    // Build options from parsed body
    const options: {
      status?: "wishlist" | "searching" | "ordered";
      priority?: number;
      notes?: string;
    } = {};
    if (bodyData.status) options.status = bodyData.status;
    if (bodyData.priority !== undefined) options.priority = bodyData.priority;
    if (bodyData.notes) options.notes = bodyData.notes;

    // Add to wanted list
    const wantedBook = await addToWantedList(metadata, options, profileId);

    return c.json({
      success: true,
      book: {
        id: wantedBook.id,
        title: wantedBook.title,
        authors: wantedBook.authors ? JSON.parse(wantedBook.authors) : [],
        isbn: wantedBook.isbn,
        isbn13: wantedBook.isbn13,
        isbn10: wantedBook.isbn10,
        coverUrl: wantedBook.coverUrl,
        status: wantedBook.status,
        priority: wantedBook.priority,
        source: wantedBook.source,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add book to wishlist";

    if (message.includes("already in your wanted list")) {
      return c.json({ success: false, error: message, code: "ALREADY_IN_WISHLIST" }, 409);
    }
    if (message.includes("already own this book")) {
      return c.json({ success: false, error: message, code: "ALREADY_OWNED" }, 409);
    }

    console.error("Wishlist add error:", error);
    return c.json({ success: false, error: message, code: "WISHLIST_ERROR" }, 500);
  }
});

export { app as wishlistRoutes };
