"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-flight-router/client";
import { useVirtualizer } from "@tanstack/react-virtual";
import { buttonStyles } from "../lib/styles";
import { batchUpdateBooks } from "../actions/batch";
import { getFormatsByType } from "../lib/book-types";
import type { Book, Tag } from "../lib/db/schema";
import type { BookType } from "../lib/book-types";

const LANGUAGES = [
  "", "English", "Spanish", "French", "German", "Italian", "Portuguese",
  "Russian", "Chinese", "Japanese", "Korean", "Arabic", "Hindi", "Dutch",
  "Swedish", "Norwegian", "Danish", "Finnish", "Polish", "Czech", "Turkish",
  "Greek", "Hebrew", "Thai", "Vietnamese", "Indonesian", "Malay", "Romanian",
  "Hungarian", "Bulgarian", "Croatian", "Serbian", "Slovak", "Slovenian",
  "Ukrainian", "Lithuanian", "Latvian", "Estonian", "Catalan", "Basque",
  "Galician", "Welsh", "Irish", "Scottish Gaelic", "Icelandic", "Farsi",
  "Urdu", "Bengali", "Tamil", "Telugu", "Kannada", "Malayalam", "Swahili",
  "Afrikaans", "Latin",
];

const ROW_HEIGHT = 52;

type SortOption = "title-asc" | "title-desc" | "date-asc" | "date-desc";
type TypeFilter = "all" | "ebook" | "comic" | "audiobook";

type FieldFilter =
  | "missing:authors"
  | "missing:series"
  | "missing:language"
  | "missing:tags"
  | "missing:cover"
  | "missing:isbn"
  | "has:authors"
  | "has:series"
  | "has:language"
  | "has:tags"
  | "has:cover"
  | "has:isbn";

const FIELD_FILTER_OPTIONS: { value: FieldFilter; label: string; group: "missing" | "has" }[] = [
  { value: "missing:authors", label: "Missing Authors", group: "missing" },
  { value: "missing:series", label: "Missing Series", group: "missing" },
  { value: "missing:language", label: "Missing Language", group: "missing" },
  { value: "missing:tags", label: "Missing Tags", group: "missing" },
  { value: "missing:cover", label: "Missing Cover", group: "missing" },
  { value: "missing:isbn", label: "Missing ISBN", group: "missing" },
  { value: "has:authors", label: "Has Authors", group: "has" },
  { value: "has:series", label: "Has Series", group: "has" },
  { value: "has:language", label: "Has Language", group: "has" },
  { value: "has:tags", label: "Has Tags", group: "has" },
  { value: "has:cover", label: "Has Cover", group: "has" },
  { value: "has:isbn", label: "Has ISBN", group: "has" },
];

interface BookEdits {
  title?: string;
  authors?: string;
  series?: string;
  seriesNumber?: string;
  bookTypeOverride?: string | null;
  language?: string;
}

function bookMatchesType(book: Book, type: string): boolean {
  if (book.bookTypeOverride === type) return true;
  if (book.bookTypeOverride && book.bookTypeOverride !== type) return false;
  return getFormatsByType(type as BookType).includes(book.format);
}

function parseAuthors(authors: string | null): string {
  if (!authors) return "";
  try {
    const parsed = JSON.parse(authors);
    if (Array.isArray(parsed)) {
      return parsed.filter((a): a is string => typeof a === "string").join(", ");
    }
    return "";
  } catch {
    return "";
  }
}

interface BatchEditClientProps {
  books: Book[];
  bookTags: Record<string, Tag[]>;
  allTags: Tag[];
  seriesNames: string[];
  authorNames: string[];
}

export function BatchEditClient({ books: initialBooks, bookTags: initialBookTags, allTags, seriesNames, authorNames }: BatchEditClientProps) {
  const allBooks = initialBooks;
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [fieldFilters, setFieldFilters] = useState<Set<FieldFilter>>(new Set());
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>("title-asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleFieldFilter = useCallback((filter: FieldFilter) => {
    setFieldFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) {
        next.delete(filter);
      } else {
        // Remove conflicting filter (e.g., can't have both missing:series and has:series)
        const [, field] = filter.split(":");
        const opposite = filter.startsWith("missing:") ? `has:${field}` : `missing:${field}`;
        next.delete(opposite as FieldFilter);
        next.add(filter);
      }
      return next;
    });
  }, []);
  const [edits, setEdits] = useState<Map<string, BookEdits>>(new Map());
  const [bookTagsState, setBookTagsState] = useState<Record<string, Tag[]>>({ ...initialBookTags });
  const [tagAdditions, setTagAdditions] = useState<Map<string, string[]>>(new Map());
  const [tagRemovals, setTagRemovals] = useState<Map<string, string[]>>(new Map());
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<{ current: number; total: number } | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Bulk action inputs
  const [bulkSeries, setBulkSeries] = useState("");
  const [bulkAuthors, setBulkAuthors] = useState("");
  const [bulkAddTag, setBulkAddTag] = useState("");
  const [bulkRemoveTag, setBulkRemoveTag] = useState("");
  const [bulkLanguage, setBulkLanguage] = useState("");
  const [bulkCategory, setBulkCategory] = useState("");

  // Column filter state
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});

  // Tag input state per book (search text + dropdown visibility)
  const [tagInputState, setTagInputState] = useState<Record<string, string>>({});
  const [openTagDropdown, setOpenTagDropdown] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // Virtualization
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Simulate loading state — defer heavy render until after mount
  useEffect(() => {
    const timer = requestAnimationFrame(() => setIsLoading(false));
    return () => cancelAnimationFrame(timer);
  }, []);

  // Prevent body scroll while batch edit is mounted
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // Close tag dropdown when clicking outside
  useEffect(() => {
    if (!openTagDropdown) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(`[data-tag-cell="${openTagDropdown}"]`)) {
        setOpenTagDropdown(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openTagDropdown]);

  const filteredBooks = useMemo(() => {
    const filtered = allBooks.filter((book) => {
      // Always show selected books
      if (selectedIds.has(book.id)) return true;
      // Apply search filter across all fields
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const bookEdits = edits.get(book.id);
        const fields = [
          bookEdits?.title ?? book.title,
          book.authors,
          book.description,
          bookEdits?.series ?? book.series,
          bookEdits?.seriesNumber ?? book.seriesNumber,
          bookEdits?.language ?? book.language,
          book.bookTypeOverride,
          book.format,
          book.publisher,
          book.isbn,
          book.isbn13,
          book.isbn10,
        ];
        // Also search tags
        const tagNames = (bookTagsState[book.id] || []).map((t) => t.name).join(" ");
        fields.push(tagNames);
        const haystack = fields.filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      // Apply column filters
      const bookEditsForFilter = edits.get(book.id);
      for (const [col, filterVal] of Object.entries(columnFilters)) {
        if (!filterVal) continue;
        const q = filterVal.toLowerCase();
        let cellValue = "";
        switch (col) {
          case "title":
            cellValue = (bookEditsForFilter?.title ?? book.title ?? "").toLowerCase();
            break;
          case "authors":
            cellValue = (bookEditsForFilter?.authors ?? parseAuthors(book.authors)).toLowerCase();
            break;
          case "series":
            cellValue = (bookEditsForFilter?.series ?? book.series ?? "").toLowerCase();
            break;
          case "seriesNumber":
            cellValue = (bookEditsForFilter?.seriesNumber ?? book.seriesNumber ?? "").toLowerCase();
            break;
          case "tags":
            cellValue = (bookTagsState[book.id] || []).map((t) => t.name).join(" ").toLowerCase();
            break;
          case "category":
            cellValue = (bookEditsForFilter?.bookTypeOverride ?? book.bookTypeOverride ?? "").toLowerCase();
            break;
          case "language":
            cellValue = (bookEditsForFilter?.language ?? book.language ?? "").toLowerCase();
            break;
        }
        if (!cellValue.includes(q)) return false;
      }
      // Apply type filter
      if (typeFilter !== "all") {
        if (!bookMatchesType(book, typeFilter)) return false;
      }
      // Apply field filters
      if (fieldFilters.size > 0) {
        const tags = bookTagsState[book.id] || [];
        const bookEdits = edits.get(book.id);
        for (const filter of fieldFilters) {
          const [mode, field] = filter.split(":") as ["missing" | "has", string];
          let hasValue = false;
          switch (field) {
            case "authors": {
              const val = bookEdits?.authors ?? parseAuthors(book.authors);
              hasValue = val.trim().length > 0;
              break;
            }
            case "series": {
              const val = bookEdits?.series ?? book.series;
              hasValue = !!val && val.trim().length > 0;
              break;
            }
            case "language": {
              const val = bookEdits?.language ?? book.language;
              hasValue = !!val && val.trim().length > 0;
              break;
            }
            case "tags":
              hasValue = tags.length > 0;
              break;
            case "cover":
              hasValue = !!book.coverPath;
              break;
            case "isbn":
              hasValue = !!(book.isbn || book.isbn13 || book.isbn10);
              break;
          }
          if (mode === "missing" && hasValue) return false;
          if (mode === "has" && !hasValue) return false;
        }
      }
      return true;
    });

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case "title-asc":
          return a.title.localeCompare(b.title);
        case "title-desc":
          return b.title.localeCompare(a.title);
        case "date-desc": {
          const aTime = a.createdAt?.getTime() ?? 0;
          const bTime = b.createdAt?.getTime() ?? 0;
          return bTime - aTime;
        }
        case "date-asc": {
          const aTime = a.createdAt?.getTime() ?? 0;
          const bTime = b.createdAt?.getTime() ?? 0;
          return aTime - bTime;
        }
        default:
          return 0;
      }
    });

    return filtered;
  }, [allBooks, searchQuery, typeFilter, selectedIds, edits, bookTagsState, fieldFilters, sortBy, columnFilters]);

  const rowVirtualizer = useVirtualizer({
    count: filteredBooks.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const getEditValue = useCallback(
    (bookId: string, field: keyof BookEdits): string | undefined => {
      const bookEdits = edits.get(bookId);
      if (!bookEdits) return undefined;
      const val = bookEdits[field];
      if (val === null) return "";
      return val as string | undefined;
    },
    [edits],
  );

  const setEditValue = useCallback(
    (bookId: string, field: keyof BookEdits, value: string | null) => {
      setEdits((prev) => {
        const next = new Map(prev);
        const existing = next.get(bookId) || {};
        next.set(bookId, { ...existing, [field]: value });
        return next;
      });
    },
    [],
  );

  const isFieldModified = useCallback(
    (bookId: string, field: keyof BookEdits): boolean => {
      const bookEdits = edits.get(bookId);
      return bookEdits !== undefined && field in bookEdits;
    },
    [edits],
  );

  const isBookTagsModified = useCallback(
    (bookId: string): boolean => {
      return (tagAdditions.get(bookId)?.length ?? 0) > 0 || (tagRemovals.get(bookId)?.length ?? 0) > 0;
    },
    [tagAdditions, tagRemovals],
  );

  const toggleSelect = useCallback((bookId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) {
        next.delete(bookId);
      } else {
        next.add(bookId);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allVisible = filteredBooks.map((b) => b.id);
      const allSelected = allVisible.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        for (const id of allVisible) {
          next.delete(id);
        }
        return next;
      }
      const next = new Set(prev);
      for (const id of allVisible) {
        next.add(id);
      }
      return next;
    });
  }, [filteredBooks]);

  const allVisibleSelected = useMemo(() => {
    if (filteredBooks.length === 0) return false;
    return filteredBooks.every((b) => selectedIds.has(b.id));
  }, [filteredBooks, selectedIds]);

  const addTagToBook = useCallback(
    (bookId: string, tag: Tag) => {
      setBookTagsState((prev) => {
        const current = prev[bookId] || [];
        if (current.some((t) => t.id === tag.id)) return prev;
        return { ...prev, [bookId]: [...current, tag] };
      });
      setTagAdditions((prev) => {
        const next = new Map(prev);
        const existing = next.get(bookId) || [];
        if (!existing.includes(tag.name)) {
          next.set(bookId, [...existing, tag.name]);
        }
        return next;
      });
      setTagRemovals((prev) => {
        const next = new Map(prev);
        const existing = next.get(bookId) || [];
        next.set(bookId, existing.filter((id) => id !== tag.id));
        return next;
      });
      setOpenTagDropdown(null);
    },
    [],
  );

  const removeTagFromBookLocal = useCallback(
    (bookId: string, tagId: string) => {
      setBookTagsState((prev) => {
        const current = prev[bookId] || [];
        return { ...prev, [bookId]: current.filter((t) => t.id !== tagId) };
      });
      setTagRemovals((prev) => {
        const next = new Map(prev);
        const existing = next.get(bookId) || [];
        if (!existing.includes(tagId)) {
          next.set(bookId, [...existing, tagId]);
        }
        return next;
      });
      const tag = allTags.find((t) => t.id === tagId);
      if (tag) {
        setTagAdditions((prev) => {
          const next = new Map(prev);
          const existing = next.get(bookId) || [];
          next.set(bookId, existing.filter((name) => name !== tag.name));
          return next;
        });
      }
    },
    [allTags],
  );

  // Bulk actions
  const applyBulkSeries = useCallback(() => {
    if (!bulkSeries.trim()) return;
    setEdits((prev) => {
      const next = new Map(prev);
      for (const id of selectedIds) {
        const existing = next.get(id) || {};
        next.set(id, { ...existing, series: bulkSeries.trim() });
      }
      return next;
    });
    setBulkSeries("");
  }, [bulkSeries, selectedIds]);

  const applyBulkAuthors = useCallback(() => {
    if (!bulkAuthors.trim()) return;
    setEdits((prev) => {
      const next = new Map(prev);
      for (const id of selectedIds) {
        const existing = next.get(id) || {};
        next.set(id, { ...existing, authors: bulkAuthors.trim() });
      }
      return next;
    });
    setBulkAuthors("");
  }, [bulkAuthors, selectedIds]);

  const applyBulkAddTag = useCallback(() => {
    if (!bulkAddTag) return;
    const tag = allTags.find((t) => t.id === bulkAddTag);
    if (!tag) return;
    for (const bookId of selectedIds) {
      addTagToBook(bookId, tag);
    }
    setBulkAddTag("");
  }, [bulkAddTag, selectedIds, allTags, addTagToBook]);

  const applyBulkRemoveTag = useCallback(() => {
    if (!bulkRemoveTag) return;
    for (const bookId of selectedIds) {
      removeTagFromBookLocal(bookId, bulkRemoveTag);
    }
    setBulkRemoveTag("");
  }, [bulkRemoveTag, selectedIds, removeTagFromBookLocal]);

  const applyBulkLanguage = useCallback(() => {
    if (!bulkLanguage) return;
    setEdits((prev) => {
      const next = new Map(prev);
      for (const id of selectedIds) {
        const existing = next.get(id) || {};
        next.set(id, { ...existing, language: bulkLanguage });
      }
      return next;
    });
    setBulkLanguage("");
  }, [bulkLanguage, selectedIds]);

  const applyBulkCategory = useCallback(() => {
    if (!bulkCategory) return;
    setEdits((prev) => {
      const next = new Map(prev);
      for (const id of selectedIds) {
        const existing = next.get(id) || {};
        next.set(id, { ...existing, bookTypeOverride: bulkCategory === "auto" ? null : bulkCategory });
      }
      return next;
    });
    setBulkCategory("");
  }, [bulkCategory, selectedIds]);

  const isDirty = useMemo(() => {
    if (edits.size > 0) return true;
    for (const [, additions] of tagAdditions) {
      if (additions.length > 0) return true;
    }
    for (const [, removals] of tagRemovals) {
      if (removals.length > 0) return true;
    }
    return false;
  }, [edits, tagAdditions, tagRemovals]);

  const dirtyCount = useMemo(() => {
    const ids = new Set<string>();
    for (const [id] of edits) ids.add(id);
    for (const [id, a] of tagAdditions) { if (a.length > 0) ids.add(id); }
    for (const [id, r] of tagRemovals) { if (r.length > 0) ids.add(id); }
    return ids.size;
  }, [edits, tagAdditions, tagRemovals]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setMessage(null);
    setSaveProgress(null);

    try {
      const dirtyBookIds = new Set<string>();
      for (const [id] of edits) dirtyBookIds.add(id);
      for (const [id, additions] of tagAdditions) {
        if (additions.length > 0) dirtyBookIds.add(id);
      }
      for (const [id, removals] of tagRemovals) {
        if (removals.length > 0) dirtyBookIds.add(id);
      }

      const updates: Array<{
        id: string;
        data?: Partial<{
          title: string;
          series: string;
          seriesNumber: string;
          authors: string;
          bookTypeOverride: string | null;
          language: string;
        }>;
        addTags?: string[];
        removeTags?: string[];
      }> = [];

      for (const id of dirtyBookIds) {
        const bookEdits = edits.get(id);
        const addTags = tagAdditions.get(id)?.filter((t) => t.length > 0);
        const removeTags = tagRemovals.get(id)?.filter((t) => t.length > 0);

        const update: (typeof updates)[number] = { id };

        if (bookEdits && Object.keys(bookEdits).length > 0) {
          const data: Record<string, string | null> = {};
          for (const [key, value] of Object.entries(bookEdits)) {
            if (key === "authors" && typeof value === "string") {
              data[key] = JSON.stringify(
                value.split(",").map((a) => a.trim()).filter(Boolean),
              );
            } else {
              data[key] = value as string | null;
            }
          }
          update.data = data as typeof update.data;
        }

        if (addTags && addTags.length > 0) update.addTags = addTags;
        if (removeTags && removeTags.length > 0) update.removeTags = removeTags;
        updates.push(update);
      }

      if (updates.length === 0) {
        setMessage({ type: "success", text: "No changes to save." });
        setIsSaving(false);
        return;
      }

      // Save in batches to show progress
      const BATCH_SIZE = 10;
      let totalUpdated = 0;
      const allErrors: string[] = [];

      for (let i = 0; i < updates.length; i += BATCH_SIZE) {
        const batch = updates.slice(i, i + BATCH_SIZE);
        setSaveProgress({ current: i, total: updates.length });

        const result = await batchUpdateBooks(batch);
        totalUpdated += result.updated;
        allErrors.push(...result.errors);
      }

      setSaveProgress({ current: updates.length, total: updates.length });

      if (allErrors.length > 0) {
        setMessage({
          type: "error",
          text: `Updated ${totalUpdated} books. ${allErrors.length} error(s): ${allErrors.slice(0, 3).join("; ")}${allErrors.length > 3 ? "..." : ""}`,
        });
      } else {
        setMessage({ type: "success", text: `Successfully updated ${totalUpdated} book${totalUpdated !== 1 ? "s" : ""}.` });
        setEdits(new Map());
        setTagAdditions(new Map());
        setTagRemovals(new Map());
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch (error) {
      setMessage({
        type: "error",
        text: `Save failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setIsSaving(false);
      setSaveProgress(null);
    }
  }, [edits, tagAdditions, tagRemovals]);

  const modifiedCellClass = "bg-amber-50 dark:bg-amber-900/20";
  const cellInputClass = "w-full px-2 py-1 text-sm border border-border rounded bg-background text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary-light";
  const cellSelectClass = "w-full px-2 py-1 text-sm border border-border rounded bg-background text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary-light";

  // Loading state
  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background overflow-hidden">
        <header className="bg-surface border-b border-border px-6 py-3 flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-primary hover:text-primary-hover transition-colors text-sm">&larr; Library</Link>
            <h1 className="text-xl font-bold text-foreground">Batch Edit</h1>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-foreground-muted text-sm">Loading {allBooks.length} books...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background overflow-hidden">
      {/* Shared datalists for autocomplete — rendered once instead of per-row */}
      <datalist id="shared-authors-datalist">
        {authorNames.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>
      <datalist id="shared-series-datalist">
        {seriesNames.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {/* Header */}
      <header className="bg-surface border-b border-border px-6 py-3 flex items-center gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-primary hover:text-primary-hover transition-colors text-sm">&larr; Library</Link>
          <h1 className="text-xl font-bold text-foreground">Batch Edit</h1>
          <span className="text-sm text-foreground-muted">
            {filteredBooks.length === allBooks.length
              ? `${allBooks.length} books`
              : `${filteredBooks.length} of ${allBooks.length} books`}
          </span>
        </div>

        <div className="flex-1 max-w-md ml-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search all fields..."
            className={`${cellInputClass} !w-full !px-3 !py-2`}
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-surface-elevated rounded-lg">
          {([
            { value: "all", label: "All" },
            { value: "ebook", label: "eBooks" },
            { value: "comic", label: "Comics" },
            { value: "audiobook", label: "Audio" },
          ] as const).map((option) => (
            <button
              key={option.value}
              onClick={() => setTypeFilter(option.value)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                typeFilter === option.value
                  ? "bg-primary text-white shadow-sm"
                  : "text-foreground-muted hover:text-foreground hover:bg-surface"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
          className={`${cellSelectClass} !w-auto !px-3 !py-2 shrink-0`}
        >
          <option value="title-asc">Title A-Z</option>
          <option value="title-desc">Title Z-A</option>
          <option value="date-desc">Newest First</option>
          <option value="date-asc">Oldest First</option>
        </select>

        <button
          onClick={() => setShowFilterPanel(!showFilterPanel)}
          className={`${buttonStyles.base} ${fieldFilters.size > 0 ? buttonStyles.secondary : buttonStyles.ghost} shrink-0 relative`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          Filter
          {fieldFilters.size > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-primary text-white text-[10px] flex items-center justify-center font-bold">
              {fieldFilters.size}
            </span>
          )}
        </button>

        <button
          onClick={handleSave}
          disabled={isSaving || !isDirty}
          className={`${buttonStyles.base} ${buttonStyles.primary} shrink-0`}
        >
          {isSaving ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {saveProgress
                ? `Saving ${saveProgress.current}/${saveProgress.total}...`
                : "Preparing..."}
            </>
          ) : isDirty ? (
            `Save ${dirtyCount} Change${dirtyCount !== 1 ? "s" : ""}`
          ) : (
            "No Changes"
          )}
        </button>
      </header>

      {/* Filter Panel */}
      {showFilterPanel && (
        <div className="bg-surface border-b border-border px-6 py-3 shrink-0">
          <div className="flex items-start gap-6">
            <div>
              <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wider block mb-2">Missing</span>
              <div className="flex flex-wrap gap-1.5">
                {FIELD_FILTER_OPTIONS.filter((f) => f.group === "missing").map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => toggleFieldFilter(opt.value)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                      fieldFilters.has(opt.value)
                        ? "bg-warning-light text-warning border-warning/30"
                        : "bg-surface-elevated text-foreground-muted border-border hover:border-foreground-muted"
                    }`}
                  >
                    {opt.label.replace("Missing ", "")}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wider block mb-2">Has</span>
              <div className="flex flex-wrap gap-1.5">
                {FIELD_FILTER_OPTIONS.filter((f) => f.group === "has").map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => toggleFieldFilter(opt.value)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                      fieldFilters.has(opt.value)
                        ? "bg-success-light text-success border-success/30"
                        : "bg-surface-elevated text-foreground-muted border-border hover:border-foreground-muted"
                    }`}
                  >
                    {opt.label.replace("Has ", "")}
                  </button>
                ))}
              </div>
            </div>
            {fieldFilters.size > 0 && (
              <button
                onClick={() => setFieldFilters(new Set())}
                className="text-xs text-foreground-muted hover:text-foreground transition-colors mt-5"
              >
                Clear all
              </button>
            )}
          </div>
        </div>
      )}

      {/* Active filter pills (shown when panel is closed) */}
      {!showFilterPanel && fieldFilters.size > 0 && (
        <div className="bg-surface border-b border-border px-6 py-1.5 flex items-center gap-2 shrink-0">
          <span className="text-xs text-foreground-muted">Filters:</span>
          {Array.from(fieldFilters).map((filter) => {
            const opt = FIELD_FILTER_OPTIONS.find((f) => f.value === filter);
            const isMissing = filter.startsWith("missing:");
            return (
              <span
                key={filter}
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${
                  isMissing
                    ? "bg-warning-light text-warning border-warning/30"
                    : "bg-success-light text-success border-success/30"
                }`}
              >
                {opt?.label}
                <button
                  onClick={() => toggleFieldFilter(filter)}
                  className="hover:opacity-60 ml-0.5"
                >
                  x
                </button>
              </span>
            );
          })}
          <button
            onClick={() => setFieldFilters(new Set())}
            className="text-xs text-foreground-muted hover:text-foreground transition-colors ml-1"
          >
            Clear
          </button>
        </div>
      )}

      {/* Saving overlay */}
      {isSaving && (
        <div className="px-6 py-2 bg-primary-light border-b border-primary/20 flex items-center gap-3 shrink-0">
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-medium text-primary">
            {saveProgress
              ? `Saving changes... (${saveProgress.current} of ${saveProgress.total} books)`
              : "Preparing to save..."}
          </span>
          {saveProgress && (
            <div className="flex-1 max-w-xs">
              <div className="h-1.5 bg-primary/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${(saveProgress.current / saveProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Status message */}
      {message && !isSaving && (
        <div
          className={`px-6 py-2 text-sm flex items-center justify-between shrink-0 ${
            message.type === "success"
              ? "bg-success-light text-success"
              : "bg-danger-light text-danger"
          }`}
        >
          <span>{message.text}</span>
          <button
            onClick={() => setMessage(null)}
            className="ml-4 opacity-60 hover:opacity-100"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Table Header */}
      <div className="bg-surface-elevated border-b border-border shrink-0">
        <div className="flex items-center text-xs font-semibold text-foreground-muted uppercase tracking-wider">
          <div className="px-3 py-2 w-10 shrink-0">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAll}
              className="rounded border-border"
            />
          </div>
          <div className="px-2 py-2 w-12 shrink-0">Cover</div>
          <div className="px-2 py-2 min-w-[200px] flex-[2]">Title</div>
          <div className="px-2 py-2 min-w-[160px] flex-[1.5]">Authors</div>
          <div className="px-2 py-2 min-w-[140px] flex-1">Series</div>
          <div className="px-2 py-2 w-20 shrink-0">#</div>
          <div className="px-2 py-2 min-w-[180px] flex-[1.5]">Tags</div>
          <div className="px-2 py-2 w-28 shrink-0">Category</div>
          <div className="px-2 py-2 w-28 shrink-0">Language</div>
        </div>
        {/* Column Filters Row */}
        <div className="flex items-center border-t border-border/50">
          <div className="px-3 py-1 w-10 shrink-0" />
          <div className="px-2 py-1 w-12 shrink-0" />
          <div className="px-2 py-1 min-w-[200px] flex-[2]">
            <input
              type="text"
              value={columnFilters.title || ""}
              onChange={(e) => setColumnFilters((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="Filter title..."
              className="w-full px-1.5 py-0.5 text-xs border border-border/60 rounded bg-background text-foreground placeholder:text-foreground-muted/50 focus:border-primary focus:outline-none"
            />
          </div>
          <div className="px-2 py-1 min-w-[160px] flex-[1.5]">
            <input
              type="text"
              value={columnFilters.authors || ""}
              onChange={(e) => setColumnFilters((prev) => ({ ...prev, authors: e.target.value }))}
              placeholder="Filter authors..."
              className="w-full px-1.5 py-0.5 text-xs border border-border/60 rounded bg-background text-foreground placeholder:text-foreground-muted/50 focus:border-primary focus:outline-none"
            />
          </div>
          <div className="px-2 py-1 min-w-[140px] flex-1">
            <input
              type="text"
              value={columnFilters.series || ""}
              onChange={(e) => setColumnFilters((prev) => ({ ...prev, series: e.target.value }))}
              placeholder="Filter series..."
              className="w-full px-1.5 py-0.5 text-xs border border-border/60 rounded bg-background text-foreground placeholder:text-foreground-muted/50 focus:border-primary focus:outline-none"
            />
          </div>
          <div className="px-2 py-1 w-20 shrink-0">
            <input
              type="text"
              value={columnFilters.seriesNumber || ""}
              onChange={(e) => setColumnFilters((prev) => ({ ...prev, seriesNumber: e.target.value }))}
              placeholder="#"
              className="w-full px-1.5 py-0.5 text-xs border border-border/60 rounded bg-background text-foreground placeholder:text-foreground-muted/50 focus:border-primary focus:outline-none"
            />
          </div>
          <div className="px-2 py-1 min-w-[180px] flex-[1.5]">
            <input
              type="text"
              value={columnFilters.tags || ""}
              onChange={(e) => setColumnFilters((prev) => ({ ...prev, tags: e.target.value }))}
              placeholder="Filter tags..."
              className="w-full px-1.5 py-0.5 text-xs border border-border/60 rounded bg-background text-foreground placeholder:text-foreground-muted/50 focus:border-primary focus:outline-none"
            />
          </div>
          <div className="px-2 py-1 w-28 shrink-0">
            <input
              type="text"
              value={columnFilters.category || ""}
              onChange={(e) => setColumnFilters((prev) => ({ ...prev, category: e.target.value }))}
              placeholder="Filter..."
              className="w-full px-1.5 py-0.5 text-xs border border-border/60 rounded bg-background text-foreground placeholder:text-foreground-muted/50 focus:border-primary focus:outline-none"
            />
          </div>
          <div className="px-2 py-1 w-28 shrink-0">
            <input
              type="text"
              value={columnFilters.language || ""}
              onChange={(e) => setColumnFilters((prev) => ({ ...prev, language: e.target.value }))}
              placeholder="Filter..."
              className="w-full px-1.5 py-0.5 text-xs border border-border/60 rounded bg-background text-foreground placeholder:text-foreground-muted/50 focus:border-primary focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Bulk Actions Bar — pinned below column headers */}
      {selectedIds.size > 0 && (
        <div className="z-10 bg-primary-light/50 border-b border-primary/20 px-6 py-2.5 flex flex-wrap items-center gap-3 shrink-0">
          <span className="text-sm font-medium text-foreground whitespace-nowrap">
            {selectedIds.size} book{selectedIds.size !== 1 ? "s" : ""} selected
          </span>

          <div className="w-px h-6 bg-border" />

          {/* Bulk Set Series */}
          <div className="flex items-center gap-1">
            <label className="text-xs text-foreground-muted whitespace-nowrap">Series:</label>
            <input
              list="bulk-series-list"
              type="text"
              value={bulkSeries}
              onChange={(e) => setBulkSeries(e.target.value)}
              placeholder="Series name"
              className={`${cellInputClass} !w-36`}
              onKeyDown={(e) => e.key === "Enter" && applyBulkSeries()}
            />
            <datalist id="bulk-series-list">
              {seriesNames.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <button
              onClick={applyBulkSeries}
              disabled={!bulkSeries.trim()}
              className={`${buttonStyles.base} ${buttonStyles.ghost} !px-2 !py-1 text-xs`}
            >
              Apply
            </button>
          </div>

          <div className="w-px h-6 bg-border" />

          {/* Bulk Set Authors */}
          <div className="flex items-center gap-1">
            <label className="text-xs text-foreground-muted whitespace-nowrap">Authors:</label>
            <input
              list="bulk-authors-list"
              type="text"
              value={bulkAuthors}
              onChange={(e) => setBulkAuthors(e.target.value)}
              placeholder="Author 1, Author 2"
              className={`${cellInputClass} !w-40`}
              onKeyDown={(e) => e.key === "Enter" && applyBulkAuthors()}
            />
            <datalist id="bulk-authors-list">
              {authorNames.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
            <button
              onClick={applyBulkAuthors}
              disabled={!bulkAuthors.trim()}
              className={`${buttonStyles.base} ${buttonStyles.ghost} !px-2 !py-1 text-xs`}
            >
              Apply
            </button>
          </div>

          <div className="w-px h-6 bg-border" />

          {/* Bulk Add Tag */}
          <div className="flex items-center gap-1">
            <label className="text-xs text-foreground-muted whitespace-nowrap">+Tag:</label>
            <select
              value={bulkAddTag}
              onChange={(e) => setBulkAddTag(e.target.value)}
              className={`${cellSelectClass} !w-32`}
            >
              <option value="">Select...</option>
              {allTags.map((tag) => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
            <button
              onClick={applyBulkAddTag}
              disabled={!bulkAddTag}
              className={`${buttonStyles.base} ${buttonStyles.ghost} !px-2 !py-1 text-xs`}
            >
              Apply
            </button>
          </div>

          <div className="w-px h-6 bg-border" />

          {/* Bulk Remove Tag */}
          <div className="flex items-center gap-1">
            <label className="text-xs text-foreground-muted whitespace-nowrap">-Tag:</label>
            <select
              value={bulkRemoveTag}
              onChange={(e) => setBulkRemoveTag(e.target.value)}
              className={`${cellSelectClass} !w-32`}
            >
              <option value="">Select...</option>
              {allTags.map((tag) => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
            <button
              onClick={applyBulkRemoveTag}
              disabled={!bulkRemoveTag}
              className={`${buttonStyles.base} ${buttonStyles.ghost} !px-2 !py-1 text-xs`}
            >
              Apply
            </button>
          </div>

          <div className="w-px h-6 bg-border" />

          {/* Bulk Set Language */}
          <div className="flex items-center gap-1">
            <label className="text-xs text-foreground-muted whitespace-nowrap">Language:</label>
            <select
              value={bulkLanguage}
              onChange={(e) => setBulkLanguage(e.target.value)}
              className={`${cellSelectClass} !w-28`}
            >
              <option value="">Select...</option>
              {LANGUAGES.filter(Boolean).map((lang) => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
            <button
              onClick={applyBulkLanguage}
              disabled={!bulkLanguage}
              className={`${buttonStyles.base} ${buttonStyles.ghost} !px-2 !py-1 text-xs`}
            >
              Apply
            </button>
          </div>

          <div className="w-px h-6 bg-border" />

          {/* Bulk Set Category */}
          <div className="flex items-center gap-1">
            <label className="text-xs text-foreground-muted whitespace-nowrap">Category:</label>
            <select
              value={bulkCategory}
              onChange={(e) => setBulkCategory(e.target.value)}
              className={`${cellSelectClass} !w-28`}
            >
              <option value="">Select...</option>
              <option value="auto">Auto</option>
              <option value="ebook">eBook</option>
              <option value="comic">Comic</option>
              <option value="audiobook">Audiobook</option>
            </select>
            <button
              onClick={applyBulkCategory}
              disabled={!bulkCategory}
              className={`${buttonStyles.base} ${buttonStyles.ghost} !px-2 !py-1 text-xs`}
            >
              Apply
            </button>
          </div>
        </div>
      )}

      {/* Virtualized Table Body */}
      <div ref={scrollContainerRef} className="flex-1 overflow-auto">
        <div
          style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: "100%", position: "relative" }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const book = filteredBooks[virtualRow.index];
            const currentAuthors = getEditValue(book.id, "authors") ?? parseAuthors(book.authors);
            const currentSeries = getEditValue(book.id, "series") ?? (book.series || "");
            const currentSeriesNumber = getEditValue(book.id, "seriesNumber") ?? (book.seriesNumber || "");
            const currentCategory = getEditValue(book.id, "bookTypeOverride") ?? (book.bookTypeOverride || "");
            const currentLanguage = getEditValue(book.id, "language") ?? (book.language || "");
            const currentTags = bookTagsState[book.id] || [];

            return (
              <div
                key={book.id}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  minHeight: `${ROW_HEIGHT}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className={`flex items-center border-b border-border hover:bg-surface-elevated/50 ${
                  selectedIds.has(book.id) ? "bg-primary-light/30" : ""
                }`}
              >
                {/* Checkbox */}
                <div className="px-3 w-10 shrink-0">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(book.id)}
                    onChange={() => toggleSelect(book.id)}
                    className="rounded border-border"
                  />
                </div>

                {/* Cover */}
                <div className="px-2 w-12 shrink-0">
                  {book.coverPath ? (
                    <img
                      src={`/covers/${book.id}.jpg?v=${book.updatedAt?.getTime() || ""}`}
                      alt=""
                      className="w-8 h-10 object-cover rounded"
                      loading="lazy"
                    />
                  ) : (
                    <div
                      className="w-8 h-10 rounded bg-surface-elevated flex items-center justify-center"
                      style={{ backgroundColor: book.coverColor || undefined }}
                    >
                      <svg className="w-4 h-4 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Title */}
                <div className={`px-2 min-w-[200px] flex-[2] ${isFieldModified(book.id, "title") ? modifiedCellClass : ""}`}>
                  <input
                    type="text"
                    value={getEditValue(book.id, "title") ?? book.title}
                    onChange={(e) => setEditValue(book.id, "title", e.target.value)}
                    className={cellInputClass}
                  />
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-foreground-muted uppercase">{book.format}</span>
                    {book.description && (
                      <span className="text-[10px] text-foreground-muted line-clamp-1">{book.description}</span>
                    )}
                  </div>
                </div>

                {/* Authors */}
                <div className={`px-2 min-w-[160px] flex-[1.5] ${isFieldModified(book.id, "authors") ? modifiedCellClass : ""}`}>
                  <input
                    list="shared-authors-datalist"
                    type="text"
                    value={currentAuthors}
                    onChange={(e) => setEditValue(book.id, "authors", e.target.value)}
                    placeholder="Author 1, Author 2"
                    className={cellInputClass}
                  />
                </div>

                {/* Series */}
                <div className={`px-2 min-w-[140px] flex-1 ${isFieldModified(book.id, "series") ? modifiedCellClass : ""}`}>
                  <input
                    list="shared-series-datalist"
                    type="text"
                    value={currentSeries}
                    onChange={(e) => setEditValue(book.id, "series", e.target.value)}
                    placeholder="Series name"
                    className={cellInputClass}
                  />
                </div>

                {/* Series # */}
                <div className={`px-2 w-20 shrink-0 ${isFieldModified(book.id, "seriesNumber") ? modifiedCellClass : ""}`}>
                  <input
                    type="text"
                    value={currentSeriesNumber}
                    onChange={(e) => setEditValue(book.id, "seriesNumber", e.target.value)}
                    placeholder="#"
                    className={cellInputClass}
                  />
                </div>

                {/* Tags */}
                <div
                  className={`px-2 py-1 min-w-[180px] flex-[1.5] ${isBookTagsModified(book.id) ? modifiedCellClass : ""}`}
                  data-tag-cell={book.id}
                >
                  <div className="flex flex-wrap items-center gap-1 border border-border rounded px-1.5 py-1 bg-background min-h-[28px]">
                    {currentTags.map((tag) => (
                      <span
                        key={tag.id}
                        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium gap-1 shrink-0"
                        style={
                          tag.color
                            ? { backgroundColor: tag.color + "20", color: tag.color }
                            : { backgroundColor: "var(--color-surface-elevated)", color: "var(--color-foreground-muted)" }
                        }
                      >
                        {tag.name}
                        <button
                          onClick={() => removeTagFromBookLocal(book.id, tag.id)}
                          className="hover:opacity-60 leading-none"
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                    <input
                      type="text"
                      value={tagInputState[book.id] || ""}
                      onChange={(e) => {
                        setTagInputState((prev) => ({ ...prev, [book.id]: e.target.value }));
                        setOpenTagDropdown(book.id);
                        const cellEl = e.currentTarget.closest("[data-tag-cell]");
                        if (cellEl) {
                          const rect = cellEl.getBoundingClientRect();
                          setDropdownPos({ top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 180) });
                        }
                      }}
                      onFocus={(e) => {
                        setOpenTagDropdown(book.id);
                        const cellEl = e.currentTarget.closest("[data-tag-cell]");
                        if (cellEl) {
                          const rect = cellEl.getBoundingClientRect();
                          setDropdownPos({ top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 180) });
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setOpenTagDropdown(null);
                        if (e.key === "Backspace" && !tagInputState[book.id] && currentTags.length > 0) {
                          removeTagFromBookLocal(book.id, currentTags[currentTags.length - 1].id);
                        }
                      }}
                      placeholder={currentTags.length === 0 ? "Add tags..." : ""}
                      className="flex-1 min-w-[50px] bg-transparent text-[11px] text-foreground outline-none border-none p-0"
                    />
                  </div>
                </div>

                {/* Category */}
                <div className={`px-2 w-28 shrink-0 ${isFieldModified(book.id, "bookTypeOverride") ? modifiedCellClass : ""}`}>
                  <select
                    value={currentCategory}
                    onChange={(e) => setEditValue(book.id, "bookTypeOverride", e.target.value || null)}
                    className={cellSelectClass}
                  >
                    <option value="">Auto</option>
                    <option value="ebook">eBook</option>
                    <option value="comic">Comic</option>
                    <option value="audiobook">Audiobook</option>
                  </select>
                </div>

                {/* Language */}
                <div className={`px-2 w-28 shrink-0 ${isFieldModified(book.id, "language") ? modifiedCellClass : ""}`}>
                  <select
                    value={currentLanguage}
                    onChange={(e) => setEditValue(book.id, "language", e.target.value)}
                    className={cellSelectClass}
                  >
                    {LANGUAGES.map((lang) => (
                      <option key={lang} value={lang}>
                        {lang || "(none)"}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>

        {filteredBooks.length === 0 && (
          <div className="text-center py-16 text-foreground-muted">
            No books match your search or filter.
          </div>
        )}
      </div>

      {/* Tag dropdown portal — rendered outside scroll container to avoid clipping */}
      {openTagDropdown && dropdownPos && (() => {
        const bookId = openTagDropdown;
        const currentTags = bookTagsState[bookId] || [];
        const query = (tagInputState[bookId] || "").toLowerCase();
        const available = allTags
          .filter((tag) => !currentTags.some((t) => t.id === tag.id))
          .filter((tag) => !query || tag.name.toLowerCase().includes(query));
        if (available.length === 0 && !query) return null;
        return createPortal(
          <div
            data-tag-cell={bookId}
            className="fixed bg-surface border border-border rounded-lg shadow-lg py-1 max-h-48 overflow-y-auto"
            style={{
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: dropdownPos.width,
              zIndex: 9999,
            }}
          >
            {available.map((tag) => (
              <button
                key={tag.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  addTagToBook(bookId, tag);
                  setTagInputState((prev) => ({ ...prev, [bookId]: "" }));
                }}
                className="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-surface-elevated transition-colors flex items-center gap-2"
              >
                {tag.color && (
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                )}
                {tag.name}
              </button>
            ))}
            {available.length === 0 && (
              <span className="block px-3 py-1.5 text-sm text-foreground-muted">No matching tags</span>
            )}
          </div>,
          document.body,
        );
      })()}

    </div>
  );
}
