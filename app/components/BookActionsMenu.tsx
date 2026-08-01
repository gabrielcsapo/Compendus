"use client";

import { useState, useRef, useEffect } from "react";
import { Link, useRouter } from "react-flight-router/client";
import { RematchModal } from "./RematchModal";
import { EditBookModal } from "./EditBookModal";
import { AnalyzeButton } from "./AnalyzeButton";
import { useToast } from "./ToastContext";
import { buttonStyles } from "../lib/styles";
import { setBookAside, type BookWithState } from "../actions/books";
import type { Tag } from "../lib/db/schema";
import type { BookFormat } from "../lib/types";

interface BookActionsMenuProps {
  book: BookWithState;
  tags: Tag[];
  authors: string[];
  coverUrl?: string;
  isAdmin?: boolean;
}

/**
 * Overflow ("hamburger") menu consolidating the book's management actions —
 * re-match metadata, edit details, and edit EPUB content — into a single
 * labeled dropdown so the header no longer carries a row of loose icon buttons.
 */
export function BookActionsMenu({
  book,
  tags,
  authors,
  coverUrl,
  isAdmin = false,
}: BookActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [rematchOpen, setRematchOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [isReturningToToday, setIsReturningToToday] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { showToast } = useToast();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
      document.addEventListener("keydown", handleEsc);
      return () => {
        document.removeEventListener("mousedown", handleClick);
        document.removeEventListener("keydown", handleEsc);
      };
    }
  }, [open]);

  const canEditEpub = book.format === "epub" || !!book.convertedEpubPath;
  const itemClass =
    "flex w-full items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-foreground hover:bg-surface-elevated transition-colors text-left";

  const handleReturnToToday = async () => {
    setIsReturningToToday(true);
    try {
      const result = await setBookAside(book.id, false);
      if (!result) throw new Error("Return to Today is unavailable without an active profile");
      setOpen(false);
      showToast(`Returned “${book.title}” to Today.`, "success");
      await router.refresh();
    } catch {
      showToast(`Couldn't return “${book.title}” to Today. Try again.`, "error");
    } finally {
      setIsReturningToToday(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      {/* Trigger with hover tooltip */}
      <div className="group relative">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="More actions"
          className={`${buttonStyles.base} ${buttonStyles.ghost} px-2.5`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>
        <span className="pointer-events-none absolute top-full right-0 mt-1.5 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background opacity-0 group-hover:opacity-100 transition-opacity z-50">
          More actions
        </span>
      </div>

      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 mt-1 z-50 min-w-[208px] bg-surface border border-border rounded-xl shadow-lg p-2"
        >
          {book.isSetAside && (
            <>
              <button
                role="menuitem"
                type="button"
                className={itemClass}
                onClick={handleReturnToToday}
                disabled={isReturningToToday}
              >
                {isReturningToToday ? (
                  <span
                    className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary"
                    aria-hidden="true"
                  />
                ) : (
                  <svg
                    className="w-4 h-4 text-primary"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 3v2m6.364.636l-1.414 1.414M21 12h-2M5.05 7.05L3.636 5.636M5 12H3m5 4a4 4 0 118 0v1H8v-1zm-1 5h10"
                    />
                  </svg>
                )}
                {isReturningToToday ? "Returning…" : "Return to Today"}
              </button>
              <div className="my-1 border-t border-border" />
            </>
          )}

          <button
            role="menuitem"
            type="button"
            className={itemClass}
            onClick={() => {
              setOpen(false);
              setRematchOpen(true);
            }}
          >
            <svg
              className="w-4 h-4 text-foreground-muted"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Re-match metadata
          </button>

          <button
            role="menuitem"
            type="button"
            className={itemClass}
            onClick={() => {
              setOpen(false);
              setEditOpen(true);
            }}
          >
            <svg
              className="w-4 h-4 text-foreground-muted"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
            Edit details
          </button>

          {canEditEpub && (
            <Link
              role="menuitem"
              to={`/book/${book.id}/edit`}
              className={itemClass}
              onClick={() => setOpen(false)}
            >
              <svg
                className="w-4 h-4 text-foreground-muted"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                />
              </svg>
              Edit EPUB content
            </Link>
          )}

          {isAdmin && book.format === "epub" && (
            <>
              <div className="my-1 border-t border-border" />
              <AnalyzeButton bookId={book.id} variant="menuItem" />
            </>
          )}
        </div>
      )}

      <RematchModal
        isOpen={rematchOpen}
        onClose={() => setRematchOpen(false)}
        bookId={book.id}
        bookTitle={book.title}
        bookAuthors={authors}
        bookFormat={book.format as BookFormat}
        hasCover={!!book.coverPath}
        coverUrl={coverUrl}
      />
      <EditBookModal
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        book={book}
        currentTags={tags}
        bookFormat={book.format}
        hasCover={!!book.coverPath}
        hasConvertedEpub={!!book.convertedEpubPath}
      />
    </div>
  );
}
