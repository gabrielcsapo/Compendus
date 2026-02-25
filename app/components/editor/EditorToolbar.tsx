"use client";

import { Link } from "react-flight-router/client";
import { buttonStyles } from "../../lib/styles";

interface EditorToolbarProps {
  bookTitle: string;
  activeFile: string;
  isDirty: boolean;
  isSaving: boolean;
  returnUrl: string;
  onSave: () => void;
}

export function EditorToolbar({
  bookTitle,
  activeFile,
  isDirty,
  isSaving,
  returnUrl,
  onSave,
}: EditorToolbarProps) {
  return (
    <div className="flex items-center px-3 py-2 border-b border-border bg-surface gap-2 shrink-0">
      {/* Back button */}
      <Link
        to={returnUrl}
        className="flex items-center gap-1 text-foreground-muted hover:text-foreground transition-colors px-2 py-1 rounded-lg hover:bg-background"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="w-4 h-4"
        >
          <path
            fillRule="evenodd"
            d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z"
            clipRule="evenodd"
          />
        </svg>
        <span className="text-sm">Back</span>
      </Link>

      {/* Divider */}
      <div className="w-px h-5 bg-border" />

      {/* Book title */}
      <span className="text-sm text-foreground-muted truncate max-w-48">
        {bookTitle}
      </span>

      {/* Active file */}
      {activeFile && (
        <>
          <span className="text-foreground-muted text-xs">/</span>
          <span className="text-xs font-mono text-foreground truncate">
            {activeFile.split("/").pop()}
          </span>
        </>
      )}

      {/* Dirty indicator */}
      {isDirty && (
        <span className="w-2 h-2 rounded-full bg-warning shrink-0" title="Unsaved changes" />
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Save button */}
      <button
        onClick={onSave}
        disabled={isSaving || !isDirty}
        className={`${buttonStyles.base} ${buttonStyles.primary} text-sm px-4 py-1.5 flex items-center gap-2`}
      >
        {isSaving ? (
          <>
            <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Saving...
          </>
        ) : (
          "Save"
        )}
      </button>
    </div>
  );
}
