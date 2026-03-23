"use client";

import { useState } from "react";
import { useRouter } from "react-flight-router/client";
import { extractCoverFromBook } from "../actions/books";

interface CoverExtractButtonProps {
  bookId: string;
  bookFormat: string;
  onSuccess?: () => void;
  variant?: "button" | "inline";
}

/**
 * Button to extract cover image from the book file itself (EPUB, PDF, etc.)
 */
export function CoverExtractButton({
  bookId,
  bookFormat,
  onSuccess,
  variant = "button",
}: CoverExtractButtonProps) {
  const router = useRouter();
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only show for formats that can have embedded covers
  const supportedFormats = ["epub", "mobi", "pdf", "cbz", "cbr", "m4b", "m4a", "mp3"];
  if (!supportedFormats.includes(bookFormat.toLowerCase())) {
    return null;
  }

  const handleExtract = async () => {
    setIsExtracting(true);
    setError(null);

    try {
      const result = await extractCoverFromBook(bookId);

      if (result.success) {
        if (onSuccess) {
          onSuccess();
        } else {
          // Default behavior: refresh the page
          router.refresh();
        }
      } else {
        setError(result.message);
      }
    } catch {
      setError("Failed to extract cover");
    } finally {
      setIsExtracting(false);
    }
  };

  if (variant === "inline") {
    return (
      <button
        onClick={handleExtract}
        disabled={isExtracting}
        className="text-xs text-primary hover:text-primary-hover underline disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isExtracting ? "Extracting..." : "Extract from file"}
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={handleExtract}
        disabled={isExtracting}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm border border-border rounded-lg hover:bg-surface-elevated text-foreground-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isExtracting ? (
          <>
            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            <span>Extracting...</span>
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <span>Extract Cover from File</span>
          </>
        )}
      </button>
      {error && <p className="mt-2 text-xs text-error text-center">{error}</p>}
    </div>
  );
}

interface ClickableCoverPlaceholderProps {
  bookId: string;
  bookFormat: string;
  title: string;
  coverColor?: string | null;
  onSuccess?: () => void;
  className?: string;
}

/**
 * A cover placeholder that is clickable to extract cover from the book file
 */
export function ClickableCoverPlaceholder({
  bookId,
  bookFormat,
  title,
  coverColor,
  onSuccess,
  className = "",
}: ClickableCoverPlaceholderProps) {
  const router = useRouter();
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supportedFormats = ["epub", "mobi", "pdf", "cbz", "cbr", "m4b", "m4a", "mp3"];
  const canExtract = supportedFormats.includes(bookFormat.toLowerCase());

  const handleExtract = async () => {
    if (!canExtract || isExtracting) return;

    setIsExtracting(true);
    setError(null);

    try {
      const result = await extractCoverFromBook(bookId);

      if (result.success) {
        if (onSuccess) {
          onSuccess();
        } else {
          router.refresh();
        }
      } else {
        setError(result.message);
      }
    } catch {
      setError("Failed to extract cover");
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <div className={`relative ${className}`} style={{ backgroundColor: coverColor || undefined }}>
      <div
        onClick={handleExtract}
        className={`w-full h-full flex flex-col items-center justify-center p-4 bg-gradient-to-br from-primary-light to-accent-light ${
          canExtract
            ? "cursor-pointer hover:from-primary-light/80 hover:to-accent-light/80 transition-colors"
            : ""
        }`}
      >
        {isExtracting ? (
          <>
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mb-2" />
            <span className="text-xs text-foreground-muted">Extracting cover...</span>
          </>
        ) : (
          <>
            <span className="text-center text-foreground-muted text-sm font-medium line-clamp-3">
              {title}
            </span>
            {canExtract && (
              <span className="mt-2 text-xs text-primary flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  />
                </svg>
                Click to extract cover
              </span>
            )}
          </>
        )}
      </div>
      {error && (
        <div className="absolute bottom-0 left-0 right-0 bg-error/90 text-white text-xs p-2 text-center">
          {error}
        </div>
      )}
    </div>
  );
}
