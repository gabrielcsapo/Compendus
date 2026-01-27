"use client";

import { useState, useEffect } from "react";
import { Link } from "react-router";
import { addToWantedList, isBookWanted } from "../actions/wanted";
import {
  getAllSeriesWithCounts,
  getSeriesDetails,
  findMissingSeriesBooks,
  type SeriesInfo,
  type SeriesWithCounts,
} from "../actions/series";
import type { MetadataSearchResult } from "../lib/metadata";

export function Component() {
  const [seriesList, setSeriesList] = useState<SeriesWithCounts[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<string | null>(null);
  const [seriesDetails, setSeriesDetails] = useState<SeriesInfo | null>(null);
  const [missingBooks, setMissingBooks] = useState<MetadataSearchResult[]>([]);
  const [wantedMap, setWantedMap] = useState<Map<string, boolean>>(new Map());
  const [loading, setLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    loadSeriesList();
  }, []);

  const loadSeriesList = async () => {
    setLoadingList(true);
    try {
      const series = await getAllSeriesWithCounts();
      setSeriesList(series);
    } catch (error) {
      console.error("Failed to load series:", error);
    } finally {
      setLoadingList(false);
    }
  };

  const handleSelectSeries = async (seriesName: string) => {
    setSelectedSeries(seriesName);
    setLoading(true);
    setMissingBooks([]);

    try {
      const [details, missing] = await Promise.all([
        getSeriesDetails(seriesName),
        findMissingSeriesBooks(seriesName),
      ]);
      setSeriesDetails(details);
      setMissingBooks(missing);

      // Check wanted status for missing books
      const wantedStatus = new Map<string, boolean>();
      for (const book of missing) {
        const key = `${book.source}:${book.sourceId}`;
        const wanted = await isBookWanted(book);
        wantedStatus.set(key, wanted);
      }
      setWantedMap((prev) => new Map([...prev, ...wantedStatus]));
    } catch (error) {
      setMessage({ type: "error", text: "Failed to load series details" });
    } finally {
      setLoading(false);
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

  if (loadingList) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (seriesList.length === 0) {
    return (
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
              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
            />
          </svg>
        </div>
        <p className="text-foreground-muted mb-2">No series detected</p>
        <p className="text-foreground-muted/60 text-sm">
          Books with series metadata will appear here
        </p>
      </div>
    );
  }

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

      <div className="grid md:grid-cols-[300px_1fr] gap-6">
        {/* Series List */}
        <div className="bg-surface border border-border rounded-xl p-4 h-fit">
          <h3 className="font-semibold text-foreground mb-4">Your Series</h3>
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {seriesList.map((series) => (
              <button
                key={series.name}
                onClick={() => handleSelectSeries(series.name)}
                className={`w-full text-left p-3 rounded-lg transition-colors ${
                  selectedSeries === series.name
                    ? "bg-primary text-white"
                    : "hover:bg-surface-elevated"
                }`}
              >
                <div className="font-medium truncate">{series.name}</div>
                <div
                  className={`text-xs ${selectedSeries === series.name ? "text-white/70" : "text-foreground-muted"}`}
                >
                  {series.ownedCount} owned
                  {series.wantedCount > 0 && ` · ${series.wantedCount} wanted`}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Series Details */}
        <div>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : selectedSeries && seriesDetails ? (
            <div>
              <h3 className="text-xl font-semibold text-foreground mb-4">{seriesDetails.name}</h3>

              {/* Owned Books */}
              {seriesDetails.ownedBooks.length > 0 && (
                <div className="mb-6">
                  <h4 className="text-sm font-medium text-foreground-muted mb-3">
                    Owned ({seriesDetails.ownedBooks.length})
                  </h4>
                  <div className="flex flex-wrap gap-3">
                    {seriesDetails.ownedBooks.map((book) => (
                      <Link
                        key={book.id}
                        to={`/book/${book.id}`}
                        className="w-16 h-24 rounded-lg overflow-hidden bg-surface-elevated border border-border hover:border-primary transition-colors"
                        title={book.title}
                      >
                        {book.coverPath ? (
                          <img
                            src={`/covers/${book.id}.jpg`}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs text-foreground-muted p-1 text-center">
                            {book.seriesNumber || "?"}
                          </div>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Wanted Books in Series */}
              {seriesDetails.wantedBooks.length > 0 && (
                <div className="mb-6">
                  <h4 className="text-sm font-medium text-foreground-muted mb-3">
                    On Wanted List ({seriesDetails.wantedBooks.length})
                  </h4>
                  <div className="flex flex-wrap gap-3">
                    {seriesDetails.wantedBooks.map((book) => (
                      <div
                        key={book.id}
                        className="w-16 h-24 rounded-lg overflow-hidden bg-warning-light border border-warning/30"
                        title={book.title}
                      >
                        {book.coverUrl ? (
                          <img src={book.coverUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs text-foreground-muted p-1 text-center">
                            {book.seriesNumber || "?"}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Missing Books */}
              {missingBooks.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-foreground-muted mb-3">
                    Found in Search ({missingBooks.length})
                  </h4>
                  <div className="grid gap-3">
                    {missingBooks.map((book, index) => {
                      const key = `${book.source}:${book.sourceId}`;
                      return (
                        <ExternalBookCard
                          key={`${key}:${index}`}
                          book={book}
                          isWanted={wantedMap.get(key) || false}
                          onAddToWanted={() => handleAddToWanted(book)}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {missingBooks.length === 0 && seriesDetails.ownedBooks.length > 0 && (
                <p className="text-foreground-muted py-8 text-center">
                  No additional books found for this series in external databases.
                </p>
              )}
            </div>
          ) : (
            <div className="text-center py-16 text-foreground-muted">
              Select a series to see details and find missing books
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ExternalBookCard({
  book,
  isWanted,
  onAddToWanted,
}: {
  book: MetadataSearchResult;
  isWanted: boolean;
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
          disabled={isWanted}
          className={`mt-3 px-3 py-1.5 text-sm rounded-lg transition-colors ${
            isWanted
              ? "bg-surface-elevated text-foreground-muted cursor-not-allowed"
              : "bg-primary text-white hover:bg-primary-hover"
          }`}
        >
          {isWanted ? "Already Wanted" : "Add to Wanted"}
        </button>
      </div>
    </div>
  );
}
