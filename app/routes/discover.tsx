"use client";

import { useState, useEffect } from "react";
import { Link } from "react-router";
import { searchAllSources, type MetadataSearchResult } from "../lib/metadata";
import {
  getWantedBooks,
  addToWantedList,
  removeFromWantedList,
  updateWantedBook,
  isBookWanted,
  isBookOwned,
  getWantedBooksCount,
} from "../actions/wanted";
import {
  getAllSeriesWithCounts,
  getSeriesDetails,
  findMissingSeriesBooks,
  type SeriesInfo,
  type SeriesWithCounts,
} from "../actions/series";
import type { WantedBook } from "../lib/db/schema";

type Tab = "search" | "wanted" | "series";

export default function Discover() {
  const [activeTab, setActiveTab] = useState<Tab>("search");

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MetadataSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [wantedMap, setWantedMap] = useState<Map<string, boolean>>(new Map());
  const [ownedMap, setOwnedMap] = useState<Map<string, boolean>>(new Map());

  // Wanted list state
  const [wantedBooks, setWantedBooksState] = useState<WantedBook[]>([]);
  const [wantedCount, setWantedCount] = useState(0);
  const [loadingWanted, setLoadingWanted] = useState(false);

  // Series state
  const [seriesList, setSeriesList] = useState<SeriesWithCounts[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<string | null>(null);
  const [seriesDetails, setSeriesDetails] = useState<SeriesInfo | null>(null);
  const [missingBooks, setMissingBooks] = useState<MetadataSearchResult[]>([]);
  const [loadingSeries, setLoadingSeries] = useState(false);
  const [loadingSeriesList, setLoadingSeriesList] = useState(true);

  // Message state
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Load wanted count on mount
  useEffect(() => {
    loadWantedCount();
    loadSeriesList();
  }, []);

  // Load wanted list when tab changes
  useEffect(() => {
    if (activeTab === "wanted") {
      loadWantedList();
    }
  }, [activeTab]);

  const loadWantedCount = async () => {
    try {
      const count = await getWantedBooksCount();
      setWantedCount(count);
    } catch (error) {
      console.error("Failed to load wanted count:", error);
    }
  };

  const loadWantedList = async () => {
    setLoadingWanted(true);
    try {
      const [books, count] = await Promise.all([getWantedBooks(), getWantedBooksCount()]);
      setWantedBooksState(books);
      setWantedCount(count);
    } catch (error) {
      setMessage({ type: "error", text: "Failed to load wanted list" });
    } finally {
      setLoadingWanted(false);
    }
  };

  const loadSeriesList = async () => {
    setLoadingSeriesList(true);
    try {
      const series = await getAllSeriesWithCounts();
      setSeriesList(series);
    } catch (error) {
      console.error("Failed to load series:", error);
    } finally {
      setLoadingSeriesList(false);
    }
  };

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
      setWantedCount((prev) => prev + 1);
      setMessage({ type: "success", text: `Added "${result.title}" to wanted list` });
    } catch (error) {
      setMessage({ type: "error", text: (error as Error).message });
    }
  };

  const handleRemoveFromWanted = async (id: string) => {
    try {
      await removeFromWantedList(id);
      setWantedBooksState((prev) => prev.filter((b) => b.id !== id));
      setWantedCount((prev) => prev - 1);
      setMessage({ type: "success", text: "Removed from wanted list" });
    } catch (error) {
      setMessage({ type: "error", text: "Failed to remove book" });
    }
  };

  const handleUpdateStatus = async (id: string, status: WantedBook["status"]) => {
    try {
      await updateWantedBook(id, { status });
      setWantedBooksState((prev) => prev.map((b) => (b.id === id ? { ...b, status } : b)));
    } catch (error) {
      setMessage({ type: "error", text: "Failed to update status" });
    }
  };

  const handleSelectSeries = async (seriesName: string) => {
    setSelectedSeries(seriesName);
    setLoadingSeries(true);
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
      setLoadingSeries(false);
    }
  };

  return (
    <main className="container my-8 px-6 mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <Link
            to="/"
            className="text-primary hover:text-primary-hover text-sm font-medium transition-colors"
          >
            &larr; Back to Library
          </Link>
          <h1 className="text-2xl font-bold mt-2 text-foreground">Discover</h1>
          <p className="text-foreground-muted">Find new books and complete your series</p>
        </div>
        {wantedCount > 0 && (
          <div className="text-sm text-foreground-muted">
            {wantedCount} book{wantedCount !== 1 ? "s" : ""} on wanted list
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-border">
        <TabButton active={activeTab === "search"} onClick={() => setActiveTab("search")}>
          Search Books
        </TabButton>
        <TabButton active={activeTab === "wanted"} onClick={() => setActiveTab("wanted")}>
          Wanted List {wantedCount > 0 && `(${wantedCount})`}
        </TabButton>
        <TabButton active={activeTab === "series"} onClick={() => setActiveTab("series")}>
          Series Tracker
        </TabButton>
      </div>

      {/* Message */}
      {message && (
        <div
          className={`mb-4 p-3 rounded-lg ${
            message.type === "success"
              ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
              : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Tab Content */}
      {activeTab === "search" && (
        <SearchTab
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onSearch={handleSearch}
          searching={searching}
          results={searchResults}
          wantedMap={wantedMap}
          ownedMap={ownedMap}
          onAddToWanted={handleAddToWanted}
        />
      )}

      {activeTab === "wanted" && (
        <WantedTab
          books={wantedBooks}
          loading={loadingWanted}
          onRemove={handleRemoveFromWanted}
          onUpdateStatus={handleUpdateStatus}
        />
      )}

      {activeTab === "series" && (
        <SeriesTab
          seriesList={seriesList}
          selectedSeries={selectedSeries}
          seriesDetails={seriesDetails}
          missingBooks={missingBooks}
          loading={loadingSeries}
          loadingList={loadingSeriesList}
          onSelectSeries={handleSelectSeries}
          onAddToWanted={handleAddToWanted}
          wantedMap={wantedMap}
        />
      )}
    </main>
  );
}

// Tab Button Component
function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-primary text-primary"
          : "border-transparent text-foreground-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// Search Tab Component
function SearchTab({
  searchQuery,
  setSearchQuery,
  onSearch,
  searching,
  results,
  wantedMap,
  ownedMap,
  onAddToWanted,
}: {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onSearch: () => void;
  searching: boolean;
  results: MetadataSearchResult[];
  wantedMap: Map<string, boolean>;
  ownedMap: Map<string, boolean>;
  onAddToWanted: (result: MetadataSearchResult) => void;
}) {
  return (
    <div>
      {/* Search Input */}
      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by title, author, or ISBN..."
          className="flex-1 px-4 py-3 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          onKeyDown={(e) => e.key === "Enter" && onSearch()}
        />
        <button
          onClick={onSearch}
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
      ) : results.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {results.map((result, index) => {
            const key = `${result.source}:${result.sourceId}`;
            return (
              <ExternalBookCard
                key={`${key}:${index}`}
                book={result}
                isWanted={wantedMap.get(key) || false}
                isOwned={ownedMap.get(key) || false}
                onAddToWanted={() => onAddToWanted(result)}
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

// External Book Card Component
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
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
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
              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 cursor-not-allowed"
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

// Wanted Tab Component
function WantedTab({
  books,
  loading,
  onRemove,
  onUpdateStatus,
}: {
  books: WantedBook[];
  loading: boolean;
  onRemove: (id: string) => void;
  onUpdateStatus: (id: string, status: WantedBook["status"]) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (books.length === 0) {
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
              d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
            />
          </svg>
        </div>
        <p className="text-foreground-muted mb-2">Your wanted list is empty</p>
        <p className="text-foreground-muted/60 text-sm">Search for books to add them here</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {books.map((book) => (
        <WantedBookCard
          key={book.id}
          book={book}
          onRemove={() => onRemove(book.id)}
          onUpdateStatus={(status) => onUpdateStatus(book.id, status)}
        />
      ))}
    </div>
  );
}

// Wanted Book Card Component
function WantedBookCard({
  book,
  onRemove,
  onUpdateStatus,
}: {
  book: WantedBook;
  onRemove: () => void;
  onUpdateStatus: (status: WantedBook["status"]) => void;
}) {
  const authors = book.authors ? JSON.parse(book.authors) : [];

  return (
    <div className="bg-surface border border-border rounded-xl p-4 flex gap-4">
      {/* Cover */}
      <div className="w-16 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-surface-elevated">
        {book.coverUrl ? (
          <img src={book.coverUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-foreground-muted">
            No Cover
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-foreground">{book.title}</h3>
        {authors.length > 0 && (
          <p className="text-sm text-foreground-muted">{authors.join(", ")}</p>
        )}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <select
            value={book.status}
            onChange={(e) => onUpdateStatus(e.target.value as WantedBook["status"])}
            className={`text-xs px-2 py-1 rounded border-0 cursor-pointer ${
              book.status === "wishlist"
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                : book.status === "searching"
                  ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                  : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
            }`}
          >
            <option value="wishlist">Wishlist</option>
            <option value="searching">Searching</option>
            <option value="ordered">Ordered</option>
          </select>
          {book.series && (
            <span className="text-xs text-foreground-muted">
              {book.series} {book.seriesNumber && `#${book.seriesNumber}`}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <button
        onClick={onRemove}
        className="text-foreground-muted hover:text-red-500 transition-colors self-start"
        title="Remove from wanted list"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
          />
        </svg>
      </button>
    </div>
  );
}

// Series Tab Component
function SeriesTab({
  seriesList,
  selectedSeries,
  seriesDetails,
  missingBooks,
  loading,
  loadingList,
  onSelectSeries,
  onAddToWanted,
  wantedMap,
}: {
  seriesList: SeriesWithCounts[];
  selectedSeries: string | null;
  seriesDetails: SeriesInfo | null;
  missingBooks: MetadataSearchResult[];
  loading: boolean;
  loadingList: boolean;
  onSelectSeries: (name: string) => void;
  onAddToWanted: (book: MetadataSearchResult) => void;
  wantedMap: Map<string, boolean>;
}) {
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
    <div className="grid md:grid-cols-[300px_1fr] gap-6">
      {/* Series List */}
      <div className="bg-surface border border-border rounded-xl p-4 h-fit">
        <h3 className="font-semibold text-foreground mb-4">Your Series</h3>
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {seriesList.map((series) => (
            <button
              key={series.name}
              onClick={() => onSelectSeries(series.name)}
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
                      className="w-16 h-24 rounded-lg overflow-hidden bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800"
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
                        isOwned={false}
                        onAddToWanted={() => onAddToWanted(book)}
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
  );
}
