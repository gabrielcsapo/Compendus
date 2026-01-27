"use client";

import { useState, useEffect } from "react";
import { updateBook } from "../actions/books";
import { getTags, addTagToBookByName, removeTagFromBook } from "../actions/tags";
import type { Book, Tag } from "../lib/db/schema";

interface EditBookModalProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book;
  currentTags: Tag[];
}

export function EditBookModal({ isOpen, onClose, book, currentTags }: EditBookModalProps) {
  const [title, setTitle] = useState(book.title);
  const [subtitle, setSubtitle] = useState(book.subtitle || "");
  const [authors, setAuthors] = useState(() => {
    try {
      return book.authors ? JSON.parse(book.authors).join(", ") : "";
    } catch {
      return "";
    }
  });
  const [publisher, setPublisher] = useState(book.publisher || "");
  const [publishedDate, setPublishedDate] = useState(book.publishedDate || "");
  const [description, setDescription] = useState(book.description || "");
  const [isbn, setIsbn] = useState(book.isbn || "");
  const [language, setLanguage] = useState(book.language || "");
  const [pageCount, setPageCount] = useState(book.pageCount?.toString() || "");
  const [series, setSeries] = useState(book.series || "");
  const [seriesNumber, setSeriesNumber] = useState(book.seriesNumber || "");

  const [bookTags, setBookTags] = useState<Tag[]>(currentTags);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [showTagDropdown, setShowTagDropdown] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load all tags for suggestions
  useEffect(() => {
    async function loadTags() {
      const tags = await getTags();
      setAllTags(tags);
    }
    if (isOpen) {
      loadTags();
    }
  }, [isOpen]);

  // Reset form when book changes
  useEffect(() => {
    setTitle(book.title);
    setSubtitle(book.subtitle || "");
    try {
      setAuthors(book.authors ? JSON.parse(book.authors).join(", ") : "");
    } catch {
      setAuthors("");
    }
    setPublisher(book.publisher || "");
    setPublishedDate(book.publishedDate || "");
    setDescription(book.description || "");
    setIsbn(book.isbn || "");
    setLanguage(book.language || "");
    setPageCount(book.pageCount?.toString() || "");
    setSeries(book.series || "");
    setSeriesNumber(book.seriesNumber || "");
    setBookTags(currentTags);
  }, [book, currentTags]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Parse authors from comma-separated string
      const authorsArray = authors
        .split(",")
        .map((a) => a.trim())
        .filter((a) => a.length > 0);

      await updateBook(book.id, {
        title: title.trim(),
        subtitle: subtitle.trim() || undefined,
        authors: JSON.stringify(authorsArray),
        publisher: publisher.trim() || undefined,
        publishedDate: publishedDate.trim() || undefined,
        description: description.trim() || undefined,
        isbn: isbn.trim() || undefined,
        language: language.trim() || undefined,
        pageCount: pageCount ? parseInt(pageCount, 10) : undefined,
        series: series.trim() || undefined,
        seriesNumber: seriesNumber.trim() || undefined,
      });

      onClose();
      window.location.reload();
    } catch {
      setError("Failed to update book");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddTag = async (tagName: string) => {
    if (!tagName.trim()) return;

    const normalizedName = tagName.toLowerCase().trim();

    // Check if tag already on book
    if (bookTags.some((t) => t.name.toLowerCase() === normalizedName)) {
      setNewTagName("");
      setShowTagDropdown(false);
      return;
    }

    try {
      const tag = await addTagToBookByName(book.id, normalizedName);
      if (tag) {
        setBookTags([...bookTags, tag]);
        // Update allTags if this is a new tag
        if (!allTags.some((t) => t.id === tag.id)) {
          setAllTags([...allTags, tag]);
        }
      }
    } catch {
      setError("Failed to add tag");
    }

    setNewTagName("");
    setShowTagDropdown(false);
  };

  const handleRemoveTag = async (tagId: string) => {
    try {
      await removeTagFromBook(book.id, tagId);
      setBookTags(bookTags.filter((t) => t.id !== tagId));
    } catch {
      setError("Failed to remove tag");
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setError(null);
      setNewTagName("");
      setShowTagDropdown(false);
      onClose();
    }
  };

  // Filter tags for dropdown (exclude already added)
  const availableTags = allTags.filter((tag) => !bookTags.some((bt) => bt.id === tag.id));
  const filteredTags = newTagName
    ? availableTags.filter((tag) => tag.name.toLowerCase().includes(newTagName.toLowerCase()))
    : availableTags;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      {/* Modal */}
      <div className="relative bg-surface border border-border rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold text-foreground">Edit Book Details</h2>
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
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Title */}
            <div className="md:col-span-2">
              <label htmlFor="title" className="block text-sm font-medium text-foreground mb-1">
                Title <span className="text-error">*</span>
              </label>
              <input
                type="text"
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={isSubmitting}
              />
            </div>

            {/* Subtitle */}
            <div className="md:col-span-2">
              <label htmlFor="subtitle" className="block text-sm font-medium text-foreground mb-1">
                Subtitle
              </label>
              <input
                type="text"
                id="subtitle"
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={isSubmitting}
              />
            </div>

            {/* Authors */}
            <div className="md:col-span-2">
              <label htmlFor="authors" className="block text-sm font-medium text-foreground mb-1">
                Authors <span className="text-foreground-muted text-xs">(comma-separated)</span>
              </label>
              <input
                type="text"
                id="authors"
                value={authors}
                onChange={(e) => setAuthors(e.target.value)}
                placeholder="e.g., John Doe, Jane Smith"
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={isSubmitting}
              />
            </div>

            {/* Publisher */}
            <div>
              <label htmlFor="publisher" className="block text-sm font-medium text-foreground mb-1">
                Publisher
              </label>
              <input
                type="text"
                id="publisher"
                value={publisher}
                onChange={(e) => setPublisher(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={isSubmitting}
              />
            </div>

            {/* Published Date */}
            <div>
              <label
                htmlFor="publishedDate"
                className="block text-sm font-medium text-foreground mb-1"
              >
                Published Date
              </label>
              <input
                type="text"
                id="publishedDate"
                value={publishedDate}
                onChange={(e) => setPublishedDate(e.target.value)}
                placeholder="e.g., 2024 or 2024-01-15"
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={isSubmitting}
              />
            </div>

            {/* ISBN */}
            <div>
              <label htmlFor="isbn" className="block text-sm font-medium text-foreground mb-1">
                ISBN
              </label>
              <input
                type="text"
                id="isbn"
                value={isbn}
                onChange={(e) => setIsbn(e.target.value)}
                placeholder="ISBN-10 or ISBN-13"
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={isSubmitting}
              />
            </div>

            {/* Language */}
            <div>
              <label htmlFor="language" className="block text-sm font-medium text-foreground mb-1">
                Language
              </label>
              <input
                type="text"
                id="language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="e.g., English"
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={isSubmitting}
              />
            </div>

            {/* Page Count */}
            <div>
              <label htmlFor="pageCount" className="block text-sm font-medium text-foreground mb-1">
                Page Count
              </label>
              <input
                type="number"
                id="pageCount"
                value={pageCount}
                onChange={(e) => setPageCount(e.target.value)}
                min="0"
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={isSubmitting}
              />
            </div>

            {/* Series */}
            <div>
              <label htmlFor="series" className="block text-sm font-medium text-foreground mb-1">
                Series
              </label>
              <input
                type="text"
                id="series"
                value={series}
                onChange={(e) => setSeries(e.target.value)}
                placeholder="e.g., Harry Potter"
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={isSubmitting}
              />
            </div>

            {/* Series Number */}
            <div>
              <label
                htmlFor="seriesNumber"
                className="block text-sm font-medium text-foreground mb-1"
              >
                Series Number
              </label>
              <input
                type="text"
                id="seriesNumber"
                value={seriesNumber}
                onChange={(e) => setSeriesNumber(e.target.value)}
                placeholder="e.g., 1 or Book 1"
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={isSubmitting}
              />
            </div>

            {/* Description */}
            <div className="md:col-span-2">
              <label
                htmlFor="description"
                className="block text-sm font-medium text-foreground mb-1"
              >
                Description
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                disabled={isSubmitting}
              />
            </div>

            {/* Tags */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-foreground mb-2">Tags</label>

              {/* Current tags */}
              <div className="flex flex-wrap gap-2 mb-3">
                {bookTags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 px-3 py-1 text-sm rounded-full"
                    style={
                      tag.color
                        ? {
                            backgroundColor: tag.color + "20",
                            color: tag.color,
                          }
                        : {
                            backgroundColor: "var(--color-surface-elevated)",
                            color: "var(--color-foreground-muted)",
                          }
                    }
                  >
                    {tag.name}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag.id)}
                      className="ml-1 hover:opacity-70"
                      disabled={isSubmitting}
                    >
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </span>
                ))}
                {bookTags.length === 0 && (
                  <span className="text-sm text-foreground-muted">No tags</span>
                )}
              </div>

              {/* Add tag input */}
              <div className="relative">
                <input
                  type="text"
                  value={newTagName}
                  onChange={(e) => {
                    setNewTagName(e.target.value);
                    setShowTagDropdown(true);
                  }}
                  onFocus={() => setShowTagDropdown(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (newTagName.trim()) {
                        handleAddTag(newTagName);
                      }
                    }
                    if (e.key === "Escape") {
                      setShowTagDropdown(false);
                    }
                  }}
                  placeholder="Add a tag..."
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  disabled={isSubmitting}
                />

                {/* Tag suggestions dropdown */}
                {showTagDropdown && (newTagName || filteredTags.length > 0) && (
                  <div className="absolute z-10 w-full mt-1 bg-surface border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {newTagName &&
                      !allTags.some((t) => t.name.toLowerCase() === newTagName.toLowerCase()) && (
                        <button
                          type="button"
                          onClick={() => handleAddTag(newTagName)}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-surface-elevated flex items-center gap-2"
                        >
                          <svg
                            className="w-4 h-4 text-primary"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M12 4v16m8-8H4"
                            />
                          </svg>
                          Create "{newTagName}"
                        </button>
                      )}
                    {filteredTags.slice(0, 10).map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => handleAddTag(tag.name)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-surface-elevated flex items-center gap-2"
                      >
                        <span
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: tag.color || "#888" }}
                        />
                        {tag.name}
                      </button>
                    ))}
                    {filteredTags.length === 0 && !newTagName && (
                      <div className="px-3 py-2 text-sm text-foreground-muted">
                        No more tags available
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Click outside to close dropdown */}
              {showTagDropdown && (
                <div className="fixed inset-0 z-0" onClick={() => setShowTagDropdown(false)} />
              )}
            </div>
          </div>

          {/* Error */}
          {error && <p className="text-sm text-error mt-4">{error}</p>}

          {/* Actions */}
          <div className="flex gap-3 mt-6">
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
      </div>
    </div>
  );
}
