"use client";

import { useState } from "react";
import { searchAllSources, type MetadataSearchResult } from "../lib/metadata";
import { addToWantedList, isBookWanted, isBookOwned } from "../actions/wanted";

export function Component() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MetadataSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [wantedMap, setWantedMap] = useState<Map<string, boolean>>(new Map());
  const [ownedMap, setOwnedMap] = useState<Map<string, boolean>>(new Map());
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setSearching(true);
    setMessage(null);

    try {
      const results = await searchAllSources(searchQuery);
      setSearchResults(results);

      // Check which results are already wanted or owned
      const wantedStatus = new Map<string, boolean>();
      const ownedStatus = new Map<string, boolean>();

      for (const result of results) {
        const key = `${result.source}:${result.sourceId}`;
        const [wanted, owned] = await Promise.all([isBookWanted(result), isBookOwned(result)]);
        wantedStatus.set(key, wanted);
        ownedStatus.set(key, owned);
      }

      setWantedMap(wantedStatus);
      setOwnedMap(ownedStatus);

      if (results.length === 0) {
        setMessage({ type: "error", text: "No results found. Try different search terms." });
      }
    } catch (error) {
      setMessage({ type: "error", text: "Search failed. Please try again." });
    } finally {
      setSearching(false);
    }
  };

  const handleAddToWanted = async (result: MetadataSearchResult) => {
    try {
      await addToWantedList(result);
      const key = `${result.source}:${result.sourceId}`;
      setWantedMap((prev) => new Map(prev).set(key, true));
      setMessage({ type: "success", text: `Added "${result.title}" to wanted list` });
    } catch (error) {
      setMessage({ type: "error", text: (error as Error).message });
    }
  };

  return (
    <div>
      {/* Message */}
      {message && (
        <div
          className={`mb-4 p-3 rounded-lg border ${
            message.type === "success"
              ? "bg-success-light text-success border-success/20"
              : "bg-danger-light text-danger border-danger/20"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Search Input */}
      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by title, author, or ISBN..."
          className="flex-1 px-4 py-3 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <button
          onClick={handleSearch}
          disabled={searching || !searchQuery.trim()}
          className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors"
        >
          {searching ? "Searching..." : "Search"}
        </button>
      </div>

      {/* Results */}
      {searching ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : searchResults.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {searchResults.map((result, index) => {
            const key = `${result.source}:${result.sourceId}`;
            return (
              <ExternalBookCard
                key={`${key}:${index}`}
                book={result}
                isWanted={wantedMap.get(key) || false}
                isOwned={ownedMap.get(key) || false}
                onAddToWanted={() => handleAddToWanted(result)}
              />
            );
          })}
        </div>
      ) : (
        <div className="text-center py-16">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-elevated flex items-center justify-center">
            <svg
              className="w-8 h-8 text-foreground-muted"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <p className="text-foreground-muted">
            Search Google Books and Open Library for books to add to your wanted list
          </p>
        </div>
      )}
    </div>
  );
}

function ExternalBookCard({
  book,
  isWanted,
  isOwned,
  onAddToWanted,
}: {
  book: MetadataSearchResult;
  isWanted: boolean;
  isOwned: boolean;
  onAddToWanted: () => void;
}) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4 flex gap-4">
      {/* Cover */}
      <div className="w-20 h-28 flex-shrink-0 rounded-lg overflow-hidden bg-surface-elevated">
        {book.coverUrl ? (
          <img src={book.coverUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-foreground-muted p-2 text-center">
            No Cover
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground line-clamp-2">{book.title}</h3>
            {book.authors.length > 0 && (
              <p className="text-sm text-foreground-muted truncate">{book.authors.join(", ")}</p>
            )}
          </div>
          <span
            className={`text-xs px-2 py-0.5 rounded flex-shrink-0 ${
              book.source === "googlebooks"
                ? "badge-primary"
                : "badge-success"
            }`}
          >
            {book.source === "googlebooks" ? "Google" : "OpenLib"}
          </span>
        </div>

        <div className="flex items-center gap-2 mt-1 text-xs text-foreground-muted">
          {book.publishedDate && <span>{book.publishedDate}</span>}
          {book.pageCount && <span>{book.pageCount} pages</span>}
        </div>

        {book.series && (
          <p className="text-xs text-primary mt-1">
            Series: {book.series} {book.seriesNumber && `#${book.seriesNumber}`}
          </p>
        )}

        <button
          onClick={onAddToWanted}
          disabled={isWanted || isOwned}
          className={`mt-3 px-3 py-1.5 text-sm rounded-lg transition-colors ${
            isOwned
              ? "bg-success-light text-success cursor-not-allowed"
              : isWanted
                ? "bg-surface-elevated text-foreground-muted cursor-not-allowed"
                : "bg-primary text-white hover:bg-primary-hover"
          }`}
        >
          {isOwned ? "Already Owned" : isWanted ? "Already Wanted" : "Add to Wanted"}
        </button>
      </div>
    </div>
  );
}
