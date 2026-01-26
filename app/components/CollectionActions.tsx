"use client";

import { useState } from "react";
import { EditCollectionModal } from "./CreateCollectionModal";
import { AddBooksToCollectionModal } from "./AddBooksToCollectionModal";
import type { Collection } from "../lib/db/schema";

interface CollectionActionsProps {
  collection: Collection;
}

export function CollectionActions({ collection }: CollectionActionsProps) {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isAddBooksOpen, setIsAddBooksOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2">
        {/* Add Books Button */}
        <button
          onClick={() => setIsAddBooksOpen(true)}
          className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Books
        </button>

        {/* Edit Button */}
        <button
          onClick={() => setIsEditOpen(true)}
          className="px-4 py-2 border border-border rounded-lg text-foreground hover:bg-surface-elevated transition-colors flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            />
          </svg>
          Edit
        </button>
      </div>

      {/* Modals */}
      <EditCollectionModal
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        collection={collection}
      />

      <AddBooksToCollectionModal
        isOpen={isAddBooksOpen}
        onClose={() => setIsAddBooksOpen(false)}
        collectionId={collection.id}
        collectionName={collection.name}
      />
    </>
  );
}
