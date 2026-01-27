"use client";

import { useState, useEffect, useCallback } from "react";

interface ComicReaderProps {
  bookId: string;
  format: "cbr" | "cbz";
  position?: string;
  onPositionChange?: (position: string, progress: number) => void;
}

export function ComicReader({ bookId, format, position, onPositionChange }: ComicReaderProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [fitMode, setFitMode] = useState<"width" | "height" | "page">("page");

  // Load comic info on mount
  useEffect(() => {
    async function loadComicInfo() {
      try {
        const response = await fetch(`/comic/${bookId}/${format}/info`);
        if (!response.ok) throw new Error("Failed to load comic info");

        const data = await response.json();
        setTotalPages(data.pageCount);

        // Restore position if available
        if (position) {
          const savedPage = parseInt(position, 10);
          if (!isNaN(savedPage) && savedPage >= 0 && savedPage < data.pageCount) {
            setCurrentPage(savedPage);
          }
        }

        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load comic");
        setLoading(false);
      }
    }

    loadComicInfo();
  }, [bookId, format, position]);

  // Update image URL when page changes
  useEffect(() => {
    if (totalPages > 0) {
      setPageLoading(true);
      setImageUrl(`/comic/${bookId}/${format}/page/${currentPage}`);

      // Report position change
      if (onPositionChange) {
        const progress = totalPages > 1 ? currentPage / (totalPages - 1) : 1;
        onPositionChange(currentPage.toString(), progress);
      }
    }
  }, [currentPage, totalPages, bookId, format, onPositionChange]);

  const goToPage = useCallback(
    (page: number) => {
      if (page >= 0 && page < totalPages) {
        setCurrentPage(page);
      }
    },
    [totalPages],
  );

  const nextPage = useCallback(() => {
    goToPage(currentPage + 1);
  }, [currentPage, goToPage]);

  const prevPage = useCallback(() => {
    goToPage(currentPage - 1);
  }, [currentPage, goToPage]);

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        nextPage();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        prevPage();
      } else if (e.key === "Home") {
        e.preventDefault();
        goToPage(0);
      } else if (e.key === "End") {
        e.preventDefault();
        goToPage(totalPages - 1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nextPage, prevPage, goToPage, totalPages]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-surface">
        <div className="text-foreground">Loading comic...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-surface">
        <div className="text-danger">{error}</div>
      </div>
    );
  }

  const fitClass = {
    width: "max-w-full h-auto",
    height: "h-full w-auto",
    page: "max-w-full max-h-full object-contain",
  }[fitMode];

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-surface-elevated border-b border-border text-foreground">
        <div className="flex items-center gap-2">
          <button
            onClick={prevPage}
            disabled={currentPage === 0}
            className="px-3 py-1 bg-surface border border-border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-elevated"
          >
            Prev
          </button>
          <span className="mx-2">
            Page {currentPage + 1} of {totalPages}
          </span>
          <button
            onClick={nextPage}
            disabled={currentPage === totalPages - 1}
            className="px-3 py-1 bg-surface border border-border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-elevated"
          >
            Next
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-foreground-muted">Fit:</span>
          <select
            value={fitMode}
            onChange={(e) => setFitMode(e.target.value as "width" | "height" | "page")}
            className="select py-1 text-sm w-auto"
          >
            <option value="page">Fit Page</option>
            <option value="width">Fit Width</option>
            <option value="height">Fit Height</option>
          </select>

          <input
            type="range"
            min={0}
            max={totalPages - 1}
            value={currentPage}
            onChange={(e) => goToPage(parseInt(e.target.value, 10))}
            className="w-32 ml-4"
          />
        </div>
      </div>

      {/* Page display */}
      <div
        className="flex-1 flex items-center justify-center overflow-auto p-4 relative"
        onClick={(e) => {
          // Click on left half goes back, right half goes forward
          const rect = e.currentTarget.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          if (clickX < rect.width / 2) {
            prevPage();
          } else {
            nextPage();
          }
        }}
      >
        {/* Loading overlay */}
        {pageLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/50 z-10">
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-foreground text-sm">Loading page...</span>
            </div>
          </div>
        )}
        {imageUrl && (
          <img
            src={imageUrl}
            alt={`Page ${currentPage + 1}`}
            className={`${fitClass} cursor-pointer select-none ${pageLoading ? "opacity-50" : ""}`}
            draggable={false}
            onLoad={() => setPageLoading(false)}
            onError={() => setPageLoading(false)}
          />
        )}
      </div>

      {/* Page indicator */}
      <div className="bg-surface-elevated border-t border-border text-foreground-muted text-center py-1 text-sm">
        Use arrow keys, click left/right, or slider to navigate
      </div>
    </div>
  );
}
