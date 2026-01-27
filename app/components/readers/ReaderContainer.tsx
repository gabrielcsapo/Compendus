"use client";

import { useCallback, useRef, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { PdfReader } from "./PdfReader";
import { EpubReader } from "./EpubReader";
import { MobiReader } from "./MobiReader";
import { ComicReader } from "./ComicReader";
import { AudiobookReader } from "./AudiobookReader";
import type { AudioChapter } from "../../lib/types";
import { updateBook } from "../../actions/books";
import type { Book } from "../../lib/db/schema";

interface ReaderContainerProps {
  book: Book;
}

export function ReaderContainer({ book }: ReaderContainerProps) {
  const [isMounted, setIsMounted] = useState(false);
  const navigate = useNavigate();
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handlePositionChange = useCallback(
    (position: string, progress: number) => {
      // Debounce saving
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(() => {
        updateBook(book.id, {
          lastPosition: position,
          readingProgress: progress,
        });
      }, 1000);
    },
    [book.id],
  );

  // Set mounted state
  useEffect(() => {
    setIsMounted(true);
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const handleClose = useCallback(() => {
    navigate(`/book/${book.id}`);
  }, [navigate, book.id]);

  // Get the book file URL
  const bookUrl = `/books/${book.id}.${book.format}`;

  // Show loading state during SSR and initial mount to avoid hydration mismatch
  if (!isMounted) {
    return (
      <div className="reader-container h-screen w-screen flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 bg-white border-b">
          <div className="flex items-center gap-4">
            <div className="p-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <h1 className="font-medium truncate max-w-md">{book.title}</h1>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="reader-container h-screen w-screen flex flex-col">
      {/* Reader header */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b">
        <div className="flex items-center gap-4">
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 rounded"
            title="Close reader"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
          <h1 className="font-medium truncate max-w-md">{book.title}</h1>
        </div>
      </div>

      {/* Reader content */}
      <div className="flex-1 overflow-hidden">
        {book.format === "pdf" && (
          <PdfReader
            bookPath={bookUrl}
            position={book.lastPosition || undefined}
            onPositionChange={handlePositionChange}
          />
        )}
        {book.format === "epub" && (
          <EpubReader
            bookPath={bookUrl}
            position={book.lastPosition || undefined}
            onPositionChange={handlePositionChange}
          />
        )}
        {book.format === "mobi" && (
          <MobiReader
            bookPath={bookUrl}
            position={book.lastPosition || undefined}
            onPositionChange={handlePositionChange}
          />
        )}
        {(book.format === "cbr" || book.format === "cbz") && (
          <ComicReader
            bookId={book.id}
            format={book.format}
            position={book.lastPosition || undefined}
            onPositionChange={handlePositionChange}
          />
        )}
        {(book.format === "m4b" || book.format === "mp3" || book.format === "m4a") && (
          <AudiobookReader
            bookPath={bookUrl}
            position={book.lastPosition || undefined}
            onPositionChange={handlePositionChange}
            chapters={book.chapters ? (JSON.parse(book.chapters) as AudioChapter[]) : undefined}
            duration={book.duration || undefined}
          />
        )}
      </div>
    </div>
  );
}
