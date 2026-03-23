"use client";

import { useState } from "react";
import { useRouter } from "react-flight-router/client";
import { refreshMetadata, searchMetadata, applyMetadata } from "../actions/books";
import { buttonStyles, badgeStyles, inputStyles } from "../lib/styles";
import type { MetadataSearchResult } from "../lib/metadata";
import type { BookFormat } from "../lib/types";

interface MetadataRefreshButtonProps {
  bookId: string;
  bookTitle: string;
  bookAuthors: string[];
  bookFormat?: BookFormat;
  hasCover?: boolean;
  coverUrl?: string;
}

export function MetadataRefreshButton({
  bookId,
  bookTitle,
  bookAuthors,
  bookFormat,
  hasCover,
  coverUrl,
}: MetadataRefreshButtonProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchResults, setSearchResults] = useState<MetadataSearchResult[]>([]);
  const [searchQuery, setSearchQuery] = useState(bookTitle);
  const [pendingMetadata, setPendingMetadata] = useState<MetadataSearchResult | null>(null);
  const [showCoverPrompt, setShowCoverPrompt] = useState(false);
  const router = useRouter();

  const handleAutoRefresh = async () => {
    setLoading(true);
    setMessage(null);

    try {
      const result = await refreshMetadata(bookId);
      setMessage(result.message);
      if (result.success && result.book) {
        // Reload the page to show updated data
        router.refresh();
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
      const results = await searchMetadata(searchQuery, bookAuthors[0], bookFormat);
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
    if (hasCover) {
      setPendingMetadata(metadata);
      setShowCoverPrompt(true);
      return;
    }

    await doApplyMetadata(metadata);
  };

  const doApplyMetadata = async (metadata: MetadataSearchResult, skipCover = false) => {
    setLoading(true);
    setMessage(null);
    setShowCoverPrompt(false);
    setPendingMetadata(null);

    try {
      const result = await applyMetadata(bookId, metadata, { skipCover });
      setMessage(result.message);
      if (result.success) {
        // Reload to show updated data
        router.refresh();
      }
    } catch {
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
          className={`${buttonStyles.base} ${buttonStyles.secondary} text-sm`}
        >
          {loading ? "Loading..." : "Auto-Refresh Metadata"}
        </button>
        <button
          onClick={() => setShowSearch(!showSearch)}
          className={`${buttonStyles.base} ${buttonStyles.secondary} text-sm`}
        >
          {showSearch ? "Hide Search" : "Search Metadata"}
        </button>
      </div>

      {message && <p className="mt-2 text-sm text-foreground-muted">{message}</p>}

      {showSearch && (
        <div className="mt-4 p-4 border border-border rounded-lg bg-surface">
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title..."
              className={`${inputStyles} flex-1`}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <button onClick={handleSearch} disabled={loading} className={buttonStyles.base}>
              Search
            </button>
          </div>

          {searchResults.length > 0 && (
            <div className="space-y-3">
              {searchResults.map((result, index) => (
                <div
                  key={index}
                  className="p-3 border border-border rounded hover:bg-surface-elevated cursor-pointer transition-colors"
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
                        <h4 className="font-medium truncate text-foreground">{result.title}</h4>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded ${
                            result.source === "googlebooks"
                              ? badgeStyles.primary
                              : badgeStyles.success
                          }`}
                        >
                          {result.source === "googlebooks" ? "Google" : "OpenLib"}
                        </span>
                      </div>
                      {result.subtitle && (
                        <p className="text-sm text-foreground-muted truncate">{result.subtitle}</p>
                      )}
                      {result.authors.length > 0 && (
                        <p className="text-sm text-foreground-muted">{result.authors.join(", ")}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        {result.publishedDate && (
                          <span className="text-xs text-foreground-muted/70">
                            {result.publishedDate}
                          </span>
                        )}
                        {result.pageCount && (
                          <span className="text-xs text-foreground-muted/70">
                            {result.pageCount} pages
                          </span>
                        )}
                        {result.series && (
                          <span className="text-xs text-accent">{result.series}</span>
                        )}
                      </div>
                      {result.description && (
                        <p className="text-xs text-foreground-muted mt-1 line-clamp-2">
                          {result.description}
                        </p>
                      )}
                      {result.subjects.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {result.subjects.slice(0, 3).map((subject, i) => (
                            <span
                              key={i}
                              className="text-xs bg-surface-elevated text-foreground-muted px-1.5 py-0.5 rounded"
                            >
                              {subject}
                            </span>
                          ))}
                          {result.subjects.length > 3 && (
                            <span className="text-xs text-foreground-muted/70">
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

      {/* Cover update prompt */}
      {showCoverPrompt && pendingMetadata && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-border rounded-xl p-6 max-w-lg w-full">
            <h3 className="text-lg font-semibold text-foreground mb-2">Update Cover Image?</h3>
            <p className="text-foreground-muted mb-4">
              This book already has a cover. Would you like to replace it with the one from the
              metadata source?
            </p>

            <div className="flex gap-4 justify-center mb-6">
              {coverUrl && (
                <div className="text-center">
                  <p className="text-xs font-medium text-foreground-muted mb-2">Current</p>
                  <div className="w-24 h-36 rounded-lg overflow-hidden border border-border bg-surface-elevated">
                    <img
                      src={coverUrl}
                      alt="Current cover"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              )}
              {(pendingMetadata.coverUrlHQ || pendingMetadata.coverUrl) && (
                <div className="text-center">
                  <p className="text-xs font-medium text-foreground-muted mb-2">New</p>
                  <div className="w-24 h-36 rounded-lg overflow-hidden border border-border bg-surface-elevated">
                    <img
                      src={pendingMetadata.coverUrlHQ || pendingMetadata.coverUrl || ""}
                      alt="New cover"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowCoverPrompt(false);
                  setPendingMetadata(null);
                }}
                className="px-4 py-2 text-foreground-muted hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => doApplyMetadata(pendingMetadata, true)}
                className="px-4 py-2 border border-border rounded-lg text-foreground hover:bg-surface-elevated transition-colors"
              >
                Keep Current Cover
              </button>
              <button
                onClick={() => doApplyMetadata(pendingMetadata, false)}
                className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors"
              >
                Use New Cover
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
