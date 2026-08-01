import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getBooks, type BookWithState } from "../../actions/books";
import { getWantedBooks } from "../../actions/wanted";
import { db, rawDb, curatedDiscovery } from "../db";
import { ollamaChatJson, parseModelJson } from "../llm/ollama";
import { searchAllSources } from "../metadata";

export const DISCOVERY_PROMPT_VERSION = "trip-discovery-v1";
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const activeRefreshes = new Map<string, Promise<CuratedDiscovery>>();

export type CuratedShelf = {
  id: string;
  title: string;
  subtitle: string;
  bookIds: string[];
  reasons: Record<string, string>;
};

export type PurchaseIdea = {
  id: string;
  title: string;
  authors: string[];
  formatHint: "book" | "comic" | "audiobook";
  reason: string;
  coverUrl: string | null;
  isbn13: string | null;
  purchaseUrl: string;
};

export type CuratedDiscovery = {
  shelves: CuratedShelf[];
  purchases: PurchaseIdea[];
  generatedAt: string;
  source: "lemonade" | "fallback";
  modelId: string | null;
};

type ModelResponse = {
  shelves?: Array<{
    id?: string;
    title?: string;
    subtitle?: string;
    items?: Array<{ bookId?: string; reason?: string }>;
  }>;
  purchases?: Array<{
    title?: string;
    author?: string;
    formatHint?: string;
    reason?: string;
  }>;
};

function authors(book: BookWithState): string[] {
  try {
    return JSON.parse(book.authors || "[]") as string[];
  } catch {
    return [];
  }
}

function compactReason(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return (text || fallback).slice(0, 180);
}

function formatKind(book: BookWithState): "book" | "comic" | "audiobook" {
  const format = book.format.toLowerCase();
  if (["m4b", "mp3", "m4a"].includes(format)) return "audiobook";
  if (["cbz", "cbr"].includes(format) || book.bookTypeOverride === "comic") return "comic";
  return "book";
}

function sourceFingerprint(profileId: string): string {
  const row = rawDb
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM books) AS book_count,
        (SELECT COALESCE(MAX(updated_at), 0) FROM books) AS books_updated,
        (SELECT COALESCE(MAX(updated_at), 0) FROM user_book_state WHERE profile_id = ?) AS state_updated,
        (SELECT COALESCE(MAX(updated_at), 0) FROM wanted_books WHERE profile_id = ?) AS wanted_updated`,
    )
    .get(profileId, profileId) as Record<string, number>;
  return createHash("sha256").update(JSON.stringify(row)).digest("hex").slice(0, 24);
}

function chooseCandidates(all: BookWithState[]): BookWithState[] {
  const unread = all.filter((book) => !book.isRead && !book.isSetAside);
  const stable = [...unread].sort((a, b) => a.id.localeCompare(b.id));
  const buckets = [
    stable.filter((book) => formatKind(book) === "audiobook").slice(0, 24),
    stable.filter((book) => formatKind(book) === "comic").slice(0, 24),
    stable.filter((book) => book.pageCount && book.pageCount <= 320).slice(0, 30),
    stable.filter((book) => (book.description?.length ?? 0) > 80).slice(0, 42),
  ];
  return [...new Map(buckets.flat().map((book) => [book.id, book])).values()].slice(0, 100);
}

function fallbackShelves(candidates: BookWithState[]): CuratedShelf[] {
  const used = new Set<string>();
  const make = (
    id: string,
    title: string,
    subtitle: string,
    books: BookWithState[],
    reason: (book: BookWithState) => string,
  ): CuratedShelf | null => {
    const picked = books.filter((book) => !used.has(book.id)).slice(0, 10);
    if (picked.length < 2) return null;
    picked.forEach((book) => used.add(book.id));
    return {
      id,
      title,
      subtitle,
      bookIds: picked.map((book) => book.id),
      reasons: Object.fromEntries(picked.map((book) => [book.id, reason(book)])),
    };
  };
  const books = candidates.filter((book) => formatKind(book) === "book");
  return [
    make(
      "trip_picks",
      "Pack for the Trip",
      "A varied shelf from books you already own.",
      books.filter((book) => !book.pageCount || book.pageCount <= 500),
      (book) =>
        book.pageCount
          ? `${book.pageCount} pages and ready to download.`
          : "Ready to download for the trip.",
    ),
    make(
      "short_stretches",
      "Flights, Ferries & Cafés",
      "Books that fit naturally into shorter stretches of reading.",
      books.filter((book) => book.pageCount && book.pageCount <= 320),
      (book) => `${book.pageCount} pages—easy to make progress between stops.`,
    ),
    make(
      "listen_on_the_move",
      "Listen on the Move",
      "Audiobooks from your library for travel days.",
      candidates.filter((book) => formatKind(book) === "audiobook"),
      () => "Already in your library and suited to hands-free travel.",
    ),
    make(
      "comics_for_downtime",
      "Comics for Downtime",
      "Visual reads from your library for relaxed evenings.",
      candidates.filter((book) => formatKind(book) === "comic"),
      () => "A visual change of pace that is already yours.",
    ),
  ].filter((shelf): shelf is CuratedShelf => shelf != null);
}

function buildPrompt(candidates: BookWithState[], tasteBooks: BookWithState[]): string {
  const encode = (book: BookWithState) => ({
    id: book.id,
    title: book.title,
    authors: authors(book),
    format: book.format,
    kind: formatKind(book),
    pages: book.pageCount,
    durationSeconds: book.duration,
    series: book.series,
    description: book.description?.replace(/\s+/g, " ").slice(0, 360) || null,
  });
  return JSON.stringify({
    context:
      "The reader is choosing offline entertainment for a two-week trip to Greece. Variety and travel-friendly pacing matter more than a literal Greece theme.",
    previouslyEnjoyed: tasteBooks.slice(0, 20).map(encode),
    ownedUnreadCandidates: candidates.map(encode),
    instructions: [
      "Create 3-4 distinct owned shelves, 4-8 items each.",
      "Use ONLY exact ids from ownedUnreadCandidates. Never invent or alter an owned id.",
      "Include books, comics, and audiobooks when candidates exist.",
      "Keep each item reason specific and under 120 characters.",
      "Suggest up to 4 external purchases that complement the library. Use real, well-known works and label book/comic/audiobook.",
    ],
    schema: {
      shelves: [
        {
          id: "snake_case",
          title: "string",
          subtitle: "string",
          items: [{ bookId: "exact id", reason: "string" }],
        },
      ],
      purchases: [
        { title: "string", author: "string", formatHint: "book|comic|audiobook", reason: "string" },
      ],
    },
  });
}

const SYSTEM_PROMPT = `You are Compendus's careful library curator. Return one strict JSON object only.
Ground owned recommendations exclusively in the supplied catalog. Favor a varied, achievable trip stack over famous titles. Do not claim an external purchase is owned.`;

function validateShelves(raw: ModelResponse, candidates: BookWithState[]): CuratedShelf[] {
  const validIds = new Set(candidates.map((book) => book.id));
  const globallyUsed = new Set<string>();
  return (raw.shelves ?? [])
    .slice(0, 4)
    .map((shelf, index) => {
      const reasons: Record<string, string> = {};
      const ids: string[] = [];
      for (const item of shelf.items ?? []) {
        const id = item.bookId ?? "";
        if (!validIds.has(id) || globallyUsed.has(id)) continue;
        globallyUsed.add(id);
        ids.push(id);
        reasons[id] = compactReason(item.reason, "A grounded pick from your unread library.");
        if (ids.length === 8) break;
      }
      if (ids.length < 2) return null;
      return {
        id: (shelf.id || `curated_${index}`).replace(/[^a-z0-9_]+/gi, "_").toLowerCase(),
        title: compactReason(shelf.title, "For Your Trip").slice(0, 60),
        subtitle: compactReason(shelf.subtitle, "Selected from books you already own."),
        bookIds: ids,
        reasons,
      };
    })
    .filter((shelf): shelf is CuratedShelf => shelf != null);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function validatePurchases(
  raw: ModelResponse,
  owned: BookWithState[],
): Promise<PurchaseIdea[]> {
  const ownedTitles = new Set(owned.map((book) => normalize(book.title)));
  const suggestions = (raw.purchases ?? []).slice(0, 4);
  const resolved = await Promise.all(
    suggestions.map(async (suggestion): Promise<PurchaseIdea | null> => {
      const title = suggestion.title?.trim();
      const author = suggestion.author?.trim();
      if (!title || !author || ownedTitles.has(normalize(title))) return null;
      const results = await searchAllSources(title, author);
      const match = results.find(
        (result) =>
          normalize(result.title) === normalize(title) &&
          result.authors.some((name) => normalize(name).includes(normalize(author))),
      );
      if (!match) return null;
      const kind = ["comic", "audiobook"].includes(suggestion.formatHint ?? "")
        ? (suggestion.formatHint as "comic" | "audiobook")
        : "book";
      const query = encodeURIComponent(`${match.title} ${match.authors[0] ?? author}`);
      return {
        id: `${match.source}:${match.sourceId}`,
        title: match.title,
        authors: match.authors,
        formatHint: kind,
        reason: compactReason(suggestion.reason, "A verified title to consider adding."),
        coverUrl: match.coverUrlHQ || match.coverUrl,
        isbn13: match.isbn13,
        purchaseUrl: `https://books.google.com/books?q=${query}`,
      };
    }),
  );
  return resolved.filter((item): item is PurchaseIdea => item != null);
}

async function generate(profileId: string): Promise<CuratedDiscovery> {
  const all = await getBooks({ limit: 10000, profileId });
  const candidates = chooseCandidates(all);
  const taste = all
    .filter((book) => book.isRead || (book.rating ?? 0) >= 4)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const fallback = fallbackShelves(candidates);
  let result: CuratedDiscovery = {
    shelves: fallback,
    purchases: [],
    generatedAt: new Date().toISOString(),
    source: "fallback",
    modelId: null,
  };

  try {
    const response = await ollamaChatJson(SYSTEM_PROMPT, buildPrompt(candidates, taste), {
      temperature: 0.25,
    });
    const parsed = parseModelJson<ModelResponse>(response.content);
    const shelves = validateShelves(parsed, candidates);
    if (shelves.length >= 2) {
      const wishlist = await getWantedBooks({ limit: 12, filterOwned: true }, profileId);
      const wishlistIdeas: PurchaseIdea[] = wishlist.books.map((book) => ({
        id: `wishlist:${book.id}`,
        title: book.title,
        authors: (() => {
          try {
            return book.authors ? (JSON.parse(book.authors) as string[]) : [];
          } catch {
            return [];
          }
        })(),
        formatHint: "book",
        reason: book.notes || "Already saved on your Compendus wishlist.",
        coverUrl: book.coverUrl,
        isbn13: book.isbn13,
        purchaseUrl: `https://books.google.com/books?q=${encodeURIComponent(`${book.title} ${book.authors ?? ""}`)}`,
      }));
      const verified = await validatePurchases(parsed, all);
      result = {
        shelves,
        purchases: [...wishlistIdeas, ...verified].slice(0, 6),
        generatedAt: new Date().toISOString(),
        source: "lemonade",
        modelId: response.modelId,
      };
    }
  } catch (error) {
    console.warn("[Discovery] Lemonade unavailable; retaining deterministic shelves:", error);
  }

  const now = new Date();
  await db
    .insert(curatedDiscovery)
    .values({
      profileId,
      payload: JSON.stringify(result),
      sourceFingerprint: sourceFingerprint(profileId),
      promptVersion: DISCOVERY_PROMPT_VERSION,
      modelId: result.modelId,
      generatedAt: now,
      expiresAt: new Date(now.getTime() + CACHE_MS),
    })
    .onConflictDoUpdate({
      target: curatedDiscovery.profileId,
      set: {
        payload: JSON.stringify(result),
        sourceFingerprint: sourceFingerprint(profileId),
        promptVersion: DISCOVERY_PROMPT_VERSION,
        modelId: result.modelId,
        generatedAt: now,
        expiresAt: new Date(now.getTime() + CACHE_MS),
      },
    });
  return result;
}

export function refreshCuratedDiscovery(profileId: string): Promise<CuratedDiscovery> {
  const existing = activeRefreshes.get(profileId);
  if (existing) return existing;
  const refresh = generate(profileId).finally(() => activeRefreshes.delete(profileId));
  activeRefreshes.set(profileId, refresh);
  return refresh;
}

export async function getCuratedDiscovery(profileId: string): Promise<CuratedDiscovery> {
  const row = await db
    .select()
    .from(curatedDiscovery)
    .where(eq(curatedDiscovery.profileId, profileId))
    .get();
  const fingerprint = sourceFingerprint(profileId);
  const fresh =
    row &&
    row.promptVersion === DISCOVERY_PROMPT_VERSION &&
    row.sourceFingerprint === fingerprint &&
    row.expiresAt.getTime() > Date.now();

  if (row) {
    if (!fresh) void refreshCuratedDiscovery(profileId);
    try {
      return JSON.parse(row.payload) as CuratedDiscovery;
    } catch {
      // Regenerate below if a partial/corrupt payload was ever persisted.
    }
  }

  // First load must also be fast and offline-safe; store/return grounded
  // deterministic shelves now, while Lemonade improves them in the background.
  const all = await getBooks({ limit: 10000, profileId });
  const fallback: CuratedDiscovery = {
    shelves: fallbackShelves(chooseCandidates(all)),
    purchases: [],
    generatedAt: new Date().toISOString(),
    source: "fallback",
    modelId: null,
  };
  void refreshCuratedDiscovery(profileId);
  return fallback;
}
