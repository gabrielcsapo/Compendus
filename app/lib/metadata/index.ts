import type { BookMetadata } from "../types";

/**
 * Simple in-memory cache with TTL for API responses
 */
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class MetadataCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private defaultTTL = 30 * 60 * 1000; // 30 minutes

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  set<T>(key: string, data: T, ttl: number = this.defaultTTL): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttl,
    });
  }

  // Clear expired entries periodically
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}

// Global cache instance
const metadataCache = new MetadataCache();

// Run cleanup every 5 minutes
setInterval(() => metadataCache.cleanup(), 5 * 60 * 1000);

interface OpenLibrarySearchResult {
  numFound: number;
  docs: Array<{
    key: string;
    title: string;
    subtitle?: string;
    author_name?: string[];
    first_publish_year?: number;
    publisher?: string[];
    isbn?: string[];
    language?: string[];
    number_of_pages_median?: number;
    cover_i?: number;
    subject?: string[];
    series?: string[];
  }>;
}

interface OpenLibraryBook {
  title: string;
  subtitle?: string;
  authors?: Array<{ key: string }>;
  publishers?: string[];
  publish_date?: string;
  description?: string | { value: string };
  subjects?: string[];
  subject_places?: string[];
  subject_people?: string[];
  subject_times?: string[];
  number_of_pages?: number;
  covers?: number[];
  isbn_10?: string[];
  isbn_13?: string[];
  languages?: Array<{ key: string }>;
  series?: string[];
  edition_name?: string;
  physical_format?: string;
}

interface OpenLibraryAuthor {
  name: string;
  bio?: string | { value: string };
}

interface GoogleBooksResponse {
  totalItems: number;
  items?: Array<{
    id: string;
    volumeInfo: {
      title: string;
      subtitle?: string;
      authors?: string[];
      publisher?: string;
      publishedDate?: string;
      description?: string;
      industryIdentifiers?: Array<{
        type: string;
        identifier: string;
      }>;
      pageCount?: number;
      categories?: string[];
      imageLinks?: {
        smallThumbnail?: string;
        thumbnail?: string;
        small?: string;
        medium?: string;
        large?: string;
        extraLarge?: string;
      };
      language?: string;
      seriesInfo?: {
        kind: string;
        bookDisplayNumber?: string;
        volumeSeries?: Array<{
          seriesId: string;
          seriesBookType?: string;
          orderNumber?: number;
        }>;
      };
    };
  }>;
}

export interface MetadataSearchResult {
  title: string;
  subtitle: string | null;
  authors: string[];
  publisher: string | null;
  publishedDate: string | null;
  description: string | null;
  pageCount: number | null;
  isbn: string | null;
  isbn13: string | null;
  isbn10: string | null;
  language: string | null;
  subjects: string[];
  series: string | null;
  seriesNumber: string | null;
  coverUrl: string | null;
  coverUrlHQ: string | null; // High quality cover from Google Books
  coverUrls: string[]; // All available cover URLs to try in order
  source: "openlibrary" | "googlebooks";
  sourceId: string;
}

/**
 * Search Google Books API for high-quality covers and metadata
 * Set GOOGLE_BOOKS_API_KEY environment variable to increase rate limits
 */
export async function searchGoogleBooks(query: string): Promise<MetadataSearchResult[]> {
  // Check cache first
  const cacheKey = `google:${query.toLowerCase().trim()}`;
  const cached = metadataCache.get<MetadataSearchResult[]>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const encodedQuery = encodeURIComponent(query);
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY;

    let url = `https://www.googleapis.com/books/v1/volumes?q=${encodedQuery}&maxResults=10`;
    if (apiKey) {
      url += `&key=${apiKey}`;
    }

    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });

    if (!response.ok) {
      console.error("Google Books search failed:", response.statusText);
      return [];
    }

    const data: GoogleBooksResponse = await response.json();

    if (!data.items) {
      return [];
    }

    const results = data.items.map((item) => {
      const vol = item.volumeInfo;
      const isbn13 = vol.industryIdentifiers?.find((id) => id.type === "ISBN_13")?.identifier;
      const isbn10 = vol.industryIdentifiers?.find((id) => id.type === "ISBN_10")?.identifier;

      // Get best available cover URL - prefer larger sizes
      // Google Books provides multiple sizes: extraLarge > large > medium > small > thumbnail > smallThumbnail
      const images = vol.imageLinks;
      let coverUrl =
        images?.extraLarge ||
        images?.large ||
        images?.medium ||
        images?.small ||
        images?.thumbnail ||
        images?.smallThumbnail ||
        null;

      let coverUrlHQ = null;

      if (coverUrl) {
        // Ensure HTTPS (Google sometimes returns HTTP)
        coverUrl = coverUrl.replace(/^http:/, "https:");
        // Remove edge curl effect for cleaner image
        coverUrl = coverUrl.replace(/&edge=curl/g, "");

        // Create HQ version by modifying zoom parameter
        coverUrlHQ = coverUrl.replace(/zoom=\d/, "zoom=3"); // zoom=3 gives ~800px

        // If no zoom parameter exists, add it
        if (!coverUrlHQ.includes("zoom=")) {
          coverUrlHQ = coverUrl + (coverUrl.includes("?") ? "&" : "?") + "zoom=3";
        }
      }

      // Build list of cover URLs to try (HQ first, then regular)
      const coverUrls: string[] = [];
      if (coverUrlHQ) coverUrls.push(coverUrlHQ);
      if (coverUrl && coverUrl !== coverUrlHQ) coverUrls.push(coverUrl);

      return {
        title: vol.title,
        subtitle: vol.subtitle || null,
        authors: vol.authors || [],
        publisher: vol.publisher || null,
        publishedDate: vol.publishedDate || null,
        description: vol.description || null,
        pageCount: vol.pageCount || null,
        isbn: isbn13 || isbn10 || null,
        isbn13: isbn13 || null,
        isbn10: isbn10 || null,
        language: vol.language || null,
        subjects: vol.categories || [],
        series: null, // Google Books series info is complex, skip for now
        seriesNumber: null,
        coverUrl,
        coverUrlHQ,
        coverUrls,
        source: "googlebooks" as const,
        sourceId: item.id,
      };
    });

    // Cache the results
    metadataCache.set(cacheKey, results);
    return results;
  } catch (error) {
    // Silently fail - will fall back to Open Library
    console.error("Google Books API error:", error);
    return [];
  }
}

/**
 * Look up book on Google Books by ISBN
 */
export async function lookupGoogleBooksByISBN(isbn: string): Promise<MetadataSearchResult | null> {
  const cleanIsbn = isbn.replace(/[-\s]/g, "");
  const results = await searchGoogleBooks(`isbn:${cleanIsbn}`);
  return results[0] || null;
}

/**
 * Search for books by title and optionally author using Open Library
 */
export async function searchBookMetadata(
  title: string,
  author?: string,
): Promise<MetadataSearchResult[]> {
  const query = author ? `${title} ${author}` : title;

  // Check cache first
  const cacheKey = `openlibrary:search:${query.toLowerCase().trim()}`;
  const cached = metadataCache.get<MetadataSearchResult[]>(cacheKey);
  if (cached) {
    return cached;
  }

  const encodedQuery = encodeURIComponent(query);

  const response = await fetch(`https://openlibrary.org/search.json?q=${encodedQuery}&limit=10`);

  if (!response.ok) {
    console.error("Open Library search failed:", response.statusText);
    return [];
  }

  const data: OpenLibrarySearchResult = await response.json();

  const results = data.docs.map((doc) => {
    const coverUrl = doc.cover_i
      ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
      : null;

    return {
      title: doc.title,
      subtitle: doc.subtitle || null,
      authors: doc.author_name || [],
      publisher: doc.publisher?.[0] || null,
      publishedDate: doc.first_publish_year?.toString() || null,
      description: null,
      pageCount: doc.number_of_pages_median || null,
      isbn: doc.isbn?.[0] || null,
      isbn13: doc.isbn?.find((i) => i.length === 13) || null,
      isbn10: doc.isbn?.find((i) => i.length === 10) || null,
      language: doc.language?.[0] || null,
      subjects: doc.subject?.slice(0, 15) || [],
      series: doc.series?.[0] || null,
      seriesNumber: null,
      coverUrl,
      coverUrlHQ: null, // Open Library doesn't have HQ covers
      coverUrls: coverUrl ? [coverUrl] : [],
      source: "openlibrary" as const,
      sourceId: doc.key,
    };
  });

  // Cache the results
  metadataCache.set(cacheKey, results);
  return results;
}

/**
 * Look up book by ISBN on Open Library
 */
export async function lookupByISBN(isbn: string): Promise<MetadataSearchResult | null> {
  const cleanIsbn = isbn.replace(/[-\s]/g, "");

  // Check cache first
  const cacheKey = `openlibrary:isbn:${cleanIsbn}`;
  const cached = metadataCache.get<MetadataSearchResult | null>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const response = await fetch(`https://openlibrary.org/isbn/${cleanIsbn}.json`);

  if (!response.ok) {
    console.error("Open Library ISBN lookup failed:", response.statusText);
    // Cache the null result to avoid repeated failed lookups
    metadataCache.set(cacheKey, null);
    return null;
  }

  const book: OpenLibraryBook = await response.json();

  // Fetch authors if available
  const authors: string[] = [];
  if (book.authors) {
    for (const authorRef of book.authors) {
      try {
        const authorResponse = await fetch(`https://openlibrary.org${authorRef.key}.json`);
        if (authorResponse.ok) {
          const author: OpenLibraryAuthor = await authorResponse.json();
          authors.push(author.name);
        }
      } catch {
        // Skip this author if fetch fails
      }
    }
  }

  // Get description
  let description: string | null = null;
  if (book.description) {
    description = typeof book.description === "string" ? book.description : book.description.value;
  }

  // Get cover URL
  const coverUrl = book.covers?.[0]
    ? `https://covers.openlibrary.org/b/id/${book.covers[0]}-L.jpg`
    : null;

  // Parse language
  let language: string | null = null;
  if (book.languages?.[0]) {
    const langKey = book.languages[0].key;
    language = langKey.split("/").pop() || null;
  }

  // Combine all subjects
  const allSubjects = [
    ...(book.subjects || []),
    ...(book.subject_places || []),
    ...(book.subject_people || []),
    ...(book.subject_times || []),
  ].slice(0, 20);

  const result: MetadataSearchResult = {
    title: book.title,
    subtitle: book.subtitle || null,
    authors,
    publisher: book.publishers?.[0] || null,
    publishedDate: book.publish_date || null,
    description,
    pageCount: book.number_of_pages || null,
    isbn: book.isbn_13?.[0] || book.isbn_10?.[0] || cleanIsbn,
    isbn13: book.isbn_13?.[0] || null,
    isbn10: book.isbn_10?.[0] || null,
    language,
    subjects: allSubjects,
    series: book.series?.[0] || null,
    seriesNumber: null,
    coverUrl,
    coverUrlHQ: null,
    coverUrls: coverUrl ? [coverUrl] : [],
    source: "openlibrary",
    sourceId: `/isbn/${cleanIsbn}`,
  };

  // Cache the result
  metadataCache.set(cacheKey, result);
  return result;
}

/**
 * Get detailed book information from Open Library work key
 */
export async function getBookDetails(workKey: string): Promise<MetadataSearchResult | null> {
  // Check cache first
  const cacheKey = `openlibrary:work:${workKey}`;
  const cached = metadataCache.get<MetadataSearchResult | null>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const response = await fetch(`https://openlibrary.org${workKey}.json`);

  if (!response.ok) {
    console.error("Open Library work lookup failed:", response.statusText);
    metadataCache.set(cacheKey, null);
    return null;
  }

  const work = await response.json();

  // Get description
  let description: string | null = null;
  if (work.description) {
    description = typeof work.description === "string" ? work.description : work.description.value;
  }

  // Fetch authors
  const authors: string[] = [];
  if (work.authors) {
    for (const authorRef of work.authors) {
      const authorKey = authorRef.author?.key || authorRef.key;
      if (authorKey) {
        try {
          const authorResponse = await fetch(`https://openlibrary.org${authorKey}.json`);
          if (authorResponse.ok) {
            const author: OpenLibraryAuthor = await authorResponse.json();
            authors.push(author.name);
          }
        } catch {
          // Skip if fetch fails
        }
      }
    }
  }

  // Get cover URL
  const coverUrl = work.covers?.[0]
    ? `https://covers.openlibrary.org/b/id/${work.covers[0]}-L.jpg`
    : null;

  const result: MetadataSearchResult = {
    title: work.title,
    subtitle: work.subtitle || null,
    authors,
    publisher: null,
    publishedDate: work.first_publish_date || null,
    description,
    pageCount: null,
    isbn: null,
    isbn13: null,
    isbn10: null,
    language: null,
    subjects: work.subjects?.slice(0, 20) || [],
    series: null,
    seriesNumber: null,
    coverUrl,
    coverUrlHQ: null,
    coverUrls: coverUrl ? [coverUrl] : [],
    source: "openlibrary",
    sourceId: workKey,
  };

  // Cache the result
  metadataCache.set(cacheKey, result);
  return result;
}

/**
 * Try to find the best metadata match for a book
 * Searches multiple sources and combines best results
 */
export async function findBestMetadata(
  currentMetadata: BookMetadata,
): Promise<MetadataSearchResult | null> {
  let result: MetadataSearchResult | null = null;

  // Try ISBN lookup first (most accurate)
  if (currentMetadata.isbn) {
    // Try Google Books first for better covers
    const googleResult = await lookupGoogleBooksByISBN(currentMetadata.isbn);
    if (googleResult) {
      result = googleResult;
    }

    // Also get Open Library data for richer metadata
    const olResult = await lookupByISBN(currentMetadata.isbn);
    if (olResult) {
      if (result) {
        // Merge: prefer Google covers, OL metadata
        result = mergeMetadata(result, olResult);
      } else {
        result = olResult;
      }
    }

    if (result) {
      return result;
    }
  }

  // Fall back to title/author search
  if (currentMetadata.title) {
    // Search both sources in parallel - use allSettled so one failure doesn't break both
    const searchResults = await Promise.allSettled([
      searchGoogleBooks(
        currentMetadata.authors?.[0]
          ? `${currentMetadata.title} ${currentMetadata.authors[0]}`
          : currentMetadata.title,
      ),
      searchBookMetadata(currentMetadata.title, currentMetadata.authors?.[0]),
    ]);

    const googleResults = searchResults[0].status === "fulfilled" ? searchResults[0].value : [];
    const olResults = searchResults[1].status === "fulfilled" ? searchResults[1].value : [];

    // Prefer Google for covers, OL for metadata
    if (googleResults.length > 0) {
      result = googleResults[0];
    }

    if (olResults.length > 0) {
      // Get full details from Open Library
      const details = await getBookDetails(olResults[0].sourceId);
      const olData = details || olResults[0];

      if (result) {
        result = mergeMetadata(result, olData);
      } else {
        result = olData;
      }
    }
  }

  return result;
}

/**
 * Merge metadata from two sources, preferring the first for covers
 * and combining the best of both for other fields
 */
function mergeMetadata(
  primary: MetadataSearchResult,
  secondary: MetadataSearchResult,
): MetadataSearchResult {
  // Combine cover URLs from both sources, prioritizing primary's HQ covers
  const allCoverUrls = [...primary.coverUrls, ...secondary.coverUrls].filter(
    (url, index, arr) => arr.indexOf(url) === index,
  ); // dedupe

  return {
    title: primary.title || secondary.title,
    subtitle: primary.subtitle || secondary.subtitle,
    authors: primary.authors.length > 0 ? primary.authors : secondary.authors,
    publisher: primary.publisher || secondary.publisher,
    publishedDate: primary.publishedDate || secondary.publishedDate,
    description: primary.description || secondary.description,
    pageCount: primary.pageCount || secondary.pageCount,
    isbn: primary.isbn || secondary.isbn,
    isbn13: primary.isbn13 || secondary.isbn13,
    isbn10: primary.isbn10 || secondary.isbn10,
    language: primary.language || secondary.language,
    // Combine and dedupe subjects
    subjects: [...new Set([...primary.subjects, ...secondary.subjects])].slice(0, 20),
    series: primary.series || secondary.series,
    seriesNumber: primary.seriesNumber || secondary.seriesNumber,
    // Prefer HQ cover from primary (Google), fallback to secondary
    coverUrl: primary.coverUrlHQ || primary.coverUrl || secondary.coverUrl,
    coverUrlHQ: primary.coverUrlHQ || secondary.coverUrlHQ,
    coverUrls: allCoverUrls,
    source: primary.source,
    sourceId: primary.sourceId,
  };
}

/**
 * Search both Google Books and Open Library, returning combined results
 */
export async function searchAllSources(
  title: string,
  author?: string,
): Promise<MetadataSearchResult[]> {
  const query = author ? `${title} ${author}` : title;

  // Use allSettled so one API failure doesn't break the whole search
  const results = await Promise.allSettled([
    searchGoogleBooks(query),
    searchBookMetadata(title, author),
  ]);

  const googleResults = results[0].status === "fulfilled" ? results[0].value : [];
  const olResults = results[1].status === "fulfilled" ? results[1].value : [];

  // Interleave results, prioritizing Google for better covers
  const combined: MetadataSearchResult[] = [];
  const maxLen = Math.max(googleResults.length, olResults.length);

  for (let i = 0; i < maxLen; i++) {
    if (i < googleResults.length) {
      combined.push(googleResults[i]);
    }
    if (i < olResults.length) {
      combined.push(olResults[i]);
    }
  }

  return combined.slice(0, 20);
}
