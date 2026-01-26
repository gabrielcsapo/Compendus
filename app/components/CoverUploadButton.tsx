"use client";

import { useState, useRef } from "react";

interface CoverUploadButtonProps {
  bookId: string;
  hasCover: boolean;
}

export function CoverUploadButton({ bookId, hasCover }: CoverUploadButtonProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!validTypes.includes(file.type)) {
      setError("Please select a valid image file (JPEG, PNG, WebP, or GIF)");
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError("Image must be less than 10MB");
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("cover", file);

      const response = await fetch(`/api/books/${bookId}/cover`, {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        // Refresh the page to show the new cover
        window.location.reload();
      } else {
        setError(result.error === "processing_failed"
          ? "Failed to process image. Make sure it's a valid book cover (portrait orientation)."
          : "Failed to upload cover");
      }
    } catch {
      setError("Failed to upload cover");
    } finally {
      setIsUploading(false);
      // Reset the input so the same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="mt-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleFileChange}
        className="hidden"
      />
      <button
        onClick={handleClick}
        disabled={isUploading}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm border border-border rounded-lg hover:bg-surface-elevated text-foreground-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isUploading ? (
          <>
            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            <span>Uploading...</span>
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <span>{hasCover ? "Change Cover" : "Upload Cover"}</span>
          </>
        )}
      </button>
      {error && (
        <p className="mt-2 text-xs text-error text-center">{error}</p>
      )}
    </div>
  );
}
