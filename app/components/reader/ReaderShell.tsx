"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "react-flight-router/client";
import { useReader } from "./hooks/useReader";
import { ReaderContent } from "./ReaderContent";
import { ReaderToolbar } from "./ReaderToolbar";
import { ReaderSidebar } from "./ReaderSidebar";
import { ReaderSettings } from "./ReaderSettings";
import { ReadAloudBar } from "./ReadAloudBar";
import { THEMES } from "@/lib/reader/settings";

interface ReaderShellProps {
  bookId: string;
  initialPosition?: number;
  returnUrl?: string;
  formatOverride?: string;
}

/**
 * Main reader shell that orchestrates all reader components
 */
export function ReaderShell({ bookId, initialPosition = 0, returnUrl = "/", formatOverride: formatOverrideProp }: ReaderShellProps) {
  const { navigate } = useRouter();
  const [searchParams] = useSearchParams();
  const formatOverride = formatOverrideProp || searchParams.get("format") || undefined;

  const handleClose = useCallback(() => {
    navigate(returnUrl);
  }, [navigate, returnUrl]);

  const reader = useReader({ bookId, initialPosition, formatOverride });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"toc" | "bookmarks" | "highlights" | "search">("toc");
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Immersive mode: auto-hiding overlay
  const [showOverlay, setShowOverlay] = useState(true);
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // TTS state
  const [readAloudActive, setReadAloudActive] = useState(false);
  const textContentRef = useRef<HTMLDivElement>(null);

  const theme = THEMES[reader.settings.theme];

  // Auto-hide overlay timer
  const resetOverlayTimer = useCallback(() => {
    if (overlayTimerRef.current) {
      clearTimeout(overlayTimerRef.current);
    }
    overlayTimerRef.current = setTimeout(() => {
      if (!sidebarOpen && !settingsOpen) {
        setShowOverlay(false);
      }
    }, 10000);
  }, [sidebarOpen, settingsOpen]);

  // Start timer when overlay becomes visible
  useEffect(() => {
    if (showOverlay && !sidebarOpen && !settingsOpen) {
      resetOverlayTimer();
    }
    return () => {
      if (overlayTimerRef.current) {
        clearTimeout(overlayTimerRef.current);
      }
    };
  }, [showOverlay, resetOverlayTimer, sidebarOpen, settingsOpen]);

  // Keep overlay visible while sidebar or settings are open
  useEffect(() => {
    if (sidebarOpen || settingsOpen) {
      setShowOverlay(true);
      if (overlayTimerRef.current) {
        clearTimeout(overlayTimerRef.current);
      }
    }
  }, [sidebarOpen, settingsOpen]);

  // Show overlay on mouse movement (desktop)
  useEffect(() => {
    let moveTimeout: ReturnType<typeof setTimeout>;
    const handleMouseMove = () => {
      if (!showOverlay) {
        setShowOverlay(true);
      }
      clearTimeout(moveTimeout);
      moveTimeout = setTimeout(() => {
        resetOverlayTimer();
      }, 100);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      clearTimeout(moveTimeout);
    };
  }, [showOverlay, resetOverlayTimer]);

  // Center tap toggles overlay
  const handleCenterTap = useCallback(() => {
    setShowOverlay((prev) => {
      if (!prev) {
        // Will become visible, start timer
        setTimeout(() => resetOverlayTimer(), 0);
      }
      return !prev;
    });
  }, [resetOverlayTimer]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape closes reader
      if (e.key === "Escape") {
        if (sidebarOpen) {
          setSidebarOpen(false);
        } else if (settingsOpen) {
          setSettingsOpen(false);
        } else {
          e.preventDefault();
          handleClose();
        }
        return;
      }

      // Don't handle shortcuts when typing in input
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") {
        return;
      }

      // t = toggle overlay
      if (e.key === "t" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setShowOverlay((prev) => !prev);
      }

      // Cmd/Ctrl+F = open search
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setSidebarTab("search");
        setSidebarOpen(true);
        setShowOverlay(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClose, sidebarOpen, settingsOpen]);

  // Handle TOC navigation
  const handleTocSelect = useCallback(
    (position: number) => {
      reader.goToPosition(position);
      setSidebarOpen(false);
    },
    [reader],
  );

  // Handle bookmark navigation
  const handleBookmarkSelect = useCallback(
    (position: number) => {
      reader.goToPosition(position);
      setSidebarOpen(false);
    },
    [reader],
  );

  // Handle highlight navigation
  const handleHighlightSelect = useCallback(
    (position: number) => {
      reader.goToPosition(position);
      setSidebarOpen(false);
    },
    [reader],
  );

  // Handle search result navigation
  const handleSearchResultSelect = useCallback(
    (position: number) => {
      reader.goToPosition(position);
      setSidebarOpen(false);
    },
    [reader],
  );

  // Add bookmark at current position
  const handleAddBookmark = useCallback(() => {
    if (reader.pageContent) {
      const title = reader.pageContent.chapterTitle || `Page ${reader.currentPage}`;
      reader.addBookmark(reader.pageContent.position, title);
    }
  }, [reader]);

  // Toggle sidebar
  const toggleSidebar = useCallback((tab?: "toc" | "bookmarks" | "highlights" | "search") => {
    if (tab) {
      setSidebarTab(tab);
      setSidebarOpen(true);
    } else {
      setSidebarOpen((prev) => !prev);
    }
  }, []);

  const isTextContent = reader.pageContent?.type === "text";

  // Loading state
  if (reader.loading) {
    return (
      <div
        className="h-screen flex items-center justify-center"
        style={{ backgroundColor: theme.background, color: theme.foreground }}
      >
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-current mx-auto mb-4" />
          <p>Loading book...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (reader.error) {
    // Check if error contains a URL to make it clickable
    const urlMatch = reader.error.match(/(https?:\/\/[^\s)]+)/);
    const errorParts = urlMatch ? reader.error.split(urlMatch[0]) : [reader.error];

    return (
      <div
        className="h-screen flex items-center justify-center p-4"
        style={{ backgroundColor: theme.background, color: theme.foreground }}
      >
        <div className="text-center max-w-md">
          <div className="text-red-500 mb-6">
            <svg
              className="w-16 h-16 mx-auto mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <p className="text-lg">
              {urlMatch ? (
                <>
                  {errorParts[0]}
                  <a
                    href={urlMatch[0]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:no-underline text-blue-500"
                  >
                    Calibre
                  </a>
                  {errorParts[1]}
                </>
              ) : (
                reader.error
              )}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="h-screen flex flex-col relative"
      style={{ backgroundColor: theme.background, color: theme.foreground }}
    >
      {/* Toolbar - slides up when hidden */}
      <div
        className="absolute top-0 left-0 right-0 z-30 transition-all duration-300"
        style={{
          transform: showOverlay ? "translateY(0)" : "translateY(-100%)",
          opacity: showOverlay ? 1 : 0,
        }}
      >
        <ReaderToolbar
          title={reader.bookInfo?.title || ""}
          currentPage={reader.currentPage}
          totalPages={reader.totalPages}
          onGoToPage={reader.goToPage}
          onClose={handleClose}
          onToggleSidebar={() => toggleSidebar()}
          onToggleSettings={() => setSettingsOpen((prev) => !prev)}
          onToggleSearch={() => toggleSidebar("search")}
          onToggleReadAloud={() => setReadAloudActive((prev) => !prev)}
          onAddBookmark={handleAddBookmark}
          hasBookmark={reader.bookmarks.some((b) => Math.abs(b.position - reader.position) < 0.001)}
          isTextContent={isTextContent}
          readAloudActive={readAloudActive}
          theme={theme}
        />
      </div>

      {/* Main content area - takes full height */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <ReaderSidebar
          isOpen={sidebarOpen}
          activeTab={sidebarTab}
          onTabChange={setSidebarTab}
          onClose={() => setSidebarOpen(false)}
          toc={reader.bookInfo?.toc || []}
          bookmarks={reader.bookmarks}
          highlights={reader.highlights}
          currentPosition={reader.position}
          onTocSelect={handleTocSelect}
          onBookmarkSelect={handleBookmarkSelect}
          onBookmarkDelete={reader.removeBookmark}
          onHighlightSelect={handleHighlightSelect}
          onHighlightDelete={reader.removeHighlight}
          onHighlightUpdateNote={reader.updateHighlightNote}
          searchQuery={reader.searchQuery}
          searchResults={reader.searchResults}
          searching={reader.searching}
          onSearch={reader.searchBook}
          onSearchResultSelect={handleSearchResultSelect}
          isTextContent={isTextContent}
          theme={theme}
        />

        {/* Content area with viewport measurement */}
        <div ref={reader.viewport.containerRef} className="flex-1 relative overflow-hidden">
          <ReaderContent
            content={reader.pageContent}
            rightContent={reader.rightPageContent}
            settings={reader.settings}
            isSpreadMode={reader.isSpreadMode}
            isJumpNavigation={reader.isJumpNavigation}
            onPrevPage={reader.prevPage}
            onNextPage={reader.nextPage}
            onCenterTap={handleCenterTap}
            bookId={reader.bookInfo?.id}
            hasTranscript={reader.bookInfo?.hasTranscript}
            audioChapters={reader.bookInfo?.chapters}
            audioDuration={reader.bookInfo?.duration}
            highlights={reader.highlights}
            onAddHighlight={reader.addHighlight}
            onRemoveHighlight={reader.removeHighlight}
            onUpdateHighlightColor={reader.updateHighlightColor}
            onUpdateHighlightNote={reader.updateHighlightNote}
            textContentRef={textContentRef}
          />

          {/* Read Aloud bar */}
          {readAloudActive && isTextContent && reader.pageContent?.html && (
            <ReadAloudBar
              htmlContent={reader.pageContent.html}
              contentRef={textContentRef}
              onPageComplete={() => reader.nextPage()}
              isActive={readAloudActive}
              onClose={() => setReadAloudActive(false)}
              theme={theme}
            />
          )}
        </div>

        {/* Settings panel */}
        <ReaderSettings
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          settings={reader.settings}
          onUpdateSetting={reader.updateGlobalSetting}
          theme={theme}
        />
      </div>

      {/* Footer progress bar - always visible, thinner when overlay hidden */}
      <div
        className="absolute bottom-0 left-0 right-0 z-30 transition-all duration-300"
        style={{
          height: showOverlay ? "4px" : "2px",
          backgroundColor: `${theme.foreground}10`,
        }}
      >
        <div
          className="h-full transition-all duration-300"
          style={{
            width: `${reader.position * 100}%`,
            backgroundColor: theme.accent,
          }}
        />
      </div>
    </div>
  );
}
