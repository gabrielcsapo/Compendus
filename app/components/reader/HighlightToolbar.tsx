"use client";

import { useEffect, useRef, useState } from "react";

export const HIGHLIGHT_COLORS = [
  { name: "Yellow", value: "#ffff00" },
  { name: "Green", value: "#00ff00" },
  { name: "Blue", value: "#00bfff" },
  { name: "Pink", value: "#ff69b4" },
  { name: "Orange", value: "#ffa500" },
];

interface DictionaryMeaning {
  partOfSpeech: string;
  definitions: Array<{ definition: string; example?: string }>;
}

interface DictionaryEntry {
  word: string;
  phonetic?: string;
  phonetics?: Array<{ text?: string }>;
  meanings: DictionaryMeaning[];
}

function firstWord(text: string): string {
  const match = text.trim().match(/[\p{L}\p{N}'-]+/u);
  return match ? match[0].toLowerCase() : "";
}

async function fetchDefinition(word: string): Promise<DictionaryEntry | null> {
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as DictionaryEntry[];
  return data?.[0] ?? null;
}

/**
 * Toolbar shown when user selects new text to highlight.
 * Colors | Note | Define | Search | Share | Copy
 */
interface HighlightToolbarProps {
  position: { x: number; y: number; above: boolean };
  selectedText: string;
  onHighlight: (color: string, note?: string) => void;
  onDismiss: () => void;
  onSearchInBook?: (text: string) => void;
  theme: {
    background: string;
    foreground: string;
    muted: string;
  };
  customColors?: string[];
}

function DefinePopover({
  word,
  theme,
  onClose,
}: {
  word: string;
  theme: { background: string; foreground: string; muted: string };
  onClose: () => void;
}) {
  const [entry, setEntry] = useState<DictionaryEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchDefinition(word)
      .then((result) => {
        if (cancelled) return;
        if (!result) setError("No definition found");
        else setEntry(result);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Couldn't reach dictionary");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [word]);

  const phonetic = entry?.phonetic || entry?.phonetics?.find((p) => p.text)?.text;

  return (
    <div className="px-3 py-3 w-72 max-h-72 overflow-y-auto">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-semibold truncate" style={{ color: theme.foreground }}>
            {entry?.word || word}
          </span>
          {phonetic && (
            <span className="text-xs" style={{ color: theme.muted }}>
              {phonetic}
            </span>
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="text-xs"
          style={{ color: theme.muted }}
          aria-label="Close definition"
        >
          ✕
        </button>
      </div>
      {loading && (
        <div className="text-xs animate-pulse" style={{ color: theme.muted }}>
          Looking up…
        </div>
      )}
      {error && (
        <div className="text-xs" style={{ color: theme.muted }}>
          {error}
        </div>
      )}
      {entry &&
        entry.meanings.slice(0, 3).map((meaning, idx) => (
          <div key={idx} className="mb-2 last:mb-0">
            <div className="text-xs italic mb-0.5" style={{ color: theme.muted }}>
              {meaning.partOfSpeech}
            </div>
            <ol
              className="text-sm list-decimal list-inside space-y-0.5"
              style={{ color: theme.foreground }}
            >
              {meaning.definitions.slice(0, 2).map((def, dIdx) => (
                <li key={dIdx}>{def.definition}</li>
              ))}
            </ol>
          </div>
        ))}
    </div>
  );
}

function ActionIconButton({
  onClick,
  ariaLabel,
  title,
  color,
  children,
}: {
  onClick: (e: React.MouseEvent) => void;
  ariaLabel: string;
  title: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="w-7 h-7 rounded-full flex items-center justify-center hover:scale-110 transition-all"
      style={{ color }}
      aria-label={ariaLabel}
      title={title}
    >
      {children}
    </button>
  );
}

const NoteIconPath = (
  <path
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
  />
);

const CopyIconPath = (
  <path
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
  />
);

const DefineIconPath = (
  <path
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
  />
);

const SearchIconPath = (
  <path
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
  />
);

const ShareIconPath = (
  <path
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
  />
);

function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

async function shareText(text: string) {
  if (typeof navigator !== "undefined" && "share" in navigator) {
    try {
      await navigator.share({ text });
      return true;
    } catch {
      // user cancelled or share failed — fall through to copy
    }
  }
  copyText(text);
  return false;
}

export function HighlightToolbar({
  position,
  selectedText,
  onHighlight,
  onDismiss,
  onSearchInBook,
  theme,
  customColors,
}: HighlightToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<"default" | "note" | "define">("default");
  const [noteText, setNoteText] = useState("");
  const [noteColor, setNoteColor] = useState("#ffff00");

  const defineWord = firstWord(selectedText);
  const canDefine = defineWord.length > 0 && selectedText.trim().split(/\s+/).length <= 4;

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };

    const handleScroll = () => {
      // Don't dismiss while user is reading the definition popover.
      if (mode === "define") return;
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
  }, [onDismiss, mode]);

  useEffect(() => {
    if (mode === "note" && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [mode]);

  const handleCopy = () => {
    copyText(selectedText);
    onDismiss();
  };

  const handleSearch = () => {
    if (onSearchInBook) onSearchInBook(selectedText);
    onDismiss();
  };

  const handleShare = async () => {
    await shareText(selectedText);
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
      {mode === "default" ? (
        /* Default toolbar: Colors | Note | Define | Search | Share | Copy */
        <div className="flex items-center gap-2 px-3 py-2">
          {(customColors ? customColors.map((c) => ({ name: c, value: c })) : HIGHLIGHT_COLORS).map(
            (color) => (
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
            ),
          )}

          <div className="w-px h-5 mx-0.5" style={{ backgroundColor: `${theme.foreground}20` }} />

          <ActionIconButton
            onClick={(e) => {
              e.stopPropagation();
              setMode("note");
            }}
            ariaLabel="Add note"
            title="Add note"
            color={theme.foreground}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {NoteIconPath}
            </svg>
          </ActionIconButton>

          {canDefine && (
            <ActionIconButton
              onClick={(e) => {
                e.stopPropagation();
                setMode("define");
              }}
              ariaLabel={`Define ${defineWord}`}
              title={`Define "${defineWord}"`}
              color={theme.foreground}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {DefineIconPath}
              </svg>
            </ActionIconButton>
          )}

          {onSearchInBook && (
            <ActionIconButton
              onClick={(e) => {
                e.stopPropagation();
                handleSearch();
              }}
              ariaLabel="Search in book"
              title="Search in book"
              color={theme.foreground}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {SearchIconPath}
              </svg>
            </ActionIconButton>
          )}

          <ActionIconButton
            onClick={(e) => {
              e.stopPropagation();
              void handleShare();
            }}
            ariaLabel="Share"
            title="Share"
            color={theme.foreground}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {ShareIconPath}
            </svg>
          </ActionIconButton>

          <ActionIconButton
            onClick={(e) => {
              e.stopPropagation();
              handleCopy();
            }}
            ariaLabel="Copy text"
            title="Copy text"
            color={theme.foreground}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {CopyIconPath}
            </svg>
          </ActionIconButton>
        </div>
      ) : mode === "define" ? (
        <DefinePopover word={defineWord} theme={theme} onClose={() => setMode("default")} />
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
                setMode("default");
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
                setMode("default");
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
 * Colors (change) | Note | Define | Search | Share | Copy | Delete
 */
interface HighlightEditToolbarProps {
  position: { x: number; y: number; above: boolean };
  highlight: { id: string; text: string; note?: string; color: string };
  onChangeColor: (highlightId: string, color: string) => void;
  onSaveNote: (highlightId: string, note: string | null) => void;
  onCopy: (text: string) => void;
  onDelete: (highlightId: string) => void;
  onDismiss: () => void;
  onSearchInBook?: (text: string) => void;
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
  onSearchInBook,
  theme,
}: HighlightEditToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<"default" | "note" | "define">("default");
  const [noteText, setNoteText] = useState(highlight.note || "");

  const defineWord = firstWord(highlight.text);
  const canDefine = defineWord.length > 0 && highlight.text.trim().split(/\s+/).length <= 4;

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
    if (mode === "note" && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [mode]);

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
      {mode === "define" ? (
        <DefinePopover word={defineWord} theme={theme} onClose={() => setMode("default")} />
      ) : (
        <>
          {/* Main toolbar row */}
          <div className="flex items-center gap-2 px-3 py-2">
            {/* Color circles - current color has a ring */}
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color.value}
                onClick={(e) => {
                  e.stopPropagation();
                  if (highlight.color === color.value) {
                    onDelete(highlight.id);
                  } else {
                    onChangeColor(highlight.id, color.value);
                  }
                }}
                className="w-7 h-7 rounded-full border-2 hover:scale-110 transition-all"
                style={{
                  backgroundColor: color.value,
                  borderColor: highlight.color === color.value ? theme.foreground : "transparent",
                }}
                aria-label={
                  highlight.color === color.value ? `Remove highlight` : `Change to ${color.name}`
                }
                title={highlight.color === color.value ? "Remove highlight" : color.name}
              />
            ))}

            <div className="w-px h-5 mx-0.5" style={{ backgroundColor: `${theme.foreground}20` }} />

            <ActionIconButton
              onClick={(e) => {
                e.stopPropagation();
                setMode(mode === "note" ? "default" : "note");
              }}
              ariaLabel={highlight.note ? "Edit note" : "Add note"}
              title={highlight.note ? "Edit note" : "Add note"}
              color={highlight.note ? theme.foreground : theme.muted}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {NoteIconPath}
              </svg>
            </ActionIconButton>

            {canDefine && (
              <ActionIconButton
                onClick={(e) => {
                  e.stopPropagation();
                  setMode("define");
                }}
                ariaLabel={`Define ${defineWord}`}
                title={`Define "${defineWord}"`}
                color={theme.foreground}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {DefineIconPath}
                </svg>
              </ActionIconButton>
            )}

            {onSearchInBook && (
              <ActionIconButton
                onClick={(e) => {
                  e.stopPropagation();
                  onSearchInBook(highlight.text);
                  onDismiss();
                }}
                ariaLabel="Search in book"
                title="Search in book"
                color={theme.foreground}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {SearchIconPath}
                </svg>
              </ActionIconButton>
            )}

            <ActionIconButton
              onClick={(e) => {
                e.stopPropagation();
                void shareText(highlight.text).then(() => onDismiss());
              }}
              ariaLabel="Share"
              title="Share"
              color={theme.foreground}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {ShareIconPath}
              </svg>
            </ActionIconButton>

            <ActionIconButton
              onClick={(e) => {
                e.stopPropagation();
                onCopy(highlight.text);
                onDismiss();
              }}
              ariaLabel="Copy text"
              title="Copy text"
              color={theme.foreground}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {CopyIconPath}
              </svg>
            </ActionIconButton>

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
          {mode === "note" && (
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
                    setMode("default");
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
                    setMode("default");
                  }}
                  className="flex-1 text-xs px-2.5 py-1.5 rounded font-medium text-white"
                  style={{ backgroundColor: highlight.color }}
                >
                  Save
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMode("default");
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
        </>
      )}
    </div>
  );
}
