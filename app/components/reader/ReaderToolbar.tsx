"use client";

import { useState } from "react";

interface ReaderToolbarProps {
  title: string;
  currentPage: number;
  totalPages: number;
  onGoToPage: (page: number) => void;
  onClose?: () => void;
  onToggleSidebar: () => void;
  onToggleSettings: () => void;
  onToggleSearch?: () => void;
  onToggleReadAloud?: () => void;
  onAddBookmark: () => void;
  hasBookmark: boolean;
  isTextContent?: boolean;
  readAloudActive?: boolean;
  theme: {
    background: string;
    foreground: string;
    muted: string;
    accent: string;
  };
}

export function ReaderToolbar({
  title,
  currentPage,
  totalPages,
  onGoToPage,
  onClose,
  onToggleSidebar,
  onToggleSettings,
  onToggleSearch,
  onToggleReadAloud,
  onAddBookmark,
  hasBookmark,
  isTextContent,
  readAloudActive,
  theme,
}: ReaderToolbarProps) {
  const [pageInput, setPageInput] = useState("");
  const [showPageInput, setShowPageInput] = useState(false);

  const handlePageSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const page = parseInt(pageInput, 10);
    if (!isNaN(page) && page >= 1 && page <= totalPages) {
      onGoToPage(page);
    }
    setPageInput("");
    setShowPageInput(false);
  };

  return (
    <div
      className="flex items-center justify-between px-4 py-2 border-b"
      style={{
        backgroundColor: theme.background,
        borderColor: `${theme.foreground}20`,
      }}
    >
      {/* Left section */}
      <div className="flex items-center gap-2">
        {onClose && (
          <button
            onClick={onClose}
            className="p-2 rounded-md hover:bg-black/10 transition-colors"
            aria-label="Close reader"
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
        )}

        <button
          onClick={onToggleSidebar}
          className="p-2 rounded-md hover:bg-black/10 transition-colors"
          aria-label="Toggle sidebar"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>
      </div>

      {/* Center section - title and page info */}
      <div className="flex-1 text-center">
        <h1 className="text-sm font-medium truncate max-w-md mx-auto">{title}</h1>
        <div
          className="flex items-center justify-center gap-2 text-xs"
          style={{ color: theme.muted }}
        >
          {showPageInput ? (
            <form onSubmit={handlePageSubmit} className="flex items-center gap-1">
              <input
                type="number"
                min={1}
                max={totalPages}
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                placeholder={currentPage.toString()}
                className="w-16 px-2 py-0.5 text-center border rounded"
                style={{ borderColor: `${theme.foreground}30` }}
                autoFocus
                onBlur={() => setShowPageInput(false)}
              />
              <span>/ {totalPages}</span>
            </form>
          ) : (
            <button onClick={() => setShowPageInput(true)} className="hover:underline">
              Page {currentPage} of {totalPages}
            </button>
          )}
        </div>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-1">
        {/* Search */}
        {onToggleSearch && (
          <button
            onClick={onToggleSearch}
            className="p-2 rounded-md hover:bg-black/10 transition-colors"
            aria-label="Search"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </button>
        )}

        {/* Read Aloud (text content only) */}
        {isTextContent && onToggleReadAloud && (
          <button
            onClick={onToggleReadAloud}
            className="p-2 rounded-md hover:bg-black/10 transition-colors"
            style={{
              color: readAloudActive ? theme.accent : undefined,
            }}
            aria-label={readAloudActive ? "Stop reading aloud" : "Read aloud"}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
              />
            </svg>
          </button>
        )}

        {/* Bookmark */}
        <button
          onClick={onAddBookmark}
          className="p-2 rounded-md hover:bg-black/10 transition-colors"
          aria-label={hasBookmark ? "Remove bookmark" : "Add bookmark"}
        >
          <svg
            className="w-5 h-5"
            fill={hasBookmark ? "currentColor" : "none"}
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
            />
          </svg>
        </button>

        {/* Settings */}
        <button
          onClick={onToggleSettings}
          className="p-2 rounded-md hover:bg-black/10 transition-colors"
          aria-label="Settings"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
