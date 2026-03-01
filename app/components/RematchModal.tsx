"use client";

import { useState } from "react";
import { refreshMetadata, searchMetadata, applyMetadata } from "../actions/books";
import { buttonStyles, badgeStyles, inputStyles } from "../lib/styles";
import type { MetadataSearchResult } from "../lib/metadata";
import type { BookFormat } from "../lib/types";

interface RematchModalProps {
  isOpen: boolean;
  onClose: () => void;
  bookId: string;
  bookTitle: string;
  bookAuthors: string[];
  bookFormat?: BookFormat;
  hasCover?: boolean;
  coverUrl?: string;
}

export function RematchModal({
  isOpen,
  onClose,
  bookId,
  bookTitle,
  bookAuthors,
  bookFormat,
  hasCover,
  coverUrl,
}: RematchModalProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const [searchResults, setSearchResults] = useState<MetadataSearchResult[]>([]);
  const [searchQuery, setSearchQuery] = useState(bookTitle);
  const [pendingMetadata, setPendingMetadata] = useState<MetadataSearchResult | null>(null);
  const [showCoverPrompt, setShowCoverPrompt] = useState(false);

  const handleAutoRefresh = async () => {
    setLoading(true);
    setMessage(null);

    try {
      const result = await refreshMetadata(bookId);
      setMessage({ text: result.message, type: result.success ? "success" : "info" });
      if (result.success && result.book) {
        setTimeout(() => window.location.reload(), 1000);
      }
    } catch (error) {
      setMessage({ text: `Failed to refresh metadata: ${(error as any).message}`, type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setMessage(null);

    try {
      const results = await searchMetadata(searchQuery, bookAuthors[0], bookFormat);
      setSearchResults(results);
      if (results.length === 0) {
        setMessage({ text: "No results found. Try different search terms.", type: "info" });
      }
    } catch (error) {
      setMessage({ text: `Failed to search: ${(error as any).message}`, type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async (metadata: MetadataSearchResult) => {
    if (hasCover && (metadata.coverUrl || metadata.coverUrlHQ)) {
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
      setMessage({ text: result.message, type: result.success ? "success" : "error" });
      if (result.success) {
        setTimeout(() => window.location.reload(), 1000);
      }
    } catch {
      setMessage({ text: "Failed to apply metadata", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setMessage(null);
      setSearchResults([]);
      setSearchQuery(bookTitle);
      setPendingMetadata(null);
      setShowCoverPrompt(false);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      {/* Modal */}
      <div className="relative bg-surface border border-border rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold text-foreground">Rematch Metadata</h2>
          <button
            onClick={handleClose}
            disabled={loading}
            className="text-foreground-muted hover:text-foreground disabled:opacity-50"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1">
          {/* Auto-refresh */}
          <div className="mb-6">
            <button
              onClick={handleAutoRefresh}
              disabled={loading}
              className={`${buttonStyles.base} ${buttonStyles.secondary} w-full justify-center gap-2`}
            >
              {loading && !searchResults.length ? (
                <>
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Refreshing...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Refresh Metadata
                </>
              )}
            </button>
            <p className="text-xs text-foreground-muted mt-2 text-center">
              Automatically find and apply the best metadata match
            </p>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 border-t border-border" />
            <span className="text-xs text-foreground-muted uppercase tracking-wider">or search manually</span>
            <div className="flex-1 border-t border-border" />
          </div>

          {/* Search */}
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, author, or ISBN..."
              className={`${inputStyles} flex-1`}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              disabled={loading}
            />
            <button
              onClick={handleSearch}
              disabled={loading || !searchQuery.trim()}
              className={`${buttonStyles.base} ${buttonStyles.primary} shrink-0`}
            >
              {loading && searchResults.length === 0 ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Search
                </>
              )}
            </button>
          </div>

          {/* Message */}
          {message && (
            <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${
              message.type === "success"
                ? "bg-success-light text-success border border-success/20"
                : message.type === "error"
                ? "bg-danger-light text-danger border border-danger/20"
                : "bg-surface-elevated text-foreground-muted border border-border"
            }`}>
              {message.text}
            </div>
          )}

          {/* Results */}
          {searchResults.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-foreground-muted mb-3">
                {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} found. Click to apply.
              </p>
              {searchResults.map((result, index) => (
                <button
                  key={index}
                  type="button"
                  className="w-full text-left p-3 border border-border rounded-lg hover:bg-surface-elevated hover:border-primary/30 cursor-pointer transition-colors disabled:opacity-50"
                  onClick={() => handleApply(result)}
                  disabled={loading}
                >
                  <div className="flex gap-3">
                    {(result.coverUrlHQ || result.coverUrl) && (
                      <img
                        src={result.coverUrlHQ || result.coverUrl || ""}
                        alt=""
                        className="w-12 h-18 object-cover rounded shadow-sm shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium truncate text-foreground">{result.title}</h4>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
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
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {result.publishedDate && (
                          <span className="text-xs text-foreground-muted/70">{result.publishedDate}</span>
                        )}
                        {result.pageCount && (
                          <span className="text-xs text-foreground-muted/70">{result.pageCount} pages</span>
                        )}
                        {result.series && (
                          <span className="text-xs text-accent">{result.series}</span>
                        )}
                      </div>
                      {result.description && (
                        <p className="text-xs text-foreground-muted mt-1 line-clamp-2">{result.description}</p>
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
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cover update prompt */}
      {showCoverPrompt && pendingMetadata && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-surface border border-border rounded-xl p-6 max-w-lg w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-foreground mb-2">Update Cover Image?</h3>
            <p className="text-foreground-muted mb-4">
              This book already has a cover. Would you like to replace it with the one from the metadata source?
            </p>

            <div className="flex gap-4 justify-center mb-6">
              {coverUrl && (
                <div className="text-center">
                  <p className="text-xs font-medium text-foreground-muted mb-2">Current</p>
                  <div className="w-24 h-36 rounded-lg overflow-hidden border border-border bg-surface-elevated">
                    <img src={coverUrl} alt="Current cover" className="w-full h-full object-cover" />
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
