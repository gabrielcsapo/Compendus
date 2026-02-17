"use client";

import { useEffect, useRef, useState } from "react";

export const HIGHLIGHT_COLORS = [
  { name: "Yellow", value: "#ffff00" },
  { name: "Green", value: "#00ff00" },
  { name: "Blue", value: "#00bfff" },
  { name: "Pink", value: "#ff69b4" },
  { name: "Orange", value: "#ffa500" },
];

/**
 * Toolbar shown when user selects new text to highlight.
 * Colors | Note | Copy
 */
interface HighlightToolbarProps {
  position: { x: number; y: number; above: boolean };
  selectedText: string;
  onHighlight: (color: string, note?: string) => void;
  onDismiss: () => void;
  theme: {
    background: string;
    foreground: string;
    muted: string;
  };
}

export function HighlightToolbar({
  position,
  selectedText,
  onHighlight,
  onDismiss,
  theme,
}: HighlightToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteColor, setNoteColor] = useState("#ffff00");

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };

    const handleScroll = () => {
      onDismiss();
    };

    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleOutsideClick);
      document.addEventListener("touchstart", handleOutsideClick);
      document.addEventListener("scroll", handleScroll, true);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [onDismiss]);

  useEffect(() => {
    if (showNoteInput && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [showNoteInput]);

  const handleCopy = () => {
    navigator.clipboard.writeText(selectedText);
    onDismiss();
  };

  return (
    <div
      ref={toolbarRef}
      className="fixed z-50 flex flex-col rounded-lg shadow-lg border"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        backgroundColor: theme.background,
        borderColor: `${theme.foreground}20`,
      }}
      onMouseDown={(e) => e.preventDefault()}
      onTouchStart={(e) => e.preventDefault()}
    >
      {!showNoteInput ? (
        /* Default toolbar: Colors | Note | Copy */
        <div className="flex items-center gap-2 px-3 py-2">
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color.value}
              onClick={(e) => {
                e.stopPropagation();
                onHighlight(color.value);
              }}
              className="w-7 h-7 rounded-full border-2 border-transparent hover:border-current hover:scale-110 transition-all"
              style={{ backgroundColor: color.value }}
              aria-label={`Highlight ${color.name}`}
              title={color.name}
            />
          ))}

          <div className="w-px h-5 mx-0.5" style={{ backgroundColor: `${theme.foreground}20` }} />

          {/* Note button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowNoteInput(true);
            }}
            className="w-7 h-7 rounded-full flex items-center justify-center hover:scale-110 transition-all"
            style={{ color: theme.foreground }}
            aria-label="Add note"
            title="Add note"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </button>

          {/* Copy button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleCopy();
            }}
            className="w-7 h-7 rounded-full flex items-center justify-center hover:scale-110 transition-all"
            style={{ color: theme.foreground }}
            aria-label="Copy text"
            title="Copy text"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          </button>
        </div>
      ) : (
        /* Note input mode: Color picker + textarea + save */
        <div className="px-3 py-3 w-64">
          <div className="flex items-center gap-2 mb-2">
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color.value}
                onClick={(e) => {
                  e.stopPropagation();
                  setNoteColor(color.value);
                }}
                className="w-6 h-6 rounded-full border-2 transition-all"
                style={{
                  backgroundColor: color.value,
                  borderColor: noteColor === color.value ? theme.foreground : "transparent",
                  transform: noteColor === color.value ? "scale(1.15)" : "scale(1)",
                }}
                aria-label={color.name}
              />
            ))}
          </div>
          <textarea
            ref={textareaRef}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add a note..."
            rows={2}
            className="w-full px-2.5 py-2 text-sm rounded-md border resize-none focus:outline-none focus:ring-1"
            style={{
              backgroundColor: `${theme.foreground}08`,
              borderColor: `${theme.foreground}20`,
              color: theme.foreground,
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setShowNoteInput(false);
                setNoteText("");
              }
            }}
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                const trimmed = noteText.trim();
                onHighlight(noteColor, trimmed || undefined);
              }}
              className="flex-1 text-xs px-2.5 py-1.5 rounded font-medium text-white"
              style={{ backgroundColor: noteColor }}
            >
              Save
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowNoteInput(false);
                setNoteText("");
              }}
              className="text-xs px-2.5 py-1.5 rounded"
              style={{ color: theme.muted }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Toolbar shown when user clicks an existing highlight.
 * Colors (change) | Note | Copy | Delete
 */
interface HighlightEditToolbarProps {
  position: { x: number; y: number; above: boolean };
  highlight: { id: string; text: string; note?: string; color: string };
  onChangeColor: (highlightId: string, color: string) => void;
  onSaveNote: (highlightId: string, note: string | null) => void;
  onCopy: (text: string) => void;
  onDelete: (highlightId: string) => void;
  onDismiss: () => void;
  theme: {
    background: string;
    foreground: string;
    muted: string;
  };
}

export function HighlightEditToolbar({
  position,
  highlight,
  onChangeColor,
  onSaveNote,
  onCopy,
  onDelete,
  onDismiss,
  theme,
}: HighlightEditToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteText, setNoteText] = useState(highlight.note || "");

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleOutsideClick);
      document.addEventListener("touchstart", handleOutsideClick);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
    };
  }, [onDismiss]);

  useEffect(() => {
    if (showNoteInput && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [showNoteInput]);

  return (
    <div
      ref={toolbarRef}
      className="fixed z-50 flex flex-col rounded-lg shadow-lg border"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        backgroundColor: theme.background,
        borderColor: `${theme.foreground}20`,
      }}
      onMouseDown={(e) => e.preventDefault()}
      onTouchStart={(e) => e.preventDefault()}
    >
      {/* Main toolbar row */}
      <div className="flex items-center gap-2 px-3 py-2">
        {/* Color circles - current color has a ring */}
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color.value}
            onClick={(e) => {
              e.stopPropagation();
              onChangeColor(highlight.id, color.value);
            }}
            className="w-7 h-7 rounded-full border-2 hover:scale-110 transition-all"
            style={{
              backgroundColor: color.value,
              borderColor: highlight.color === color.value ? theme.foreground : "transparent",
            }}
            aria-label={`Change to ${color.name}`}
            title={color.name}
          />
        ))}

        <div className="w-px h-5 mx-0.5" style={{ backgroundColor: `${theme.foreground}20` }} />

        {/* Note button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowNoteInput(!showNoteInput);
          }}
          className="w-7 h-7 rounded-full flex items-center justify-center hover:scale-110 transition-all"
          style={{ color: highlight.note ? theme.foreground : theme.muted }}
          aria-label={highlight.note ? "Edit note" : "Add note"}
          title={highlight.note ? "Edit note" : "Add note"}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            />
          </svg>
        </button>

        {/* Copy button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCopy(highlight.text);
            onDismiss();
          }}
          className="w-7 h-7 rounded-full flex items-center justify-center hover:scale-110 transition-all"
          style={{ color: theme.foreground }}
          aria-label="Copy text"
          title="Copy text"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        </button>

        {/* Delete button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(highlight.id);
            onDismiss();
          }}
          className="w-7 h-7 rounded-full flex items-center justify-center hover:scale-110 transition-all text-red-400 hover:text-red-500"
          aria-label="Delete highlight"
          title="Delete highlight"
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
      </div>

      {/* Inline note editor */}
      {showNoteInput && (
        <div className="px-3 pb-3 w-64">
          <textarea
            ref={textareaRef}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add a note..."
            rows={2}
            className="w-full px-2.5 py-2 text-sm rounded-md border resize-none focus:outline-none focus:ring-1"
            style={{
              backgroundColor: `${theme.foreground}08`,
              borderColor: `${theme.foreground}20`,
              color: theme.foreground,
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setShowNoteInput(false);
                setNoteText(highlight.note || "");
              }
            }}
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                const trimmed = noteText.trim();
                onSaveNote(highlight.id, trimmed || null);
                setShowNoteInput(false);
              }}
              className="flex-1 text-xs px-2.5 py-1.5 rounded font-medium text-white"
              style={{ backgroundColor: highlight.color }}
            >
              Save
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowNoteInput(false);
                setNoteText(highlight.note || "");
              }}
              className="text-xs px-2.5 py-1.5 rounded"
              style={{ color: theme.muted }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
