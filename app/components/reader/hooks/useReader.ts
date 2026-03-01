"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useViewport } from "./useViewport";
import { useReaderSettings } from "./useReaderSettings";
import type {
  ReaderInfoResponse,
  PageContent,
  ReaderBookmark,
  ReaderHighlight,
  FullTextContentResponse,
} from "@/lib/reader/types";
import {
  getReaderInfo,
  getReaderPage,
  getReaderPageForPosition,
  getFullTextContent,
  getBookmarks,
  getHighlights,
  addBookmark as addBookmarkAction,
  deleteBookmark as deleteBookmarkAction,
  addHighlight as addHighlightAction,
  deleteHighlight as deleteHighlightAction,
  updateHighlightNote as updateHighlightNoteAction,
  updateHighlightColor as updateHighlightColorAction,
  saveReadingProgress,
  searchContent as searchContentAction,
} from "@/actions/reader";

interface UseReaderOptions {
  bookId: string;
  initialPosition?: number;
  formatOverride?: string;
}

interface UseReaderReturn {
  // Book info
  bookInfo: ReaderInfoResponse | null;
  loading: boolean;
  error: string | null;

  // Current page
  currentPage: number;
  totalPages: number;
  pageContent: PageContent | null;
  rightPageContent: PageContent | null; // Second page for spread view
  position: number;
  isSpreadMode: boolean;

  // Navigation
  goToPage: (page: number) => void;
  goToPosition: (position: number) => Promise<void>;
  nextPage: () => void;
  prevPage: () => void;

  // Settings
  settings: ReturnType<typeof useReaderSettings>["settings"];
  updateGlobalSetting: ReturnType<typeof useReaderSettings>["updateGlobalSetting"];
  updateBookSetting: ReturnType<typeof useReaderSettings>["updateBookSetting"];

  // Viewport
  viewport: ReturnType<typeof useViewport>;

  // Bookmarks & Highlights
  bookmarks: ReaderBookmark[];
  highlights: ReaderHighlight[];
  addBookmark: (position: number, title?: string, note?: string) => Promise<void>;
  removeBookmark: (bookmarkId: string) => Promise<void>;
  addHighlight: (
    startPosition: number,
    endPosition: number,
    text: string,
    note?: string,
    color?: string,
  ) => Promise<void>;
  removeHighlight: (highlightId: string) => Promise<void>;
  updateHighlightNote: (highlightId: string, note: string | null) => Promise<void>;
  updateHighlightColor: (highlightId: string, color: string) => Promise<void>;

  // Search
  searchResults: Array<{
    text: string;
    context: string;
    position: number;
    pageNum: number;
    chapterTitle?: string;
  }>;
  searchQuery: string;
  searching: boolean;
  searchBook: (query: string) => Promise<void>;

  // Navigation mode
  isJumpNavigation: boolean;

  // Client-side column pagination for reflowable text
  fullTextContent: FullTextContentResponse | null;
  textPageIndex: number;
  setClientTotalPages: (total: number) => void;
  setChapterTitle: (title: string) => void;

  // Progress
  saveProgress: () => Promise<void>;
}

/**
 * Main hook for the unified reader
 */
export function useReader({ bookId, initialPosition = 0, formatOverride }: UseReaderOptions): UseReaderReturn {
  const viewport = useViewport();
  const { settings, updateGlobalSetting, updateBookSetting } = useReaderSettings(bookId);

  // State
  const [bookInfo, setBookInfo] = useState<ReaderInfoResponse | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageContent, setPageContent] = useState<PageContent | null>(null);
  const [rightPageContent, setRightPageContent] = useState<PageContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bookmarks, setBookmarks] = useState<ReaderBookmark[]>([]);
  const [highlights, setHighlights] = useState<ReaderHighlight[]>([]);

  // Search state
  const [searchResults, setSearchResults] = useState<
    Array<{
      text: string;
      context: string;
      position: number;
      pageNum: number;
      chapterTitle?: string;
    }>
  >([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);

  // Client-side column pagination state for reflowable text
  const [fullTextContent, setFullTextContent] = useState<FullTextContentResponse | null>(null);
  const [clientTotalPages, setClientTotalPages] = useState<number | null>(null);
  const [chapterTitle, setChapterTitle] = useState<string>("");
  const isColumnPaginated = fullTextContent !== null;

  // Navigation mode tracking
  const isJumpNavigationRef = useRef(false);
  const [isJumpNavigation, setIsJumpNavigation] = useState(false);

  // Determine if we should show spread mode based on settings and viewport
  const isSpreadMode = (() => {
    const layout = settings.pdfPageLayout;
    if (layout === "single") return false;
    if (layout === "spread") return true;
    // Auto: use spread on wide viewports (desktop)
    return viewport.width >= 1024;
  })();

  // Track if initial position has been applied
  const initialPositionApplied = useRef(false);

  // Track prefetched pages to avoid duplicate requests
  const prefetchedPages = useRef(new Set<number>());

  // Number of pages to prefetch ahead
  const PREFETCH_AHEAD = 5;

  // Reset prefetch cache when book changes
  useEffect(() => {
    prefetchedPages.current.clear();
  }, [bookId]);

  // Build viewport config object
  const viewportConfig = {
    width: viewport.width,
    height: viewport.height,
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
  };

  // Fetch book info when viewport changes
  useEffect(() => {
    if (viewport.width === 0 || viewport.height === 0) return;

    const fetchInfo = async () => {
      try {
        const data = await getReaderInfo(bookId, viewportConfig, formatOverride);

        if (data) {
          // Check if the response contains an error (e.g., parsing failure)
          if (data.error) {
            setError(data.error);
            setBookInfo(null);
          } else {
            setBookInfo(data);
            setError(null);

            // Apply initial position if not yet applied
            if (!initialPositionApplied.current && initialPosition > 0) {
              initialPositionApplied.current = true;
              const posData = await getReaderPageForPosition(
                bookId,
                initialPosition,
                viewportConfig,
                formatOverride,
              );
              if (posData) {
                setCurrentPage(posData.pageNum);
              }
            }
          }
        } else {
          setError("Failed to load book");
        }
      } catch (err) {
        setError("Failed to connect to server");
      } finally {
        setLoading(false);
      }
    };

    fetchInfo();
  }, [
    bookId,
    viewport.width,
    viewport.height,
    settings.fontSize,
    settings.lineHeight,
    initialPosition,
    formatOverride,
  ]);

  // Fetch full text content for client-side column pagination
  useEffect(() => {
    if (!bookInfo) return;
    const fetchFullText = async () => {
      try {
        const data = await getFullTextContent(bookId, formatOverride);
        setFullTextContent(data); // null for non-text or FXL content
        if (data && !initialPositionApplied.current && initialPosition > 0) {
          // For column-paginated text, initial position will be applied once
          // the client reports totalPages (via setClientTotalPages)
          initialPositionApplied.current = true;
        }
      } catch (err) {
        console.error("Failed to fetch full text content:", err);
        setFullTextContent(null);
      }
    };
    fetchFullText();
  }, [bookId, formatOverride, bookInfo]);

  // Fetch page content when page changes (only for non-column-paginated content)
  useEffect(() => {
    if (!bookInfo || viewport.width === 0 || isColumnPaginated) return;

    const fetchPages = async () => {
      try {
        // Fetch the left (or only) page
        const data = await getReaderPage(bookId, currentPage, viewportConfig, formatOverride);

        if (data) {
          setPageContent(data.content);

          // In spread mode, also fetch the right page if available
          if (isSpreadMode && currentPage < bookInfo.totalPages) {
            const rightData = await getReaderPage(bookId, currentPage + 1, viewportConfig, formatOverride);
            if (rightData) {
              setRightPageContent(rightData.content);
            } else {
              setRightPageContent(null);
            }
          } else {
            setRightPageContent(null);
          }
        }
      } catch (err) {
        console.error("Failed to fetch page:", err);
      }
    };

    fetchPages();
  }, [
    bookId,
    currentPage,
    viewport.width,
    viewport.height,
    settings.fontSize,
    settings.lineHeight,
    bookInfo,
    isSpreadMode,
    isColumnPaginated,
    formatOverride,
  ]);

  // Prefetch upcoming pages in the background (only for non-column-paginated content)
  useEffect(() => {
    if (!bookInfo || viewport.width === 0 || isColumnPaginated) return;

    const prefetchPages = async () => {
      const totalPages = bookInfo.totalPages;

      for (let i = 1; i <= PREFETCH_AHEAD; i++) {
        const pageNum = currentPage + i;

        // Skip if beyond total pages or already prefetched
        if (pageNum > totalPages || prefetchedPages.current.has(pageNum)) {
          continue;
        }

        // Mark as prefetched before starting
        prefetchedPages.current.add(pageNum);

        // Use server action for prefetching
        getReaderPage(bookId, pageNum, viewportConfig, formatOverride)
          .then((data) => {
            // For image content (PDFs, comics), also prefetch the image
            if (data?.content?.imageUrl) {
              const img = new Image();
              img.src = data.content.imageUrl;
            }
          })
          .catch(() => {
            // Remove from prefetched so it can be retried
            prefetchedPages.current.delete(pageNum);
          });
      }
    };

    // Small delay to prioritize current page load
    const timer = setTimeout(prefetchPages, 100);
    return () => clearTimeout(timer);
  }, [
    bookId,
    currentPage,
    viewport.width,
    viewport.height,
    settings.fontSize,
    settings.lineHeight,
    bookInfo,
  ]);

  // Fetch bookmarks and highlights
  useEffect(() => {
    const fetchAnnotations = async () => {
      try {
        const [bookmarksData, highlightsData] = await Promise.all([
          getBookmarks(bookId),
          getHighlights(bookId),
        ]);

        setBookmarks(bookmarksData);
        setHighlights(highlightsData);
      } catch (err) {
        console.error("Failed to fetch annotations:", err);
      }
    };

    fetchAnnotations();
  }, [bookId]);

  // The effective total pages (client-reported for column pagination, server for others)
  const effectiveTotalPages = isColumnPaginated && clientTotalPages !== null
    ? clientTotalPages
    : bookInfo?.totalPages || 0;

  // Callback for client to report total pages from CSS column measurement
  const setClientTotalPagesCallback = useCallback(
    (total: number) => {
      setClientTotalPages(total);
      // Apply initial position once we know the real page count
      if (initialPosition > 0 && total > 1) {
        const targetPage = Math.max(1, Math.round(initialPosition * total));
        setCurrentPage(targetPage);
      }
    },
    [initialPosition],
  );

  // Navigation functions
  const goToPage = useCallback(
    (page: number) => {
      const maxPages = effectiveTotalPages;
      if (maxPages <= 0) return;
      const clampedPage = Math.max(1, Math.min(page, maxPages));
      const isJump = Math.abs(clampedPage - currentPage) > 2;
      isJumpNavigationRef.current = isJump;
      setIsJumpNavigation(isJump);
      setCurrentPage(clampedPage);
    },
    [effectiveTotalPages, currentPage],
  );

  const goToPosition = useCallback(
    async (position: number) => {
      try {
        isJumpNavigationRef.current = true;
        setIsJumpNavigation(true);

        if (isColumnPaginated && effectiveTotalPages > 0) {
          // For column pagination, map position directly to page
          const targetPage = Math.max(1, Math.round(position * effectiveTotalPages));
          setCurrentPage(targetPage);
          return;
        }

        const data = await getReaderPageForPosition(bookId, position, viewportConfig, formatOverride);
        if (data) {
          setCurrentPage(data.pageNum);
          setPageContent(data.content);
        }
      } catch (err) {
        console.error("Failed to go to position:", err);
      }
    },
    [bookId, viewport.width, viewport.height, settings.fontSize, settings.lineHeight, isColumnPaginated, effectiveTotalPages],
  );

  // In spread mode, move by 2 pages
  const pageStep = isSpreadMode ? 2 : 1;

  const nextPage = useCallback(() => {
    isJumpNavigationRef.current = false;
    setIsJumpNavigation(false);
    goToPage(currentPage + pageStep);
  }, [currentPage, goToPage, pageStep]);

  const prevPage = useCallback(() => {
    isJumpNavigationRef.current = false;
    setIsJumpNavigation(false);
    goToPage(currentPage - pageStep);
  }, [currentPage, goToPage, pageStep]);

  // Bookmark functions
  const addBookmark = useCallback(
    async (position: number, title?: string, note?: string) => {
      try {
        const bookmark = await addBookmarkAction(bookId, position, title, note);
        setBookmarks((prev) => [...prev, bookmark]);
      } catch (err) {
        console.error("Failed to add bookmark:", err);
      }
    },
    [bookId],
  );

  const removeBookmark = useCallback(async (bookmarkId: string) => {
    try {
      await deleteBookmarkAction(bookmarkId);
      setBookmarks((prev) => prev.filter((b) => b.id !== bookmarkId));
    } catch (err) {
      console.error("Failed to remove bookmark:", err);
    }
  }, []);

  // Highlight functions
  const addHighlight = useCallback(
    async (
      startPosition: number,
      endPosition: number,
      text: string,
      note?: string,
      color?: string,
    ) => {
      try {
        const highlight = await addHighlightAction(
          bookId,
          startPosition,
          endPosition,
          text,
          note,
          color,
        );
        setHighlights((prev) => [...prev, highlight]);
      } catch (err) {
        console.error("Failed to add highlight:", err);
      }
    },
    [bookId],
  );

  const removeHighlight = useCallback(async (highlightId: string) => {
    try {
      await deleteHighlightAction(highlightId);
      setHighlights((prev) => prev.filter((h) => h.id !== highlightId));
    } catch (err) {
      console.error("Failed to remove highlight:", err);
    }
  }, []);

  const updateHighlightNote = useCallback(
    async (highlightId: string, note: string | null) => {
      try {
        await updateHighlightNoteAction(highlightId, note);
        setHighlights((prev) =>
          prev.map((h) =>
            h.id === highlightId ? { ...h, note: note ?? undefined } : h,
          ),
        );
      } catch (err) {
        console.error("Failed to update highlight note:", err);
      }
    },
    [],
  );

  const updateHighlightColor = useCallback(
    async (highlightId: string, color: string) => {
      try {
        await updateHighlightColorAction(highlightId, color);
        setHighlights((prev) =>
          prev.map((h) =>
            h.id === highlightId ? { ...h, color } : h,
          ),
        );
      } catch (err) {
        console.error("Failed to update highlight color:", err);
      }
    },
    [],
  );

  // Search function
  const searchBook = useCallback(
    async (query: string) => {
      setSearchQuery(query);
      if (!query.trim()) {
        setSearchResults([]);
        return;
      }
      setSearching(true);
      try {
        const results = await searchContentAction(
          bookId,
          query,
          viewportConfig,
          formatOverride,
        );
        setSearchResults(results);
      } catch (err) {
        console.error("Search failed:", err);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    },
    [bookId, viewport.width, viewport.height, settings.fontSize, settings.lineHeight, formatOverride],
  );

  // Compute position for column-paginated content
  const columnPosition = isColumnPaginated && effectiveTotalPages > 0
    ? (currentPage - 1) / effectiveTotalPages
    : null;

  // Save progress
  const saveProgress = useCallback(async () => {
    const position = columnPosition ?? pageContent?.position;
    if (position === undefined && position === null) return;

    try {
      await saveReadingProgress(bookId, position ?? 0, currentPage);
    } catch (err) {
      console.error("Failed to save progress:", err);
    }
  }, [bookId, currentPage, pageContent, columnPosition]);

  // Auto-save progress when page changes
  useEffect(() => {
    if (!pageContent && !isColumnPaginated) return;

    const timer = setTimeout(() => {
      saveProgress();
    }, 2000); // Debounce 2 seconds

    return () => clearTimeout(timer);
  }, [currentPage, pageContent, saveProgress, isColumnPaginated]);

  return {
    bookInfo,
    loading,
    error,
    currentPage,
    totalPages: effectiveTotalPages,
    pageContent: isColumnPaginated ? { type: "text" as const, position: columnPosition ?? 0, endPosition: effectiveTotalPages > 0 ? currentPage / effectiveTotalPages : 1, chapterTitle } : pageContent,
    rightPageContent,
    position: columnPosition ?? pageContent?.position ?? 0,
    isSpreadMode,
    goToPage,
    goToPosition,
    nextPage,
    prevPage,
    settings,
    updateGlobalSetting,
    updateBookSetting,
    viewport,
    bookmarks,
    highlights,
    addBookmark,
    removeBookmark,
    addHighlight,
    removeHighlight,
    updateHighlightNote,
    updateHighlightColor,
    searchResults,
    searchQuery,
    searching,
    searchBook,
    isJumpNavigation,
    fullTextContent,
    textPageIndex: currentPage - 1, // 0-indexed for the component
    setClientTotalPages: setClientTotalPagesCallback,
    setChapterTitle,
    saveProgress,
  };
}
