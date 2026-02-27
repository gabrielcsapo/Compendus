"use client";

import { useState, useRef, useEffect } from "react";
import type { TocEntry, ReaderBookmark, ReaderHighlight } from "@/lib/reader/types";

interface SearchResult {
  text: string;
  context: string;
  position: number;
  pageNum: number;
  chapterTitle?: string;
}

interface ReaderSidebarProps {
  isOpen: boolean;
  activeTab: "toc" | "bookmarks" | "highlights" | "search";
  onTabChange: (tab: "toc" | "bookmarks" | "highlights" | "search") => void;
  onClose: () => void;
  toc: TocEntry[];
  bookmarks: ReaderBookmark[];
  highlights: ReaderHighlight[];
  currentPosition: number;
  onTocSelect: (position: number) => void;
  onBookmarkSelect: (position: number) => void;
  onBookmarkDelete: (bookmarkId: string) => void;
  onHighlightSelect: (position: number) => void;
  onHighlightDelete: (highlightId: string) => void;
  onHighlightUpdateNote?: (highlightId: string, note: string | null) => void;
  // Search props
  searchQuery?: string;
  searchResults?: SearchResult[];
  searching?: boolean;
  onSearch?: (query: string) => void;
  onSearchResultSelect?: (position: number) => void;
  isTextContent?: boolean;
  theme: {
    background: string;
    foreground: string;
    muted: string;
    accent: string;
  };
}

export function ReaderSidebar({
  isOpen,
  activeTab,
  onTabChange,
  onClose,
  toc,
  bookmarks,
  highlights,
  currentPosition,
  onTocSelect,
  onBookmarkSelect,
  onBookmarkDelete,
  onHighlightSelect,
  onHighlightDelete,
  onHighlightUpdateNote,
  searchQuery,
  searchResults,
  searching,
  onSearch,
  onSearchResultSelect,
  isTextContent,
  theme,
}: ReaderSidebarProps) {
  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40 md:hidden" onClick={onClose} />

      {/* Sidebar */}
      <div
        className="fixed md:relative inset-y-0 left-0 w-72 z-50 md:z-auto flex flex-col border-r shadow-lg md:shadow-none"
        style={{
          backgroundColor: theme.background,
          borderColor: `${theme.foreground}20`,
        }}
      >
        {/* Header with tabs */}
        <div className="flex border-b" style={{ borderColor: `${theme.foreground}20` }}>
          <TabButton active={activeTab === "toc"} onClick={() => onTabChange("toc")} theme={theme}>
            Contents
          </TabButton>
          <TabButton
            active={activeTab === "bookmarks"}
            onClick={() => onTabChange("bookmarks")}
            theme={theme}
          >
            Bookmarks ({bookmarks.length})
          </TabButton>
          <TabButton
            active={activeTab === "highlights"}
            onClick={() => onTabChange("highlights")}
            theme={theme}
          >
            Highlights ({highlights.length})
          </TabButton>
          <TabButton
            active={activeTab === "search"}
            onClick={() => onTabChange("search")}
            theme={theme}
          >
            Search
          </TabButton>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {activeTab === "toc" && (
            <TocList
              entries={toc}
              currentPosition={currentPosition}
              onSelect={onTocSelect}
              theme={theme}
            />
          )}

          {activeTab === "bookmarks" && (
            <BookmarkList
              bookmarks={bookmarks}
              currentPosition={currentPosition}
              onSelect={onBookmarkSelect}
              onDelete={onBookmarkDelete}
              theme={theme}
            />
          )}

          {activeTab === "highlights" && (
            <HighlightList
              highlights={highlights}
              currentPosition={currentPosition}
              onSelect={onHighlightSelect}
              onDelete={onHighlightDelete}
              onUpdateNote={onHighlightUpdateNote}
              theme={theme}
            />
          )}

          {activeTab === "search" && (
            <SearchPanel
              query={searchQuery || ""}
              results={searchResults || []}
              searching={searching || false}
              onSearch={onSearch || (() => {})}
              onResultSelect={(position) => {
                onSearchResultSelect?.(position);
              }}
              isTextContent={isTextContent ?? true}
              theme={theme}
            />
          )}
        </div>

        {/* Close button for mobile */}
        <button
          onClick={onClose}
          className="md:hidden absolute top-2 right-2 p-2 rounded-md hover:bg-black/10"
          aria-label="Close sidebar"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
  theme,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  theme: ReaderSidebarProps["theme"];
}) {
  return (
    <button
      onClick={onClick}
      className="flex-1 px-4 py-3 text-sm font-medium transition-colors"
      style={{
        color: active ? theme.accent : theme.muted,
        borderBottom: active ? `2px solid ${theme.accent}` : "2px solid transparent",
      }}
    >
      {children}
    </button>
  );
}

function TocList({
  entries,
  currentPosition,
  onSelect,
  theme,
  level = 0,
}: {
  entries: TocEntry[];
  currentPosition: number;
  onSelect: (position: number) => void;
  theme: ReaderSidebarProps["theme"];
  level?: number;
}) {
  return (
    <ul className="py-2">
      {entries.map((entry, index) => {
        const isActive =
          entry.position <= currentPosition &&
          (entries[index + 1]?.position > currentPosition || index === entries.length - 1);

        return (
          <li key={`${entry.title}-${index}`}>
            <button
              onClick={() => onSelect(entry.position)}
              className="w-full text-left px-4 py-2 text-sm hover:bg-black/5 transition-colors"
              style={{
                paddingLeft: `${16 + level * 16}px`,
                color: isActive ? theme.accent : theme.foreground,
                fontWeight: isActive ? 500 : 400,
              }}
            >
              <span className="line-clamp-2">{entry.title}</span>
              {entry.pageNum && (
                <span className="ml-2 text-xs" style={{ color: theme.muted }}>
                  p. {entry.pageNum}
                </span>
              )}
            </button>
            {entry.children && entry.children.length > 0 && (
              <TocList
                entries={entry.children}
                currentPosition={currentPosition}
                onSelect={onSelect}
                theme={theme}
                level={level + 1}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function BookmarkList({
  bookmarks,
  currentPosition,
  onSelect,
  onDelete,
  theme,
}: {
  bookmarks: ReaderBookmark[];
  currentPosition: number;
  onSelect: (position: number) => void;
  onDelete: (id: string) => void;
  theme: ReaderSidebarProps["theme"];
}) {
  if (bookmarks.length === 0) {
    return (
      <div className="p-4 text-center text-sm" style={{ color: theme.muted }}>
        No bookmarks yet
      </div>
    );
  }

  // Sort bookmarks by position
  const sortedBookmarks = [...bookmarks].sort((a, b) => a.position - b.position);

  return (
    <ul className="py-2">
      {sortedBookmarks.map((bookmark) => {
        const isActive = Math.abs(bookmark.position - currentPosition) < 0.001;

        return (
          <li key={bookmark.id} className="group relative">
            <button
              onClick={() => onSelect(bookmark.position)}
              className="w-full text-left px-4 py-3 pr-12 hover:bg-black/5 transition-colors"
              style={{
                color: isActive ? theme.accent : theme.foreground,
              }}
            >
              <div className="text-sm font-medium line-clamp-1">
                {bookmark.title || `Position ${(bookmark.position * 100).toFixed(1)}%`}
              </div>
              {bookmark.note && (
                <div className="text-xs line-clamp-2 mt-1" style={{ color: theme.muted }}>
                  {bookmark.note}
                </div>
              )}
              <div className="text-xs mt-1" style={{ color: theme.muted }}>
                {(bookmark.position * 100).toFixed(1)}% through book
              </div>
            </button>

            {/* Delete button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(bookmark.id);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded opacity-0 group-hover:opacity-100 hover:bg-red-100 text-red-500 transition-opacity"
              aria-label="Delete bookmark"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function HighlightList({
  highlights,
  currentPosition,
  onSelect,
  onDelete,
  onUpdateNote,
  theme,
}: {
  highlights: ReaderHighlight[];
  currentPosition: number;
  onSelect: (position: number) => void;
  onDelete: (id: string) => void;
  onUpdateNote?: (highlightId: string, note: string | null) => void;
  theme: ReaderSidebarProps["theme"];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNoteText, setEditNoteText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editingId && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [editingId]);

  if (highlights.length === 0) {
    return (
      <div className="p-4 text-center text-sm" style={{ color: theme.muted }}>
        No highlights yet. Select text while reading to highlight.
      </div>
    );
  }

  const sortedHighlights = [...highlights].sort((a, b) => a.startPosition - b.startPosition);

  const handleStartEdit = (highlight: ReaderHighlight, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(highlight.id);
    setEditNoteText(highlight.note || "");
  };

  const handleSaveNote = (highlightId: string) => {
    const trimmed = editNoteText.trim();
    onUpdateNote?.(highlightId, trimmed || null);
    setEditingId(null);
    setEditNoteText("");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditNoteText("");
  };

  return (
    <ul className="py-2">
      {sortedHighlights.map((highlight) => {
        const isNearCurrent =
          highlight.startPosition <= currentPosition &&
          highlight.endPosition >= currentPosition;
        const isEditing = editingId === highlight.id;

        return (
          <li key={highlight.id} className="group relative">
            <button
              onClick={() => onSelect(highlight.startPosition)}
              className="w-full text-left px-4 py-3 pr-12 hover:bg-black/5 transition-colors"
              style={{ color: isNearCurrent ? theme.accent : theme.foreground }}
            >
              {/* Color indicator bar */}
              <div
                className="absolute left-0 top-2 bottom-2 w-1 rounded-r"
                style={{ backgroundColor: highlight.color }}
              />

              {/* Highlighted text preview */}
              <div className="text-sm line-clamp-3 pl-2 italic">
                &ldquo;{highlight.text}&rdquo;
              </div>

              {/* Note display or editor */}
              {isEditing ? (
                <div className="mt-1.5 pl-2" onClick={(e) => e.stopPropagation()}>
                  <textarea
                    ref={textareaRef}
                    value={editNoteText}
                    onChange={(e) => setEditNoteText(e.target.value)}
                    placeholder="Add a note..."
                    rows={2}
                    className="w-full px-2 py-1.5 text-xs rounded border resize-none focus:outline-none focus:ring-1"
                    style={{
                      backgroundColor: `${theme.foreground}08`,
                      borderColor: `${theme.foreground}20`,
                      color: theme.foreground,
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSaveNote(highlight.id);
                      } else if (e.key === "Escape") {
                        handleCancelEdit();
                      }
                    }}
                    onBlur={() => handleSaveNote(highlight.id)}
                  />
                </div>
              ) : highlight.note ? (
                <div
                  className="text-xs line-clamp-2 mt-1 pl-2 cursor-pointer hover:underline"
                  style={{ color: theme.muted }}
                  onClick={(e) => onUpdateNote && handleStartEdit(highlight, e)}
                >
                  {highlight.note}
                </div>
              ) : onUpdateNote ? (
                <div
                  className="text-xs mt-1 pl-2 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity hover:underline"
                  style={{ color: theme.muted }}
                  onClick={(e) => handleStartEdit(highlight, e)}
                >
                  Add note...
                </div>
              ) : null}

              {/* Position info */}
              <div className="text-xs mt-1 pl-2" style={{ color: theme.muted }}>
                {(highlight.startPosition * 100).toFixed(1)}% through book
              </div>
            </button>

            {/* Delete button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(highlight.id);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded opacity-0 group-hover:opacity-100 hover:bg-red-100 text-red-500 transition-opacity"
              aria-label="Delete highlight"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function SearchPanel({
  query,
  results,
  searching,
  onSearch,
  onResultSelect,
  isTextContent,
  theme,
}: {
  query: string;
  results: SearchResult[];
  searching: boolean;
  onSearch: (query: string) => void;
  onResultSelect: (position: number) => void;
  isTextContent: boolean;
  theme: ReaderSidebarProps["theme"];
}) {
  const [inputValue, setInputValue] = useState(query);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleInputChange = (value: string) => {
    setInputValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSearch(value), 300);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  if (!isTextContent) {
    return (
      <div className="p-4 text-center text-sm" style={{ color: theme.muted }}>
        Search is only available for text-based books (EPUB, MOBI)
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search input */}
      <div className="p-3 border-b" style={{ borderColor: `${theme.foreground}20` }}>
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4"
            fill="none"
            stroke={theme.muted}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder="Search in book..."
            className="w-full pl-8 pr-8 py-2 text-sm rounded-md border focus:outline-none focus:ring-1"
            style={{
              backgroundColor: `${theme.foreground}08`,
              borderColor: `${theme.foreground}20`,
              color: theme.foreground,
            }}
            autoFocus
          />
          {inputValue && (
            <button
              onClick={() => {
                setInputValue("");
                onSearch("");
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-black/10"
              style={{ color: theme.muted }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>
        {results.length > 0 && (
          <div className="text-xs mt-1.5" style={{ color: theme.muted }}>
            {results.length} result{results.length !== 1 ? "s" : ""} found
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto">
        {searching ? (
          <div className="p-4 text-center">
            <div className="w-5 h-5 border-2 border-current/20 border-t-current rounded-full animate-spin mx-auto" />
          </div>
        ) : results.length === 0 && inputValue.trim() ? (
          <div className="p-4 text-center text-sm" style={{ color: theme.muted }}>
            No results found
          </div>
        ) : (
          <ul className="py-1">
            {results.map((result, i) => (
              <li key={`${result.position}-${i}`}>
                <button
                  onClick={() => onResultSelect(result.position)}
                  className="w-full text-left px-4 py-2.5 hover:bg-black/5 transition-colors"
                >
                  {result.chapterTitle && (
                    <div className="text-xs font-medium mb-0.5" style={{ color: theme.accent }}>
                      {result.chapterTitle}
                    </div>
                  )}
                  <div className="text-sm leading-relaxed" style={{ color: theme.foreground }}>
                    <HighlightedContext context={result.context} match={result.text} />
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: theme.muted }}>
                    Page {result.pageNum}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function HighlightedContext({ context, match }: { context: string; match: string }) {
  const lowerContext = context.toLowerCase();
  const lowerMatch = match.toLowerCase();
  const idx = lowerContext.indexOf(lowerMatch);

  if (idx === -1) {
    return <span>{context}</span>;
  }

  const before = context.slice(0, idx);
  const matched = context.slice(idx, idx + match.length);
  const after = context.slice(idx + match.length);

  return (
    <span>
      {before}
      <strong className="font-semibold">{matched}</strong>
      {after}
    </span>
  );
}
