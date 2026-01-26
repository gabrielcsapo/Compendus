"use client";

import { useState, useEffect, useCallback } from "react";
import { getBooks } from "../actions/books";
import { addBookToCollection, getBooksInCollection } from "../actions/collections";
import type { Book } from "../lib/db/schema";

interface AddBooksToCollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  collectionId: string;
  collectionName: string;
}

export function AddBooksToCollectionModal({
  isOpen,
  onClose,
  collectionId,
  collectionName,
}: AddBooksToCollectionModalProps) {
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Book[]>([]);
  const [existingBookIds, setExistingBookIds] = useState<Set<string>>(new Set());
  const [isSearching, setIsSearching] = useState(false);
  const [addingBookIds, setAddingBookIds] = useState<Set<string>>(new Set());
  const [addedBookIds, setAddedBookIds] = useState<Set<string>>(new Set());

  // Load existing books in collection
  useEffect(() => {
    if (isOpen) {
      getBooksInCollection(collectionId).then((books) => {
        setExistingBookIds(new Set(books.map((b) => b.id)));
      });
    }
  }, [isOpen, collectionId]);

  // Search for books
  const searchBooks = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const results = await getBooks({ search: query, limit: 20 });
      setSearchResults(results);
    } catch (error) {
      console.error("Failed to search books:", error);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      searchBooks(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, searchBooks]);

  const handleAddBook = async (bookId: string) => {
    setAddingBookIds((prev) => new Set(prev).add(bookId));
    try {
      await addBookToCollection(bookId, collectionId);
      setAddedBookIds((prev) => new Set(prev).add(bookId));
      setExistingBookIds((prev) => new Set(prev).add(bookId));
    } catch (error) {
      console.error("Failed to add book:", error);
    } finally {
      setAddingBookIds((prev) => {
        const next = new Set(prev);
        next.delete(bookId);
        return next;
      });
    }
  };

  const handleClose = () => {
    setSearch("");
    setSearchResults([]);
    setAddedBookIds(new Set());
    onClose();
  };

  if (!isOpen) return null;

  // Filter out books already in collection
  const availableBooks = searchResults.filter((book) => !existingBookIds.has(book.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      {/* Modal */}
      <div className="relative bg-surface border border-border rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">
            Add Books to "{collectionName}"
          </h2>
          <button
            onClick={handleClose}
            className="text-foreground-muted hover:text-foreground"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-4 border-b border-border">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground-muted"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search books by title..."
              className="w-full pl-10 pr-4 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              autoFocus
            />
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-4">
          {isSearching ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : search.trim() === "" ? (
            <p className="text-center text-foreground-muted py-8">
              Type to search for books
            </p>
          ) : availableBooks.length === 0 ? (
            <p className="text-center text-foreground-muted py-8">
              {searchResults.length === 0
                ? "No books found"
                : "All matching books are already in this collection"}
            </p>
          ) : (
            <div className="space-y-2">
              {availableBooks.map((book) => {
                const isAdding = addingBookIds.has(book.id);
                const isAdded = addedBookIds.has(book.id);
                const authors = book.authors ? JSON.parse(book.authors).join(", ") : "";

                return (
                  <div
                    key={book.id}
                    className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-surface-elevated transition-colors"
                  >
                    {/* Cover */}
                    <div className="w-12 h-16 flex-shrink-0 rounded overflow-hidden bg-surface-elevated">
                      {book.coverPath ? (
                        <img
                          src={`/covers/${book.id}.jpg`}
                          alt={book.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-foreground-muted text-xs">
                          No cover
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">{book.title}</p>
                      {authors && (
                        <p className="text-sm text-foreground-muted truncate">{authors}</p>
                      )}
                    </div>

                    {/* Add button */}
                    <button
                      onClick={() => handleAddBook(book.id)}
                      disabled={isAdding || isAdded}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                        isAdded
                          ? "bg-green-500/10 text-green-600"
                          : "bg-primary text-white hover:bg-primary-hover disabled:opacity-50"
                      }`}
                    >
                      {isAdding ? (
                        <>
                          <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Adding...
                        </>
                      ) : isAdded ? (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Added
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          Add
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border">
          <button
            onClick={handleClose}
            className="w-full px-4 py-2 border border-border rounded-lg text-foreground hover:bg-surface-elevated transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
