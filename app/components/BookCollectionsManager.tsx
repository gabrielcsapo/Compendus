"use client";

import { useState, useEffect } from "react";
import { Link } from "react-router";
import {
  getCollections,
  addBookToCollection,
  removeBookFromCollection,
} from "../actions/collections";
import type { Collection } from "../lib/db/schema";

interface BookCollectionsManagerProps {
  bookId: string;
  currentCollections: Collection[];
}

export function BookCollectionsManager({
  bookId,
  currentCollections,
}: BookCollectionsManagerProps) {
  const [collections, setCollections] = useState<Collection[]>(currentCollections);
  const [allCollections, setAllCollections] = useState<Collection[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Load all collections when dropdown opens
  useEffect(() => {
    if (isOpen && allCollections.length === 0) {
      setIsLoading(true);
      getCollections()
        .then(setAllCollections)
        .finally(() => setIsLoading(false));
    }
  }, [isOpen, allCollections.length]);

  const handleAddToCollection = async (collectionId: string) => {
    setActionInProgress(collectionId);
    try {
      await addBookToCollection(bookId, collectionId);
      const addedCollection = allCollections.find((c) => c.id === collectionId);
      if (addedCollection) {
        setCollections((prev) => [...prev, addedCollection]);
      }
    } catch (error) {
      console.error("Failed to add to collection:", error);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRemoveFromCollection = async (collectionId: string) => {
    setActionInProgress(collectionId);
    try {
      await removeBookFromCollection(bookId, collectionId);
      setCollections((prev) => prev.filter((c) => c.id !== collectionId));
    } catch (error) {
      console.error("Failed to remove from collection:", error);
    } finally {
      setActionInProgress(null);
    }
  };

  const currentCollectionIds = new Set(collections.map((c) => c.id));
  const availableCollections = allCollections.filter((c) => !currentCollectionIds.has(c.id));

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-foreground">Collections</h2>
        <div className="relative">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="text-sm text-primary hover:text-primary-hover transition-colors flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Add to Collection
          </button>

          {/* Dropdown */}
          {isOpen && (
            <>
              {/* Backdrop to close */}
              <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-64 bg-surface border border-border rounded-lg shadow-xl z-50 overflow-hidden">
                {isLoading ? (
                  <div className="p-4 flex items-center justify-center">
                    <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : availableCollections.length === 0 ? (
                  <div className="p-4 text-center text-foreground-muted text-sm">
                    {allCollections.length === 0
                      ? "No collections yet"
                      : "Book is in all collections"}
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto">
                    {availableCollections.map((collection) => (
                      <button
                        key={collection.id}
                        onClick={() => handleAddToCollection(collection.id)}
                        disabled={actionInProgress === collection.id}
                        className="w-full px-4 py-2 text-left hover:bg-surface-elevated transition-colors flex items-center gap-2 disabled:opacity-50"
                      >
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: collection.color || "#6366f1",
                          }}
                        />
                        <span className="flex-1 truncate text-foreground">
                          {collection.icon && <span className="mr-1">{collection.icon}</span>}
                          {collection.name}
                        </span>
                        {actionInProgress === collection.id && (
                          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Current collections */}
      {collections.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {collections.map((collection) => (
            <div
              key={collection.id}
              className="group inline-flex items-center gap-1 px-3 py-1 text-sm rounded-full bg-accent-light text-accent hover:opacity-80 transition-opacity"
            >
              <Link to={`/collection/${collection.id}`} className="hover:underline">
                {collection.icon && <span className="mr-1">{collection.icon}</span>}
                {collection.name}
              </Link>
              <button
                onClick={() => handleRemoveFromCollection(collection.id)}
                disabled={actionInProgress === collection.id}
                className="ml-1 opacity-0 group-hover:opacity-100 hover:text-error transition-all disabled:opacity-50"
                title="Remove from collection"
              >
                {actionInProgress === collection.id ? (
                  <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                )}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-foreground-muted text-sm">Not in any collections</p>
      )}
    </div>
  );
}
