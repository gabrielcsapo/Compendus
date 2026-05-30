"use client";

import { useState, useEffect } from "react";
import { ReconvertEpubButton } from "./ConvertToEpubButton";
import { buttonStyles } from "../lib/styles";
import type { Book } from "../lib/db/schema";

interface BookInfoButtonProps {
  book: Book;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/**
 * "Info" action that opens a modal with the book's file/metadata details,
 * replacing the always-visible Details section.
 */
export function BookInfoButton({ book }: BookInfoButtonProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("keydown", onEsc);
      return () => document.removeEventListener("keydown", onEsc);
    }
  }, [open]);

  const importedAt =
    book.importedAt instanceof Date
      ? book.importedAt
      : book.importedAt
        ? new Date(book.importedAt)
        : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${buttonStyles.base} ${buttonStyles.ghost} gap-1.5`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        Info
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative bg-surface border border-border rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Details</h2>
            <dl className="divide-y divide-border text-sm">
              {book.pageCount && (
                <div className="flex justify-between gap-4 py-3">
                  <dt className="text-foreground-muted shrink-0">Pages</dt>
                  <dd className="font-medium text-foreground text-right">{book.pageCount}</dd>
                </div>
              )}
              {book.publisher && (
                <div className="flex justify-between gap-4 py-3">
                  <dt className="text-foreground-muted shrink-0">Publisher</dt>
                  <dd className="font-medium text-foreground text-right">{book.publisher}</dd>
                </div>
              )}
              {book.publishedDate && (
                <div className="flex justify-between gap-4 py-3">
                  <dt className="text-foreground-muted shrink-0">Published</dt>
                  <dd className="font-medium text-foreground text-right">{book.publishedDate}</dd>
                </div>
              )}
              {book.isbn && (
                <div className="flex justify-between gap-4 py-3">
                  <dt className="text-foreground-muted shrink-0">ISBN</dt>
                  <dd className="font-medium text-foreground font-mono text-right break-all">
                    {book.isbn}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-4 py-3">
                <dt className="text-foreground-muted shrink-0">File Size</dt>
                <dd className="font-medium text-foreground text-right">
                  {formatFileSize(book.fileSize)}
                </dd>
              </div>
              {importedAt && (
                <div className="flex justify-between gap-4 py-3">
                  <dt className="text-foreground-muted shrink-0">Added</dt>
                  <dd className="font-medium text-foreground text-right">
                    {importedAt.toLocaleDateString()}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-4 py-3">
                <dt className="text-foreground-muted shrink-0">Filename</dt>
                <dd className="font-medium text-foreground break-all text-right min-w-0">
                  {book.fileName}
                </dd>
              </div>
              <div className="flex justify-between gap-4 py-3">
                <dt className="text-foreground-muted shrink-0">Location</dt>
                <dd className="text-foreground break-all font-mono text-xs text-right min-w-0">
                  {book.filePath}
                </dd>
              </div>
              {book.convertedEpubPath && (
                <div className="flex justify-between items-center gap-4 py-3">
                  <dt className="text-foreground-muted shrink-0">Converted EPUB</dt>
                  <dd className="flex items-center gap-3">
                    <a
                      href={`/books/${book.id}/as-epub`}
                      download={`${book.id}.epub`}
                      className="text-sm text-primary hover:text-primary-hover transition-colors"
                    >
                      Download
                    </a>
                    <ReconvertEpubButton bookId={book.id} />
                  </dd>
                </div>
              )}
            </dl>

            <div className="flex justify-end mt-6">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={`${buttonStyles.base} ${buttonStyles.ghost}`}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
