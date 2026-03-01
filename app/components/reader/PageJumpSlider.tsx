"use client";

import { useState, useCallback } from "react";

interface PageJumpSliderProps {
  currentPage: number;
  totalPages: number;
  chapterTitle?: string;
  onJump: (page: number) => void;
  theme: {
    background: string;
    foreground: string;
    muted: string;
    accent: string;
  };
  visible: boolean;
}

/**
 * Interactive page jump slider at the bottom of the reader.
 * Shows page numbers and chapter title, allows scrubbing to a position.
 */
export function PageJumpSlider({
  currentPage,
  totalPages,
  chapterTitle,
  onJump,
  theme,
  visible,
}: PageJumpSliderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [previewPage, setPreviewPage] = useState(currentPage);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const page = parseInt(e.target.value, 10);
      setPreviewPage(page);
    },
    [],
  );

  const handleDragStart = useCallback(() => {
    setIsDragging(true);
    setPreviewPage(currentPage);
  }, [currentPage]);

  const handleDragEnd = useCallback(() => {
    onJump(previewPage);
    setIsDragging(false);
  }, [previewPage, onJump]);

  if (!visible || totalPages <= 1) return null;

  const displayPage = isDragging ? previewPage : currentPage;

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-30 px-6 pb-3 pt-2"
      style={{ backgroundColor: `${theme.background}F0` }}
    >
      {isDragging && (
        <div
          className="text-center text-sm mb-1 font-medium"
          style={{ color: theme.foreground }}
        >
          Page {previewPage} of {totalPages}
        </div>
      )}
      <input
        type="range"
        min={1}
        max={totalPages}
        value={displayPage}
        onChange={handleChange}
        onMouseDown={handleDragStart}
        onMouseUp={handleDragEnd}
        onTouchStart={handleDragStart}
        onTouchEnd={handleDragEnd}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{
          accentColor: theme.accent,
          background: `linear-gradient(to right, ${theme.accent} ${((displayPage - 1) / Math.max(1, totalPages - 1)) * 100}%, ${theme.foreground}20 0%)`,
        }}
      />
      <div
        className="flex justify-between text-xs mt-1"
        style={{ color: theme.muted }}
      >
        <span>Page {currentPage}</span>
        {chapterTitle && (
          <span className="truncate mx-4 text-center flex-1">
            {chapterTitle}
          </span>
        )}
        <span>{totalPages}</span>
      </div>
    </div>
  );
}
