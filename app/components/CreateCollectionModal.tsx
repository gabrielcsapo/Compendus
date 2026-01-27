"use client";

import { useState, useEffect } from "react";
import { createCollection, updateCollection, deleteCollection } from "../actions/collections";
import type { Collection } from "../lib/db/schema";

const COLORS = [
  "#4F46E5", // Indigo
  "#7C3AED", // Violet
  "#EC4899", // Pink
  "#EF4444", // Red
  "#F97316", // Orange
  "#EAB308", // Yellow
  "#22C55E", // Green
  "#14B8A6", // Teal
  "#06B6D4", // Cyan
  "#3B82F6", // Blue
];

const ICONS = ["📚", "📖", "📕", "📗", "📘", "📙", "🎯", "⭐", "❤️", "🔥", "💡", "🎨"];

interface CreateCollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateCollectionModal({ isOpen, onClose }: CreateCollectionModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [icon, setIcon] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await createCollection({
        name: name.trim(),
        description: description.trim() || undefined,
        color,
        icon: icon || undefined,
      });

      // Reset form and close
      setName("");
      setDescription("");
      setColor(COLORS[0]);
      setIcon("");
      onClose();

      // Refresh the page to show new collection
      window.location.reload();
    } catch {
      setError("Failed to create collection");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setName("");
      setDescription("");
      setColor(COLORS[0]);
      setIcon("");
      setError(null);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      {/* Modal */}
      <div className="relative bg-surface border border-border rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">New Collection</h2>
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="text-foreground-muted hover:text-foreground disabled:opacity-50"
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
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6">
          {/* Name */}
          <div className="mb-4">
            <label htmlFor="name" className="block text-sm font-medium text-foreground mb-1">
              Name <span className="text-error">*</span>
            </label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Fiction, To Read, Favorites"
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={isSubmitting}
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="mb-4">
            <label htmlFor="description" className="block text-sm font-medium text-foreground mb-1">
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={2}
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              disabled={isSubmitting}
            />
          </div>

          {/* Color */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-foreground mb-2">Color</label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full transition-transform ${
                    color === c ? "ring-2 ring-offset-2 ring-primary scale-110" : "hover:scale-105"
                  }`}
                  style={{ backgroundColor: c }}
                  disabled={isSubmitting}
                />
              ))}
            </div>
          </div>

          {/* Icon */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-foreground mb-2">
              Icon (optional)
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setIcon("")}
                className={`w-8 h-8 rounded-lg border text-sm flex items-center justify-center transition-colors ${
                  icon === ""
                    ? "border-primary bg-primary-light text-primary"
                    : "border-border text-foreground-muted hover:border-foreground-muted"
                }`}
                disabled={isSubmitting}
              >
                -
              </button>
              {ICONS.map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIcon(i)}
                  className={`w-8 h-8 rounded-lg border text-lg flex items-center justify-center transition-colors ${
                    icon === i
                      ? "border-primary bg-primary-light"
                      : "border-border hover:border-foreground-muted"
                  }`}
                  disabled={isSubmitting}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && <p className="text-sm text-error mb-4">{error}</p>}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 border border-border rounded-lg text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Collection"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function CreateCollectionButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button onClick={() => setIsOpen(true)} className="btn btn-primary flex items-center gap-2">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        New Collection
      </button>
      <CreateCollectionModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}

// Edit Collection Modal
interface EditCollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  collection: Collection;
}

export function EditCollectionModal({ isOpen, onClose, collection }: EditCollectionModalProps) {
  const [name, setName] = useState(collection.name);
  const [description, setDescription] = useState(collection.description || "");
  const [color, setColor] = useState(collection.color || COLORS[0]);
  const [icon, setIcon] = useState(collection.icon || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when collection changes
  useEffect(() => {
    setName(collection.name);
    setDescription(collection.description || "");
    setColor(collection.color || COLORS[0]);
    setIcon(collection.icon || "");
  }, [collection]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await updateCollection(collection.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        color,
        icon: icon || undefined,
      });

      onClose();
      window.location.reload();
    } catch {
      setError("Failed to update collection");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteCollection(collection.id);
      onClose();
      window.location.href = "/collections";
    } catch {
      setError("Failed to delete collection");
      setIsDeleting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting && !isDeleting) {
      setShowDeleteConfirm(false);
      setError(null);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      <div className="relative bg-surface border border-border rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Edit Collection</h2>
          <button
            onClick={handleClose}
            disabled={isSubmitting || isDeleting}
            className="text-foreground-muted hover:text-foreground disabled:opacity-50"
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
        </div>

        {showDeleteConfirm ? (
          <div className="p-6">
            <p className="text-foreground mb-4">
              Are you sure you want to delete "{collection.name}"? This will not delete the books in
              the collection.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="flex-1 px-4 py-2 border border-border rounded-lg text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex-1 px-4 py-2 bg-error text-white rounded-lg hover:opacity-90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Deleting...
                  </>
                ) : (
                  "Delete Collection"
                )}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6">
            <div className="mb-4">
              <label htmlFor="edit-name" className="block text-sm font-medium text-foreground mb-1">
                Name <span className="text-error">*</span>
              </label>
              <input
                type="text"
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={isSubmitting}
              />
            </div>

            <div className="mb-4">
              <label
                htmlFor="edit-description"
                className="block text-sm font-medium text-foreground mb-1"
              >
                Description
              </label>
              <textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                disabled={isSubmitting}
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-foreground mb-2">Color</label>
              <div className="flex flex-wrap gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-8 h-8 rounded-full transition-transform ${
                      color === c
                        ? "ring-2 ring-offset-2 ring-primary scale-110"
                        : "hover:scale-105"
                    }`}
                    style={{ backgroundColor: c }}
                    disabled={isSubmitting}
                  />
                ))}
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-foreground mb-2">Icon</label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setIcon("")}
                  className={`w-8 h-8 rounded-lg border text-sm flex items-center justify-center transition-colors ${
                    icon === ""
                      ? "border-primary bg-primary-light text-primary"
                      : "border-border text-foreground-muted hover:border-foreground-muted"
                  }`}
                  disabled={isSubmitting}
                >
                  -
                </button>
                {ICONS.map((i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setIcon(i)}
                    className={`w-8 h-8 rounded-lg border text-lg flex items-center justify-center transition-colors ${
                      icon === i
                        ? "border-primary bg-primary-light"
                        : "border-border hover:border-foreground-muted"
                    }`}
                    disabled={isSubmitting}
                  >
                    {i}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-error mb-4">{error}</p>}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isSubmitting}
                className="px-4 py-2 border border-error text-error rounded-lg hover:bg-error/10 transition-colors disabled:opacity-50"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={handleClose}
                disabled={isSubmitting}
                className="flex-1 px-4 py-2 border border-border rounded-lg text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Changes"
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
