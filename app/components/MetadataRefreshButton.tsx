"use client";

import { useState } from "react";
import {
  refreshMetadata,
  searchMetadata,
  applyMetadata,
} from "../actions/books";
import type { MetadataSearchResult } from "../lib/metadata";

interface MetadataRefreshButtonProps {
  bookId: string;
  bookTitle: string;
  bookAuthors: string[];
}

export function MetadataRefreshButton({
  bookId,
  bookTitle,
  bookAuthors,
}: MetadataRefreshButtonProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchResults, setSearchResults] = useState<MetadataSearchResult[]>(
    [],
  );
  const [searchQuery, setSearchQuery] = useState(bookTitle);

  const handleAutoRefresh = async () => {
    setLoading(true);
    setMessage(null);

    try {
      const result = await refreshMetadata(bookId);
      setMessage(result.message);
      if (result.success && result.book) {
        // Reload the page to show updated data
        window.location.reload();
      }
    } catch (error) {
      setMessage(`Failed to refresh metadata: ${(error as any).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    setLoading(true);
    setMessage(null);

    try {
      const results = await searchMetadata(searchQuery, bookAuthors[0]);
      setSearchResults(results);
      if (results.length === 0) {
        setMessage("No results found. Try different search terms.");
      }
    } catch (error) {
      setMessage(`Failed to search: ${(error as any).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async (metadata: MetadataSearchResult) => {
    setLoading(true);
    setMessage(null);

    try {
      const result = await applyMetadata(bookId, metadata);
      setMessage(result.message);
      if (result.success) {
        // Reload to show updated data
        window.location.reload();
      }
    } catch (error) {
      setMessage("Failed to apply metadata");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-4">
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={handleAutoRefresh}
          disabled={loading}
          className="btn btn-secondary text-sm"
        >
          {loading ? "Loading..." : "Auto-Refresh Metadata"}
        </button>
        <button
          onClick={() => setShowSearch(!showSearch)}
          className="btn btn-secondary text-sm"
        >
          {showSearch ? "Hide Search" : "Search Metadata"}
        </button>
      </div>

      {message && <p className="mt-2 text-sm text-gray-600">{message}</p>}

      {showSearch && (
        <div className="mt-4 p-4 border rounded-lg">
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title..."
              className="flex-1 px-3 py-2 border rounded"
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <button onClick={handleSearch} disabled={loading} className="btn">
              Search
            </button>
          </div>

          {searchResults.length > 0 && (
            <div className="space-y-3">
              {searchResults.map((result, index) => (
                <div
                  key={index}
                  className="p-3 border rounded hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => handleApply(result)}
                >
                  <div className="flex gap-3">
                    {(result.coverUrlHQ || result.coverUrl) && (
                      <img
                        src={result.coverUrlHQ || result.coverUrl || ""}
                        alt=""
                        className="w-12 h-18 object-cover rounded shadow-sm"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium truncate">{result.title}</h4>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded ${
                            result.source === "googlebooks"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-green-100 text-green-700"
                          }`}
                        >
                          {result.source === "googlebooks"
                            ? "Google"
                            : "OpenLib"}
                        </span>
                      </div>
                      {result.subtitle && (
                        <p className="text-sm text-gray-500 truncate">
                          {result.subtitle}
                        </p>
                      )}
                      {result.authors.length > 0 && (
                        <p className="text-sm text-gray-600">
                          {result.authors.join(", ")}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        {result.publishedDate && (
                          <span className="text-xs text-gray-400">
                            {result.publishedDate}
                          </span>
                        )}
                        {result.pageCount && (
                          <span className="text-xs text-gray-400">
                            {result.pageCount} pages
                          </span>
                        )}
                        {result.series && (
                          <span className="text-xs text-purple-600">
                            {result.series}
                          </span>
                        )}
                      </div>
                      {result.description && (
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                          {result.description}
                        </p>
                      )}
                      {result.subjects.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {result.subjects.slice(0, 3).map((subject, i) => (
                            <span
                              key={i}
                              className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded"
                            >
                              {subject}
                            </span>
                          ))}
                          {result.subjects.length > 3 && (
                            <span className="text-xs text-gray-400">
                              +{result.subjects.length - 3} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
