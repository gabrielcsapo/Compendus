/**
 * API Specification - Single source of truth for API documentation
 *
 * This file defines all API endpoints, their parameters, and response types.
 * It is used by:
 * - The /docs page to render API documentation
 * - Potentially for runtime validation
 */

import type { ApiBook, ApiSearchResult, ApiSearchResponse, ApiBookResponse, ApiErrorResponse } from "./search";

// Re-export types for convenience
export type { ApiBook, ApiSearchResult, ApiSearchResponse, ApiBookResponse, ApiErrorResponse };

export interface ParamSpec {
  name: string;
  type: "string" | "integer" | "boolean" | "uuid" | "file";
  description: string;
  required?: boolean;
  default?: string | number | boolean;
  constraints?: {
    min?: number;
    max?: number;
    minLength?: number;
    pattern?: string;
  };
}

export interface EndpointSpec {
  method: "GET" | "POST" | "PUT" | "DELETE" | "OPTIONS";
  path: string;
  summary: string;
  description?: string;
  pathParams?: ParamSpec[];
  queryParams?: ParamSpec[];
  requestBody?: {
    contentType: string;
    description: string;
    fields?: ParamSpec[];
  };
  responses: {
    success: {
      status: number;
      description: string;
      schema: string; // TypeScript type name
      example?: unknown;
    };
    errors: {
      status: number;
      code: string;
      description: string;
    }[];
  };
}

export interface ApiSpec {
  title: string;
  version: string;
  description: string;
  baseUrl: string;
  cors: {
    origins: string;
    methods: string[];
    headers: string[];
  };
  endpoints: EndpointSpec[];
  types: Record<string, { description: string; schema: string }>;
}

/**
 * The complete API specification
 */
export const apiSpec: ApiSpec = {
  title: "Compendus API",
  version: "1.0.0",
  description: "REST API for managing your personal book library. Search, browse, and upload books.",
  baseUrl: "/api",
  cors: {
    origins: "*",
    methods: ["GET", "POST", "OPTIONS"],
    headers: ["Content-Type"],
  },
  endpoints: [
    // Search
    {
      method: "GET",
      path: "/api/search",
      summary: "Full-text search across books",
      description: "Search your library by title, authors, description, and optionally book content. Returns relevance-scored results with highlighted matches.",
      queryParams: [
        {
          name: "q",
          type: "string",
          description: "Search query",
          required: true,
          constraints: { minLength: 2 },
        },
        {
          name: "limit",
          type: "integer",
          description: "Maximum number of results",
          default: 20,
          constraints: { min: 1, max: 100 },
        },
        {
          name: "offset",
          type: "integer",
          description: "Pagination offset",
          default: 0,
          constraints: { min: 0 },
        },
        {
          name: "content",
          type: "boolean",
          description: "Include full-text content search",
          default: false,
        },
      ],
      responses: {
        success: {
          status: 200,
          description: "Search results with relevance scores",
          schema: "ApiSearchResponse",
          example: {
            success: true,
            query: "fiction",
            total: 3,
            limit: 20,
            offset: 0,
            results: [
              {
                book: {
                  id: "550e8400-e29b-41d4-a716-446655440000",
                  title: "Science Fiction Anthology",
                  authors: ["Various Authors"],
                  format: "epub",
                },
                relevance: 0.92,
                highlights: { title: "Science <strong>Fiction</strong> Anthology" },
              },
            ],
          },
        },
        errors: [
          { status: 400, code: "INVALID_QUERY", description: "Query must be at least 2 characters" },
          { status: 400, code: "INVALID_LIMIT", description: "Limit cannot exceed 100" },
          { status: 500, code: "SEARCH_ERROR", description: "Internal search error" },
        ],
      },
    },

    // List books
    {
      method: "GET",
      path: "/api/books",
      summary: "List all books",
      description: "Retrieve a paginated list of all books in your library.",
      queryParams: [
        {
          name: "limit",
          type: "integer",
          description: "Maximum number of results",
          default: 20,
          constraints: { min: 1, max: 100 },
        },
        {
          name: "offset",
          type: "integer",
          description: "Pagination offset",
          default: 0,
          constraints: { min: 0 },
        },
      ],
      responses: {
        success: {
          status: 200,
          description: "Paginated list of books",
          schema: "ApiSearchResponse",
        },
        errors: [
          { status: 400, code: "INVALID_LIMIT", description: "Limit cannot exceed 100" },
          { status: 500, code: "LIST_ERROR", description: "Failed to list books" },
        ],
      },
    },

    // Get book by ID
    {
      method: "GET",
      path: "/api/books/:id",
      summary: "Get a book by ID",
      description: "Retrieve detailed information about a specific book.",
      pathParams: [
        {
          name: "id",
          type: "uuid",
          description: "Book unique identifier",
          required: true,
        },
      ],
      responses: {
        success: {
          status: 200,
          description: "Book details",
          schema: "ApiBookResponse",
        },
        errors: [
          { status: 404, code: "NOT_FOUND", description: "Book not found" },
          { status: 500, code: "LOOKUP_ERROR", description: "Failed to retrieve book" },
        ],
      },
    },

    // Lookup by ISBN
    {
      method: "GET",
      path: "/api/books/isbn/:isbn",
      summary: "Look up a book by ISBN",
      description: "Find a book using its ISBN-10 or ISBN-13. Hyphens and spaces are automatically removed.",
      pathParams: [
        {
          name: "isbn",
          type: "string",
          description: "ISBN-10 or ISBN-13 (hyphens/spaces optional)",
          required: true,
          constraints: { pattern: "^[\\d\\-\\s]{10,17}$" },
        },
      ],
      responses: {
        success: {
          status: 200,
          description: "Book details",
          schema: "ApiBookResponse",
          example: {
            success: true,
            book: {
              id: "550e8400-e29b-41d4-a716-446655440000",
              title: "To Kill a Mockingbird",
              authors: ["Harper Lee"],
              isbn13: "9780061120084",
              format: "pdf",
            },
          },
        },
        errors: [
          { status: 400, code: "INVALID_ISBN", description: "Invalid ISBN format" },
          { status: 404, code: "NOT_FOUND", description: "Book not found" },
          { status: 500, code: "LOOKUP_ERROR", description: "Failed to look up book" },
        ],
      },
    },

    // Upload book
    {
      method: "POST",
      path: "/api/upload",
      summary: "Upload a book file",
      description: "Upload and process a book file. The book will be indexed for search automatically.",
      requestBody: {
        contentType: "multipart/form-data",
        description: "Book file to upload",
        fields: [
          {
            name: "file",
            type: "file",
            description: "Book file (PDF, EPUB, MOBI, CBR, CBZ)",
            required: true,
          },
        ],
      },
      responses: {
        success: {
          status: 200,
          description: "Book uploaded and processed successfully",
          schema: "UploadResponse",
          example: {
            success: true,
            book: {
              id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
              title: "My Uploaded Book",
              format: "pdf",
            },
          },
        },
        errors: [
          { status: 400, code: "no_file", description: "No file provided" },
          { status: 400, code: "invalid_format", description: "Unsupported file format" },
          { status: 500, code: "upload_failed", description: "Upload processing failed" },
        ],
      },
    },

    // Upload cover
    {
      method: "POST",
      path: "/api/books/:id/cover",
      summary: "Upload a custom cover image",
      description: "Upload a custom cover image for a book. Replaces any existing cover.",
      pathParams: [
        {
          name: "id",
          type: "uuid",
          description: "Book unique identifier",
          required: true,
        },
      ],
      requestBody: {
        contentType: "multipart/form-data",
        description: "Cover image file",
        fields: [
          {
            name: "cover",
            type: "file",
            description: "Image file (JPEG, PNG, WebP, GIF)",
            required: true,
          },
        ],
      },
      responses: {
        success: {
          status: 200,
          description: "Cover uploaded successfully",
          schema: "CoverUploadResponse",
          example: {
            success: true,
            coverPath: "covers/550e8400-e29b-41d4-a716-446655440000.jpg",
            coverColor: "#8B4513",
          },
        },
        errors: [
          { status: 400, code: "no_file", description: "No file provided" },
          { status: 400, code: "invalid_format", description: "Invalid image format" },
          { status: 404, code: "book_not_found", description: "Book not found" },
          { status: 500, code: "processing_failed", description: "Cover processing failed" },
        ],
      },
    },

    // Get wishlist
    {
      method: "GET",
      path: "/api/wishlist",
      summary: "Get wishlist items",
      description: "Retrieve all books in your wishlist with optional filtering by status or series. Books that are now in your library are automatically removed from the wishlist.",
      queryParams: [
        {
          name: "status",
          type: "string",
          description: "Filter by status: 'wishlist', 'searching', or 'ordered'",
        },
        {
          name: "series",
          type: "string",
          description: "Filter by series name",
        },
        {
          name: "limit",
          type: "integer",
          description: "Maximum number of results",
          constraints: { min: 1, max: 100 },
        },
      ],
      responses: {
        success: {
          status: 200,
          description: "List of wishlist items",
          schema: "WishlistListResponse",
          example: {
            success: true,
            total: 5,
            removed: 0,
            books: [
              {
                id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
                title: "To Kill a Mockingbird",
                authors: ["Harper Lee"],
                isbn13: "9780061120084",
                coverUrl: "https://books.google.com/books/content?id=...",
                status: "wishlist",
                priority: 1,
                source: "googlebooks",
                createdAt: "2024-01-15T10:30:00.000Z",
              },
            ],
          },
        },
        errors: [
          { status: 500, code: "WISHLIST_ERROR", description: "Failed to retrieve wishlist" },
        ],
      },
    },

    // Add to wishlist by ISBN
    {
      method: "POST",
      path: "/api/wishlist/isbn/:isbn",
      summary: "Add a book to wishlist by ISBN",
      description: "Look up a book by its ISBN from Google Books and Open Library, then add it to your wishlist. The book metadata is automatically fetched from external sources.",
      pathParams: [
        {
          name: "isbn",
          type: "string",
          description: "ISBN-10 or ISBN-13 (hyphens/spaces optional)",
          required: true,
          constraints: { pattern: "^[\\d\\-\\s]{10,17}$" },
        },
      ],
      requestBody: {
        contentType: "application/json",
        description: "Optional wishlist options",
        fields: [
          {
            name: "status",
            type: "string",
            description: "Wishlist status: 'wishlist', 'searching', or 'ordered'",
            default: "wishlist",
          },
          {
            name: "priority",
            type: "integer",
            description: "Priority level: 0 (normal), 1 (high), 2 (critical)",
            default: 0,
            constraints: { min: 0, max: 2 },
          },
          {
            name: "notes",
            type: "string",
            description: "Personal notes about the book",
          },
        ],
      },
      responses: {
        success: {
          status: 200,
          description: "Book added to wishlist",
          schema: "WishlistResponse",
          example: {
            success: true,
            book: {
              id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
              title: "To Kill a Mockingbird",
              authors: ["Harper Lee"],
              isbn: "9780061120084",
              isbn13: "9780061120084",
              isbn10: "0061120081",
              coverUrl: "https://books.google.com/books/content?id=...",
              status: "wishlist",
              priority: 0,
              source: "googlebooks",
            },
          },
        },
        errors: [
          { status: 400, code: "INVALID_ISBN", description: "Invalid ISBN format. Must be 10 or 13 digits." },
          { status: 404, code: "BOOK_NOT_FOUND", description: "Could not find metadata for this ISBN" },
          { status: 409, code: "ALREADY_IN_WISHLIST", description: "Book is already in your wanted list" },
          { status: 409, code: "ALREADY_OWNED", description: "You already own this book" },
          { status: 500, code: "WISHLIST_ERROR", description: "Failed to add book to wishlist" },
        ],
      },
    },
  ],

  types: {
    ApiBook: {
      description: "Public book object (excludes internal fields like file paths)",
      schema: `{
  id: string;              // UUID
  title: string;
  subtitle: string | null;
  authors: string[];       // Array of author names
  publisher: string | null;
  publishedDate: string | null;  // ISO date (YYYY-MM-DD)
  description: string | null;
  isbn: string | null;
  isbn13: string | null;
  isbn10: string | null;
  language: string | null;
  pageCount: number | null;
  series: string | null;
  seriesNumber: string | null;
  format: "pdf" | "epub" | "mobi" | "cbr" | "cbz";
  coverUrl: string | null; // URL path: /covers/{id}.jpg
  addedAt: string;         // ISO timestamp
}`,
    },
    ApiSearchResult: {
      description: "A single search result with relevance scoring",
      schema: `{
  book: ApiBook;
  relevance: number;       // 0-1 score
  highlights: {
    title?: string;        // Matched text with <strong> tags
    authors?: string;
    description?: string;
    content?: string;
    chapterTitle?: string;
  };
}`,
    },
    ApiSearchResponse: {
      description: "Search or list response with pagination info",
      schema: `{
  success: true;
  query: string;           // Original search query
  total: number;           // Number of results returned
  limit: number;           // Requested limit
  offset: number;          // Requested offset
  results: ApiSearchResult[];
}`,
    },
    ApiBookResponse: {
      description: "Single book response",
      schema: `{
  success: true;
  book: ApiBook;
}`,
    },
    ApiErrorResponse: {
      description: "Error response format",
      schema: `{
  success: false;
  error: string;           // Human-readable message
  code: string;            // Machine-readable code
}`,
    },
    UploadResponse: {
      description: "Book upload success response",
      schema: `{
  success: true;
  book: {
    id: string;
    title: string;
    format: string;
  };
}`,
    },
    CoverUploadResponse: {
      description: "Cover upload success response",
      schema: `{
  success: true;
  coverPath: string;       // Path to the stored cover
  coverColor: string;      // Dominant color hex code
}`,
    },
    WishlistResponse: {
      description: "Wishlist add success response",
      schema: `{
  success: true;
  book: {
    id: string;              // UUID
    title: string;
    authors: string[];       // Array of author names
    isbn: string | null;
    isbn13: string | null;
    isbn10: string | null;
    coverUrl: string | null; // External cover URL
    status: "wishlist" | "searching" | "ordered";
    priority: number;        // 0=normal, 1=high, 2=critical
    source: "googlebooks" | "openlibrary";
  };
}`,
    },
    WishlistListResponse: {
      description: "Wishlist list response. Books now in the library are automatically removed.",
      schema: `{
  success: true;
  total: number;             // Count of remaining wishlist items
  removed: number;           // Count of items removed (now owned)
  books: Array<{
    id: string;              // UUID
    title: string;
    subtitle: string | null;
    authors: string[];       // Array of author names
    publisher: string | null;
    publishedDate: string | null;
    description: string | null;
    isbn: string | null;
    isbn13: string | null;
    isbn10: string | null;
    language: string | null;
    pageCount: number | null;
    series: string | null;
    seriesNumber: string | null;
    coverUrl: string | null; // External cover URL
    status: "wishlist" | "searching" | "ordered";
    priority: number;        // 0=normal, 1=high, 2=critical
    notes: string | null;
    source: "googlebooks" | "openlibrary" | "manual";
    createdAt: string;       // ISO timestamp
  }>;
}`,
    },
  },
};

/**
 * Supported file formats for upload
 */
export const supportedFormats = {
  books: {
    extensions: [".pdf", ".epub", ".mobi", ".azw", ".azw3", ".cbr", ".cbz"],
    mimeTypes: {
      pdf: "application/pdf",
      epub: "application/epub+zip",
      mobi: "application/x-mobipocket-ebook",
      cbr: "application/vnd.comicbook-rar",
      cbz: "application/vnd.comicbook+zip",
    },
  },
  covers: {
    extensions: [".jpg", ".jpeg", ".png", ".webp", ".gif"],
    mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  },
};

/**
 * Static file endpoints (not part of /api/ prefix)
 */
export const staticEndpoints = [
  {
    method: "GET" as const,
    path: "/books/:id.:format",
    summary: "Download book file",
    description: "Stream or download the original book file.",
    pathParams: [
      { name: "id", type: "uuid" as const, description: "Book ID", required: true },
      { name: "format", type: "string" as const, description: "File format (pdf, epub, mobi, cbr, cbz)", required: true },
    ],
  },
  {
    method: "GET" as const,
    path: "/covers/:id.jpg",
    summary: "Get cover image",
    description: "Retrieve the book's cover image as JPEG.",
    pathParams: [
      { name: "id", type: "uuid" as const, description: "Book ID", required: true },
    ],
  },
  {
    method: "GET" as const,
    path: "/comic/:id/:format/info",
    summary: "Get comic metadata",
    description: "Get page count and other metadata for a comic book.",
    pathParams: [
      { name: "id", type: "uuid" as const, description: "Book ID", required: true },
      { name: "format", type: "string" as const, description: "Comic format (cbr or cbz)", required: true },
    ],
  },
  {
    method: "GET" as const,
    path: "/comic/:id/:format/page/:pageNum",
    summary: "Get comic page",
    description: "Retrieve a specific page from a comic book as an image.",
    pathParams: [
      { name: "id", type: "uuid" as const, description: "Book ID", required: true },
      { name: "format", type: "string" as const, description: "Comic format (cbr or cbz)", required: true },
      { name: "pageNum", type: "integer" as const, description: "Page number (0-indexed)", required: true },
    ],
  },
];
