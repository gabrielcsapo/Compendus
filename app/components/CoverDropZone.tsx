"use client";

import { useState, useCallback, useEffect, useRef } from "react";

interface CoverDropZoneProps {
  bookId: string;
  coverPath: string | null;
  coverColor: string | null;
  title: string;
  updatedAt?: Date | null;
  children?: React.ReactNode;
}

export function CoverDropZone({
  bookId,
  coverPath,
  coverColor,
  title,
  updatedAt,
  children,
}: CoverDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragCounterRef = useRef(0);

  const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];

  // Clean up preview URL when component unmounts or preview changes
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const uploadCover = useCallback(
    async (file: File) => {
      setIsUploading(true);
      setError(null);
      setPendingFile(null);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      }

      try {
        const formData = new FormData();
        formData.append("cover", file);

        const response = await fetch(`/api/books/${bookId}/cover`, {
          method: "POST",
          body: formData,
        });

        const result = await response.json();

        if (result.success) {
          window.location.reload();
        } else {
          setError(
            result.error === "processing_failed"
              ? "Failed to process image. Make sure it's a valid book cover (portrait orientation)."
              : "Failed to upload cover"
          );
        }
      } catch {
        setError("Failed to upload cover");
      } finally {
        setIsUploading(false);
      }
    },
    [bookId, previewUrl]
  );

  const showConfirmation = useCallback(
    (file: File) => {
      // Validate file type
      if (!validTypes.includes(file.type)) {
        setError("Please use a valid image (JPEG, PNG, WebP, or GIF)");
        return;
      }

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        setError("Image must be less than 10MB");
        return;
      }

      // Clean up previous preview if any
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      // Create preview and show modal
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      setPendingFile(file);
      setError(null);
    },
    [previewUrl]
  );

  const cancelUpload = useCallback(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPendingFile(null);
    setPreviewUrl(null);
  }, [previewUrl]);

  const confirmUpload = useCallback(() => {
    if (pendingFile) {
      uploadCover(pendingFile);
    }
  }, [pendingFile, uploadCover]);

  // Handle drag events
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounterRef.current = 0;

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        if (file.type.startsWith("image/")) {
          showConfirmation(file);
        } else {
          setError("Please drop an image file");
        }
      }
    },
    [showConfirmation]
  );

  // Handle paste events (global when component is mounted)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      // Check if the paste target is an input/textarea - if so, don't intercept
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            showConfirmation(file);
          }
          break;
        }
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [showConfirmation]);

  // Handle escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && pendingFile) {
        e.preventDefault();
        e.stopPropagation();
        cancelUpload();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pendingFile, cancelUpload]);

  return (
    <>
      <div
        ref={containerRef}
        className={`relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-surface-elevated transition-all ${
          isDragging ? "ring-4 ring-primary ring-offset-2" : ""
        } ${isUploading ? "opacity-50" : ""}`}
        style={{ backgroundColor: coverColor || undefined }}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Cover image or placeholder */}
        {coverPath ? (
          <img
            src={`/covers/${bookId}.jpg?v=${updatedAt?.getTime() || ""}`}
            alt={title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center p-8 bg-gradient-to-br from-primary-light to-accent-light">
            <span className="text-center text-foreground-muted text-lg font-medium">
              {title}
            </span>
          </div>
        )}

        {/* Drag overlay */}
        {isDragging && (
          <div className="absolute inset-0 bg-primary/80 flex flex-col items-center justify-center text-white">
            <svg
              className="w-12 h-12 mb-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <span className="font-medium">Drop to update cover</span>
          </div>
        )}

        {/* Upload spinner overlay */}
        {isUploading && (
          <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center text-white">
            <div className="w-8 h-8 border-3 border-white border-t-transparent rounded-full animate-spin mb-2" />
            <span className="text-sm">Uploading...</span>
          </div>
        )}

        {/* Hint overlay on hover (only when not uploading or dragging) */}
        {!isDragging && !isUploading && (
          <div className="absolute inset-0 bg-black/0 hover:bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-all cursor-default group">
            <div className="text-white text-center text-sm px-4">
              <p className="font-medium">Drop image or paste from clipboard</p>
            </div>
          </div>
        )}

        {children}

        {/* Error message */}
        {error && (
          <div className="absolute bottom-0 left-0 right-0 bg-error/90 text-white text-xs p-2 text-center">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-2 underline hover:no-underline"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {pendingFile && previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={cancelUpload}
        >
          <div
            className="bg-surface border border-border rounded-xl p-6 max-w-md w-full mx-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-foreground mb-4">
              Update Book Cover
            </h3>

            <p className="text-sm text-foreground-muted mb-4">
              Are you sure you want to use this image as the cover for "{title}"?
            </p>

            {/* Preview */}
            <div className="flex justify-center mb-4">
              <div className="aspect-[2/3] h-64 overflow-hidden rounded-lg border border-border">
                <img
                  src={previewUrl}
                  alt="Cover preview"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-3 justify-end">
              <button
                onClick={cancelUpload}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-foreground-muted hover:bg-surface-elevated transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmUpload}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors"
              >
                Upload Cover
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
