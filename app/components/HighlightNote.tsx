"use client";

import { useFetcher } from "react-router";
import { useState, useRef, useEffect } from "react";

export function HighlightNote({
  highlightId,
  note,
}: {
  highlightId: string;
  note?: string;
}) {
  const fetcher = useFetcher();
  const [isEditing, setIsEditing] = useState(false);
  const [noteText, setNoteText] = useState(note || "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isEditing]);

  // Update local state when prop changes (e.g., after fetcher submission)
  useEffect(() => {
    if (!isEditing) {
      setNoteText(note || "");
    }
  }, [note, isEditing]);

  const handleSave = () => {
    const trimmed = noteText.trim();
    fetcher.submit(
      { intent: "updateNote", highlightId, note: trimmed },
      { method: "post" },
    );
    setIsEditing(false);
  };

  const handleCancel = () => {
    setNoteText(note || "");
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
        <textarea
          ref={textareaRef}
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Add a note..."
          rows={2}
          className="w-full px-2.5 py-2 text-sm rounded-md border border-border bg-surface-elevated resize-none focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSave();
            } else if (e.key === "Escape") {
              handleCancel();
            }
          }}
        />
        <div className="flex gap-2 mt-1.5">
          <button
            onClick={handleSave}
            className="text-xs px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Save
          </button>
          <button
            onClick={handleCancel}
            className="text-xs px-2.5 py-1 rounded text-foreground-muted hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (note) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsEditing(true);
        }}
        className="text-sm text-foreground-muted mt-2 text-left hover:underline cursor-pointer"
      >
        {note}
      </button>
    );
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setIsEditing(true);
      }}
      className="text-xs text-foreground-muted/60 mt-2 hover:text-foreground-muted hover:underline cursor-pointer"
    >
      Add note...
    </button>
  );
}
