"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PageContent, ReaderHighlight, FullTextContentResponse } from "@/lib/reader/types";
import type { ReaderSettings } from "@/lib/reader/settings";
import { THEMES, FONTS } from "@/lib/reader/settings";
import { AudiobookPlayerView } from "../audio/AudiobookPlayerView";
import type { AudioChapter } from "@/lib/types";
import { HighlightToolbar, HighlightEditToolbar } from "./HighlightToolbar";
import {
  selectionToPositions,
  applyHighlightsToDOM,
  calculateToolbarPosition,
} from "./utils/highlightUtils";
import { resolveInternalLink, getFootnoteContent } from "@/actions/reader";

/**
 * Scope EPUB CSS rules under a container selector to prevent leaking into app UI.
 * Skips @-rules (media, font-face, keyframes) and remaps body/html selectors.
 */
function scopeEpubCss(css: string, scope: string): string {
  // Remove @import rules (we serve resources via API)
  let result = css.replace(/@import\s+[^;]+;/gi, "");

  // Process CSS rule by rule using a simple state machine
  const output: string[] = [];
  let i = 0;

  while (i < result.length) {
    // Skip whitespace
    while (i < result.length && /\s/.test(result[i])) {
      output.push(result[i]);
      i++;
    }
    if (i >= result.length) break;

    // Check for @-rules
    if (result[i] === "@") {
      const atStart = i;
      // Find the @-rule name
      const atMatch = result.slice(i).match(/^@[\w-]+/);
      if (atMatch) {
        const atName = atMatch[0].toLowerCase();
        if (atName === "@media" || atName === "@supports") {
          // Find the opening brace and pass through the @-rule wrapper,
          // but scope the inner selectors
          const braceIdx = result.indexOf("{", i);
          if (braceIdx === -1) break;
          output.push(result.slice(atStart, braceIdx + 1));
          i = braceIdx + 1;
          // Find matching closing brace
          let depth = 1;
          let innerStart = i;
          while (i < result.length && depth > 0) {
            if (result[i] === "{") depth++;
            else if (result[i] === "}") depth--;
            if (depth > 0) i++;
          }
          // Scope the inner CSS
          const inner = result.slice(innerStart, i);
          output.push(scopeEpubCss(inner, scope));
          output.push("}");
          i++; // skip closing brace
          continue;
        }
        // For @font-face, @keyframes, etc. — pass through unmodified
        const braceIdx = result.indexOf("{", i);
        if (braceIdx === -1) break;
        let depth = 1;
        let j = braceIdx + 1;
        while (j < result.length && depth > 0) {
          if (result[j] === "{") depth++;
          else if (result[j] === "}") depth--;
          j++;
        }
        output.push(result.slice(atStart, j));
        i = j;
        continue;
      }
    }

    // Regular rule: find selector(s) before {
    const braceIdx = result.indexOf("{", i);
    if (braceIdx === -1) break;

    const selectorText = result.slice(i, braceIdx).trim();
    // Find the matching closing brace
    let depth = 1;
    let j = braceIdx + 1;
    while (j < result.length && depth > 0) {
      if (result[j] === "{") depth++;
      else if (result[j] === "}") depth--;
      j++;
    }
    const ruleBody = result.slice(braceIdx, j);

    // Scope each selector
    if (selectorText) {
      const scopedSelectors = selectorText
        .split(",")
        .map((sel) => {
          const s = sel.trim();
          if (!s) return s;
          // Remap body/html selectors to the scope container
          if (/^(html|body)$/i.test(s)) return scope;
          if (/^(html|body)\s/i.test(s)) return s.replace(/^(html|body)\s/i, `${scope} `);
          return `${scope} ${s}`;
        })
        .join(", ");
      output.push(scopedSelectors + " " + ruleBody);
    }

    i = j;
  }

  return output.join("");
}

interface ReaderContentProps {
  content: PageContent | null;
  rightContent?: PageContent | null; // Second page for spread view
  settings: ReaderSettings;
  isSpreadMode?: boolean;
  isJumpNavigation?: boolean;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  onCenterTap?: () => void;
  // Book identification
  bookId?: string;
  hasTranscript?: boolean;
  formatOverride?: string;
  // Client-side column pagination (reflowable text)
  fullTextContent?: FullTextContentResponse | null;
  textPageIndex?: number;
  onTextTotalPagesChange?: (totalPages: number) => void;
  onChapterChange?: (chapterTitle: string) => void;
  // Audio-specific props
  audioChapters?: AudioChapter[];
  audioDuration?: number;
  coverPath?: string;
  // Highlighting props
  highlights?: ReaderHighlight[];
  onAddHighlight?: (
    startPosition: number,
    endPosition: number,
    text: string,
    note?: string,
    color?: string,
  ) => void;
  onRemoveHighlight?: (highlightId: string) => void;
  onUpdateHighlightColor?: (highlightId: string, color: string) => void;
  onUpdateHighlightNote?: (highlightId: string, note: string | null) => void;
  // Selection toolbar action: open in-book search with the selected text
  onSearchInBook?: (text: string) => void;
  // Navigation
  onNavigateToPosition?: (position: number) => void;
  // Ref for TTS access to text DOM
  textContentRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * Renders page content based on type (text, image, audio)
 */
export function ReaderContent({
  content,
  rightContent,
  settings,
  isSpreadMode,
  isJumpNavigation,
  onPrevPage,
  onNextPage,
  onCenterTap,
  bookId,
  hasTranscript,
  formatOverride,
  fullTextContent,
  textPageIndex,
  onTextTotalPagesChange,
  onChapterChange,
  audioChapters: _audioChapters,
  audioDuration: _audioDuration,
  coverPath,
  highlights,
  onAddHighlight,
  onRemoveHighlight,
  onUpdateHighlightColor,
  onUpdateHighlightNote,
  onSearchInBook,
  onNavigateToPosition,
  textContentRef,
}: ReaderContentProps) {
  if (!content && !fullTextContent) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const theme = THEMES[settings.theme];
  const contentType = content?.type || (fullTextContent ? "text" : undefined);

  switch (contentType) {
    case "text":
      // Use column pagination for reflowable text content
      if (fullTextContent) {
        return (
          <ColumnPaginatedText
            fullContent={fullTextContent}
            pageIndex={textPageIndex || 0}
            onTotalPagesChange={onTextTotalPagesChange}
            onChapterChange={onChapterChange}
            isJumpNavigation={isJumpNavigation}
            isSpreadMode={isSpreadMode}
            settings={settings}
            onPrevPage={onPrevPage}
            onNextPage={onNextPage}
            onCenterTap={onCenterTap}
            bookId={bookId}
            formatOverride={formatOverride}
            highlights={highlights}
            onAddHighlight={onAddHighlight}
            onRemoveHighlight={onRemoveHighlight}
            onUpdateHighlightColor={onUpdateHighlightColor}
            onUpdateHighlightNote={onUpdateHighlightNote}
            onSearchInBook={onSearchInBook}
            onNavigateToPosition={onNavigateToPosition}
            theme={theme}
            textContentRef={textContentRef}
          />
        );
      }
      // Fallback: FXL or legacy per-page rendering
      if (content) {
        return (
          <TextContent
            content={content}
            rightContent={isSpreadMode ? rightContent : null}
            isSpreadMode={isSpreadMode}
            isJumpNavigation={isJumpNavigation}
            settings={settings}
            onPrevPage={onPrevPage}
            onNextPage={onNextPage}
            onCenterTap={onCenterTap}
            bookId={bookId}
            formatOverride={formatOverride}
            highlights={highlights}
            onAddHighlight={onAddHighlight}
            onRemoveHighlight={onRemoveHighlight}
            onUpdateHighlightColor={onUpdateHighlightColor}
            onUpdateHighlightNote={onUpdateHighlightNote}
            onSearchInBook={onSearchInBook}
            onNavigateToPosition={onNavigateToPosition}
            theme={theme}
            textContentRef={textContentRef}
          />
        );
      }
      return null;
    case "image":
      return (
        <ImageContent
          content={content!}
          rightContent={rightContent}
          settings={settings}
          isSpreadMode={isSpreadMode}
          isJumpNavigation={isJumpNavigation}
          onPrevPage={onPrevPage}
          onNextPage={onNextPage}
          onCenterTap={onCenterTap}
        />
      );
    case "audio":
      return (
        <AudiobookPlayerView
          content={content!}
          settings={settings}
          bookId={bookId}
          hasTranscript={hasTranscript}
          coverPath={coverPath}
          isJumpNavigation={isJumpNavigation}
          onNavigateToPosition={onNavigateToPosition}
        />
      );
    default:
      return <div>Unsupported content type</div>;
  }
}

/**
 * Column-paginated text renderer for reflowable EPUB/MOBI content.
 * Uses CSS multi-column layout to constrain text to the viewport height
 * and determine page breaks from actual rendered content.
 */
function ColumnPaginatedText({
  fullContent,
  pageIndex,
  onTotalPagesChange,
  onChapterChange,
  isJumpNavigation,
  isSpreadMode,
  settings,
  onPrevPage,
  onNextPage,
  onCenterTap,
  bookId,
  formatOverride,
  highlights,
  onAddHighlight,
  onRemoveHighlight,
  onUpdateHighlightColor,
  onUpdateHighlightNote,
  onSearchInBook,
  onNavigateToPosition,
  theme,
  textContentRef,
}: {
  fullContent: FullTextContentResponse;
  pageIndex: number;
  onTotalPagesChange?: (totalPages: number) => void;
  onChapterChange?: (chapterTitle: string) => void;
  isJumpNavigation?: boolean;
  isSpreadMode?: boolean;
  settings: ReaderSettings;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  onCenterTap?: () => void;
  bookId?: string;
  formatOverride?: string;
  highlights?: ReaderHighlight[];
  onAddHighlight?: (
    startPosition: number,
    endPosition: number,
    text: string,
    note?: string,
    color?: string,
  ) => void;
  onRemoveHighlight?: (highlightId: string) => void;
  onUpdateHighlightColor?: (highlightId: string, color: string) => void;
  onUpdateHighlightNote?: (highlightId: string, note: string | null) => void;
  onSearchInBook?: (text: string) => void;
  onNavigateToPosition?: (position: number) => void;
  theme: {
    background: string;
    foreground: string;
    muted: string;
    accent: string;
    selection: string;
  };
  textContentRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const font = FONTS[settings.fontFamily];
  const outerRef = useRef<HTMLDivElement>(null);
  const readingAreaRef = useRef<HTMLDivElement>(null);
  const paginatorRef = useRef<HTMLDivElement>(null);
  const internalContentRef = useRef<HTMLDivElement>(null);
  const contentRef = textContentRef || internalContentRef;

  // Reading area dimensions (measured via ResizeObserver)
  const [readingArea, setReadingArea] = useState({ width: 0, height: 0 });
  const [totalPages, setTotalPages] = useState(1);
  const prevPageIndexRef = useRef(pageIndex);

  // Highlight state
  const [showToolbar, setShowToolbar] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState<{ x: number; y: number; above: boolean }>({
    x: 0,
    y: 0,
    above: true,
  });
  const [currentSelection, setCurrentSelection] = useState<{
    startPosition: number;
    endPosition: number;
    text: string;
  } | null>(null);
  const [showEditToolbar, setShowEditToolbar] = useState(false);
  const [editToolbarPosition, setEditToolbarPosition] = useState<{
    x: number;
    y: number;
    above: boolean;
  }>({ x: 0, y: 0, above: true });
  const [editingHighlight, setEditingHighlight] = useState<{
    id: string;
    text: string;
    note?: string;
    color: string;
  } | null>(null);
  const [footnotePopover, setFootnotePopover] = useState<{
    content: string;
    position: { x: number; y: number };
  } | null>(null);
  const [tapFeedback, setTapFeedback] = useState<"left" | "right" | null>(null);
  const [contentCss, setContentCss] = useState("");

  // Column layout calculations
  const containerWidth = readingArea.width;
  // In spread mode, each CSS column occupies half the container (2 columns visible per page)
  const columnSlotWidth =
    isSpreadMode && containerWidth >= 600 ? containerWidth / 2 : containerWidth;
  const readingWidth =
    containerWidth > 0
      ? Math.min(columnSlotWidth * (1 - (2 * settings.margins) / 100), settings.maxWidth)
      : 0;
  const marginPx = containerWidth > 0 ? (columnSlotWidth - readingWidth) / 2 : 0;
  const columnGap = containerWidth > 0 ? columnSlotWidth - readingWidth : 40;

  // Measure reading area with ResizeObserver
  useEffect(() => {
    const el = readingAreaRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setReadingArea({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Calculate total pages from actual rendered content
  useEffect(() => {
    if (!paginatorRef.current || containerWidth <= 0) return;
    // Use double rAF to ensure layout is complete after HTML injection
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!paginatorRef.current) return;
        const scrollW = paginatorRef.current.scrollWidth;
        const pages = Math.max(1, Math.round(scrollW / columnSlotWidth));
        setTotalPages(pages);
        onTotalPagesChange?.(pages);
      });
    });
  }, [
    fullContent.html,
    containerWidth,
    columnSlotWidth,
    readingArea.height,
    settings.fontSize,
    settings.lineHeight,
    settings.fontFamily,
    settings.textAlign,
    settings.maxWidth,
    settings.margins,
    contentCss,
  ]);

  // Detect current chapter from page position
  useEffect(() => {
    if (!onChapterChange || totalPages <= 0 || fullContent.totalCharacters <= 0) return;
    const pageCharStart = (pageIndex / totalPages) * fullContent.totalCharacters;
    const chapter = fullContent.chapters.find(
      (ch) => ch.characterStart <= pageCharStart && ch.characterEnd > pageCharStart,
    );
    if (chapter) onChapterChange(chapter.title);
  }, [pageIndex, totalPages, fullContent.chapters, fullContent.totalCharacters, onChapterChange]);

  // Fetch and scope EPUB publisher CSS
  useEffect(() => {
    if (!settings.usePublisherStyles || !fullContent.cssUrls?.length) {
      setContentCss("");
      return;
    }
    let cancelled = false;
    Promise.all(
      fullContent.cssUrls.map((url) =>
        fetch(url)
          .then((r) => r.text())
          .catch(() => ""),
      ),
    ).then((sheets) => {
      if (!cancelled) {
        setContentCss(sheets.map((css) => scopeEpubCss(css, ".reader-content")).join("\n"));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fullContent.cssUrls, settings.usePublisherStyles]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT"
      )
        return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        onNextPage?.();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        onPrevPage?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onPrevPage, onNextPage]);

  // Text selection for highlighting
  useEffect(() => {
    const handleSelectionEnd = () => {
      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !contentRef.current) return;
        const range = selection.getRangeAt(0);
        if (!contentRef.current.contains(range.commonAncestorContainer)) return;
        // Full book is in DOM, so position range is [0, 1]
        const positions = selectionToPositions(contentRef.current, 0, 1);
        if (positions) {
          setCurrentSelection(positions);
          const selectionRect = range.getBoundingClientRect();
          const containerRect = outerRef.current?.getBoundingClientRect();
          if (containerRect) {
            setToolbarPosition(calculateToolbarPosition(selectionRect, containerRect));
          }
          setShowToolbar(true);
        }
      }, 50);
    };
    document.addEventListener("mouseup", handleSelectionEnd);
    document.addEventListener("touchend", handleSelectionEnd);
    return () => {
      document.removeEventListener("mouseup", handleSelectionEnd);
      document.removeEventListener("touchend", handleSelectionEnd);
    };
  }, []);

  // Click on existing highlights
  useEffect(() => {
    const handleHighlightClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const highlightMark = target.closest("[data-highlight-id]") as HTMLElement | null;
      if (!highlightMark || !contentRef.current) return;
      const highlightId = highlightMark.getAttribute("data-highlight-id");
      if (!highlightId) return;
      const highlight = highlights?.find((h) => h.id === highlightId);
      if (!highlight) return;
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) return;
      e.stopPropagation();
      const markRect = highlightMark.getBoundingClientRect();
      const containerRect = outerRef.current?.getBoundingClientRect();
      if (containerRect) {
        setEditToolbarPosition(calculateToolbarPosition(markRect, containerRect));
      }
      setEditingHighlight({
        id: highlight.id,
        text: highlight.text,
        note: highlight.note,
        color: highlight.color,
      });
      setShowEditToolbar(true);
      setShowToolbar(false);
    };
    const el = contentRef.current;
    if (el) {
      el.addEventListener("click", handleHighlightClick);
      return () => el.removeEventListener("click", handleHighlightClick);
    }
  }, [highlights]);

  // Intercept EPUB link clicks: footnotes and internal navigation
  useEffect(() => {
    const el = contentRef.current;
    if (!el || !bookId) return;
    const handleLinkClick = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest("a") as HTMLAnchorElement | null;
      if (!link) return;
      if (link.hasAttribute("data-footnote-ref")) {
        e.preventDefault();
        e.stopPropagation();
        const href = link.getAttribute("href");
        if (href) {
          const text = await getFootnoteContent(bookId, href, formatOverride);
          if (text) {
            const rect = link.getBoundingClientRect();
            const containerRect = outerRef.current?.getBoundingClientRect();
            if (containerRect) {
              setFootnotePopover({
                content: text,
                position: {
                  x: Math.min(rect.left - containerRect.left, containerRect.width - 320),
                  y: rect.bottom - containerRect.top + 8,
                },
              });
            }
            return;
          }
        }
      }
      const href = link.getAttribute("href");
      if (
        href &&
        !href.startsWith("http://") &&
        !href.startsWith("https://") &&
        !href.startsWith("mailto:")
      ) {
        e.preventDefault();
        e.stopPropagation();
        let epubPath = href;
        if (href.includes("/api/reader/") && href.includes("/resource/")) {
          epubPath = decodeURIComponent(href.split("/resource/")[1] || "");
        }
        if (epubPath && onNavigateToPosition) {
          const result = await resolveInternalLink(bookId, epubPath, formatOverride);
          if (result) onNavigateToPosition(result.position);
        }
      }
    };
    el.addEventListener("click", handleLinkClick);
    return () => el.removeEventListener("click", handleLinkClick);
  }, [bookId, formatOverride, onNavigateToPosition]);

  // Apply saved highlights to DOM after content renders
  useEffect(() => {
    if (!highlights?.length || !contentRef.current) return;
    requestAnimationFrame(() => {
      if (contentRef.current) {
        applyHighlightsToDOM(contentRef.current, highlights, 0, 1);
      }
    });
  }, [fullContent.html, highlights]);

  // Tap navigation with 1/3 zones
  const handleContentClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("a, button, input, select, textarea, [data-highlight-id]")) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const relativeX = clickX / rect.width;
      if (relativeX < 0.33) {
        setTapFeedback("left");
        setTimeout(() => setTapFeedback(null), 150);
        onPrevPage?.();
      } else if (relativeX > 0.67) {
        setTapFeedback("right");
        setTimeout(() => setTapFeedback(null), 150);
        onNextPage?.();
      } else {
        onCenterTap?.();
      }
    },
    [onPrevPage, onNextPage, onCenterTap],
  );

  const handleHighlight = useCallback(
    (color: string, note?: string) => {
      if (currentSelection && onAddHighlight) {
        onAddHighlight(
          currentSelection.startPosition,
          currentSelection.endPosition,
          currentSelection.text,
          note,
          color,
        );
      }
      window.getSelection()?.removeAllRanges();
      setShowToolbar(false);
      setCurrentSelection(null);
    },
    [currentSelection, onAddHighlight],
  );

  // Determine if this page turn is a jump (for disabling transition)
  const isJump = isJumpNavigation || Math.abs(pageIndex - prevPageIndexRef.current) > 1;
  prevPageIndexRef.current = pageIndex;

  const textStyles = {
    fontFamily: font.value,
    fontSize: `${settings.fontSize}px`,
    lineHeight: settings.lineHeight,
    textAlign: settings.textAlign,
    "--tw-prose-body": theme.foreground,
    "--tw-prose-headings": theme.foreground,
    "--tw-prose-links": theme.accent,
    "--tw-prose-bold": theme.foreground,
    "--tw-prose-counters": theme.muted,
    "--tw-prose-bullets": theme.muted,
    "--tw-prose-hr": theme.muted,
    "--tw-prose-quotes": theme.foreground,
    "--tw-prose-quote-borders": theme.muted,
    "--tw-prose-captions": theme.muted,
    "--tw-prose-code": theme.foreground,
    "--tw-prose-pre-code": theme.foreground,
    "--tw-prose-pre-bg": theme.background,
    "--tw-prose-th-borders": theme.muted,
    "--tw-prose-td-borders": theme.muted,
    "--reader-selection-color": theme.selection,
  } as React.CSSProperties;

  return (
    <div
      ref={outerRef}
      className="h-full overflow-hidden relative"
      style={{ backgroundColor: theme.background, color: theme.foreground }}
    >
      {/* Padding wrapper for toolbar space */}
      <div className="h-full flex flex-col">
        {/* Reading area - measured by ResizeObserver */}
        <div
          ref={readingAreaRef}
          className="flex-1 overflow-hidden relative"
          onClick={handleContentClick}
        >
          {readingArea.width > 0 && readingArea.height > 0 && (
            <div
              ref={paginatorRef}
              style={{
                height: `${readingArea.height}px`,
                columnWidth: `${readingWidth}px`,
                columnGap: `${columnGap}px`,
                columnFill: "auto" as const,
                paddingLeft: `${marginPx}px`,
                paddingRight: `${marginPx}px`,
                transform: `translateX(-${pageIndex * columnSlotWidth}px)`,
                transition: isJump ? "none" : "transform 0.3s ease",
                willChange: "transform",
              }}
            >
              <div
                ref={contentRef}
                className="reader-content prose max-w-none"
                style={textStyles}
                // biome-ignore lint/security/noDangerouslySetInnerHtml: Content is sanitized server-side
                dangerouslySetInnerHTML={{ __html: fullContent.html }}
              />
            </div>
          )}
          {/* Spread mode center divider */}
          {isSpreadMode && containerWidth >= 600 && (
            <div
              className="absolute top-0 bottom-0 pointer-events-none"
              style={{
                left: "50%",
                width: "1px",
                backgroundColor: `${theme.foreground}12`,
              }}
            />
          )}
        </div>
      </div>

      {/* Image constraint CSS for column pagination */}
      <style>{`
        .reader-content img,
        .reader-content svg,
        .reader-content video {
          max-width: 100%;
          max-height: ${readingArea.height}px;
          height: auto;
          object-fit: contain;
          break-inside: avoid;
          box-sizing: border-box;
        }
        .reader-content figure,
        .reader-content .image-container,
        .reader-content div:has(> img) {
          break-inside: avoid;
          max-width: 100%;
          overflow: hidden;
        }
        .reader-content table {
          max-width: 100%;
          overflow-x: auto;
          display: block;
          break-inside: avoid;
        }
      `}</style>

      {/* EPUB publisher CSS */}
      {contentCss && (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: CSS is scoped and sanitized
        <style dangerouslySetInnerHTML={{ __html: contentCss }} />
      )}

      {/* Tap feedback overlays */}
      {tapFeedback && (
        <div
          className="absolute inset-y-0 pointer-events-none flex items-center justify-center"
          style={{
            left: tapFeedback === "left" ? 0 : undefined,
            right: tapFeedback === "right" ? 0 : undefined,
            width: "33%",
            backgroundColor: `${theme.foreground}06`,
            animation: "tapFlash 150ms ease-out forwards",
          }}
        >
          <svg
            className="w-8 h-8"
            fill="none"
            stroke={`${theme.foreground}30`}
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            {tapFeedback === "left" ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            )}
          </svg>
        </div>
      )}

      {/* Highlight toolbar (new selection) */}
      {showToolbar && currentSelection && (
        <HighlightToolbar
          position={toolbarPosition}
          selectedText={currentSelection.text}
          onHighlight={handleHighlight}
          onDismiss={() => {
            setShowToolbar(false);
            window.getSelection()?.removeAllRanges();
          }}
          onSearchInBook={onSearchInBook}
          theme={theme}
        />
      )}

      {/* Edit toolbar (existing highlight) */}
      {showEditToolbar && editingHighlight && (
        <HighlightEditToolbar
          position={editToolbarPosition}
          highlight={editingHighlight}
          onChangeColor={(highlightId, color) => {
            onUpdateHighlightColor?.(highlightId, color);
            setEditingHighlight((prev) => (prev ? { ...prev, color } : null));
          }}
          onSaveNote={(highlightId, note) => {
            onUpdateHighlightNote?.(highlightId, note);
            setEditingHighlight((prev) => (prev ? { ...prev, note: note ?? undefined } : null));
          }}
          onCopy={(text) => {
            if (navigator.clipboard?.writeText) {
              navigator.clipboard.writeText(text);
            }
          }}
          onDelete={(highlightId) => {
            onRemoveHighlight?.(highlightId);
          }}
          onDismiss={() => {
            setShowEditToolbar(false);
            setEditingHighlight(null);
          }}
          onSearchInBook={onSearchInBook}
          theme={theme}
        />
      )}

      {/* Footnote popover */}
      {footnotePopover && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setFootnotePopover(null)} />
          <div
            className="absolute z-50 max-w-xs p-4 rounded-lg shadow-xl border"
            style={{
              left: Math.max(8, footnotePopover.position.x),
              top: footnotePopover.position.y,
              backgroundColor: theme.background,
              borderColor: `${theme.foreground}20`,
              color: theme.foreground,
              maxHeight: "200px",
              overflowY: "auto",
            }}
          >
            <p className="text-sm leading-relaxed">{footnotePopover.content}</p>
          </div>
        </>
      )}

      <style>{`@keyframes tapFlash { 0% { opacity: 1; } 100% { opacity: 0; } }`}</style>
    </div>
  );
}

/**
 * Text content renderer (EPUB, MOBI) - legacy per-page mode.
 * Used for FXL EPUBs and fallback when full content is not available.
 */
function TextContent({
  content,
  rightContent,
  isSpreadMode,
  isJumpNavigation,
  settings,
  onPrevPage,
  onNextPage,
  onCenterTap,
  bookId,
  formatOverride,
  highlights,
  onAddHighlight,
  onRemoveHighlight,
  onUpdateHighlightColor,
  onUpdateHighlightNote,
  onSearchInBook,
  onNavigateToPosition,
  theme,
  textContentRef,
}: {
  content: PageContent;
  rightContent?: PageContent | null;
  isSpreadMode?: boolean;
  isJumpNavigation?: boolean;
  settings: ReaderSettings;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  onCenterTap?: () => void;
  bookId?: string;
  formatOverride?: string;
  highlights?: ReaderHighlight[];
  onAddHighlight?: (
    startPosition: number,
    endPosition: number,
    text: string,
    note?: string,
    color?: string,
  ) => void;
  onRemoveHighlight?: (highlightId: string) => void;
  onUpdateHighlightColor?: (highlightId: string, color: string) => void;
  onUpdateHighlightNote?: (highlightId: string, note: string | null) => void;
  onSearchInBook?: (text: string) => void;
  onNavigateToPosition?: (position: number) => void;
  theme: {
    background: string;
    foreground: string;
    muted: string;
    accent: string;
    selection: string;
  };
  textContentRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const font = FONTS[settings.fontFamily];
  const internalContentRef = useRef<HTMLDivElement>(null);
  const contentRef = textContentRef || internalContentRef;
  const rightContentRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showToolbar, setShowToolbar] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState<{ x: number; y: number; above: boolean }>({
    x: 0,
    y: 0,
    above: true,
  });
  const [currentSelection, setCurrentSelection] = useState<{
    startPosition: number;
    endPosition: number;
    text: string;
  } | null>(null);

  // Edit toolbar state for existing highlights
  const [showEditToolbar, setShowEditToolbar] = useState(false);
  const [editToolbarPosition, setEditToolbarPosition] = useState<{
    x: number;
    y: number;
    above: boolean;
  }>({
    x: 0,
    y: 0,
    above: true,
  });
  const [editingHighlight, setEditingHighlight] = useState<{
    id: string;
    text: string;
    note?: string;
    color: string;
  } | null>(null);

  // Footnote popover state
  const [footnotePopover, setFootnotePopover] = useState<{
    content: string;
    position: { x: number; y: number };
  } | null>(null);

  // Tap feedback state
  const [tapFeedback, setTapFeedback] = useState<"left" | "right" | null>(null);

  // EPUB publisher CSS injection
  const [contentCss, setContentCss] = useState<string>("");

  // Page transition state
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionDirection, setTransitionDirection] = useState<"left" | "right" | "none">("none");
  const [displayContent, setDisplayContent] = useState(content);
  const [displayRightContent, setDisplayRightContent] = useState(rightContent);
  const prevPositionRef = useRef(content.position);

  // Fetch and scope EPUB publisher CSS when cssUrls change
  useEffect(() => {
    if (!settings.usePublisherStyles || !displayContent.cssUrls?.length) {
      setContentCss("");
      return;
    }

    let cancelled = false;
    Promise.all(
      displayContent.cssUrls.map((url) =>
        fetch(url)
          .then((r) => r.text())
          .catch(() => ""),
      ),
    ).then((sheets) => {
      if (!cancelled) {
        const scoped = sheets.map((css) => scopeEpubCss(css, ".reader-content")).join("\n");
        setContentCss(scoped);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [displayContent.cssUrls, settings.usePublisherStyles]);

  // Page transition effect
  useEffect(() => {
    const prevPos = prevPositionRef.current;
    const newPos = content.position;
    prevPositionRef.current = newPos;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isLargeJump = Math.abs(newPos - prevPos) > 0.05;

    if (isLargeJump || reducedMotion || prevPos === newPos || isJumpNavigation) {
      setDisplayContent(content);
      setDisplayRightContent(rightContent);
      return;
    }

    const direction = newPos > prevPos ? "left" : "right";
    setTransitionDirection(direction);
    setIsTransitioning(true);

    const timer = setTimeout(() => {
      setDisplayContent(content);
      setDisplayRightContent(rightContent);
      setTransitionDirection("none");
      setIsTransitioning(false);
    }, 200);

    return () => clearTimeout(timer);
  }, [content, rightContent, isJumpNavigation]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when typing in input fields
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT"
      ) {
        return;
      }

      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        onNextPage?.();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        onPrevPage?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onPrevPage, onNextPage]);

  // Detect text selection for highlighting
  useEffect(() => {
    const handleSelectionEnd = () => {
      // Small delay to let selection stabilize (especially on iOS)
      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !contentRef.current) {
          return;
        }

        const range = selection.getRangeAt(0);
        if (!contentRef.current.contains(range.commonAncestorContainer)) {
          return;
        }

        const positions = selectionToPositions(
          contentRef.current,
          content.position,
          content.endPosition,
        );

        if (positions) {
          setCurrentSelection(positions);

          const selectionRect = range.getBoundingClientRect();
          const containerRect = containerRef.current?.getBoundingClientRect();
          if (containerRect) {
            setToolbarPosition(calculateToolbarPosition(selectionRect, containerRect));
          }
          setShowToolbar(true);
        }
      }, 50);
    };

    document.addEventListener("mouseup", handleSelectionEnd);
    document.addEventListener("touchend", handleSelectionEnd);

    return () => {
      document.removeEventListener("mouseup", handleSelectionEnd);
      document.removeEventListener("touchend", handleSelectionEnd);
    };
  }, [content.position, content.endPosition]);

  // Detect clicks on existing highlights
  useEffect(() => {
    const handleHighlightClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const highlightMark = target.closest("[data-highlight-id]") as HTMLElement | null;
      if (!highlightMark || !contentRef.current) return;

      const highlightId = highlightMark.getAttribute("data-highlight-id");
      if (!highlightId) return;

      const highlight = highlights?.find((h) => h.id === highlightId);
      if (!highlight) return;

      // Don't show edit toolbar if user is selecting text
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) return;

      e.stopPropagation();

      const markRect = highlightMark.getBoundingClientRect();
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (containerRect) {
        setEditToolbarPosition(calculateToolbarPosition(markRect, containerRect));
      }

      setEditingHighlight({
        id: highlight.id,
        text: highlight.text,
        note: highlight.note,
        color: highlight.color,
      });
      setShowEditToolbar(true);
      setShowToolbar(false);
    };

    const el = contentRef.current;
    if (el) {
      el.addEventListener("click", handleHighlightClick);
      return () => el.removeEventListener("click", handleHighlightClick);
    }
  }, [highlights]);

  // Intercept EPUB link clicks: footnotes and internal navigation
  useEffect(() => {
    const el = contentRef.current;
    if (!el || !bookId) return;

    const handleLinkClick = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest("a") as HTMLAnchorElement | null;
      if (!link) return;

      // Handle footnote references
      if (link.hasAttribute("data-footnote-ref")) {
        e.preventDefault();
        e.stopPropagation();

        const href = link.getAttribute("href");
        if (href) {
          const text = await getFootnoteContent(bookId, href, formatOverride);
          if (text) {
            const rect = link.getBoundingClientRect();
            const containerRect = containerRef.current?.getBoundingClientRect();
            if (containerRect) {
              setFootnotePopover({
                content: text,
                position: {
                  x: Math.min(rect.left - containerRect.left, containerRect.width - 320),
                  y: rect.bottom - containerRect.top + 8,
                },
              });
            }
            return;
          }
        }
      }

      // Handle internal EPUB links (not external, not mailto, not anchors-only)
      const href = link.getAttribute("href");
      if (
        href &&
        !href.startsWith("http://") &&
        !href.startsWith("https://") &&
        !href.startsWith("mailto:")
      ) {
        e.preventDefault();
        e.stopPropagation();

        // Extract the EPUB path from the resource API URL if present
        let epubPath = href;
        if (href.includes("/api/reader/") && href.includes("/resource/")) {
          epubPath = decodeURIComponent(href.split("/resource/")[1] || "");
        }

        if (epubPath && onNavigateToPosition) {
          const result = await resolveInternalLink(bookId, epubPath, formatOverride);
          if (result) {
            onNavigateToPosition(result.position);
          }
        }
      }
    };

    el.addEventListener("click", handleLinkClick);
    return () => el.removeEventListener("click", handleLinkClick);
  }, [bookId, formatOverride, onNavigateToPosition]);

  // Apply saved highlights to DOM after content renders
  useEffect(() => {
    if (!highlights?.length) return;

    requestAnimationFrame(() => {
      if (contentRef.current) {
        applyHighlightsToDOM(
          contentRef.current,
          highlights,
          displayContent.position,
          displayContent.endPosition,
        );
      }
      if (rightContentRef.current && displayRightContent) {
        applyHighlightsToDOM(
          rightContentRef.current,
          highlights,
          displayRightContent.position,
          displayRightContent.endPosition,
        );
      }
    });
  }, [
    displayContent.html,
    displayContent.position,
    displayContent.endPosition,
    displayRightContent?.html,
    displayRightContent?.position,
    displayRightContent?.endPosition,
    highlights,
  ]);

  // Handle tap navigation with 1/3 zones
  const handleContentClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // If user has an active text selection, don't navigate
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) {
        return;
      }

      // Don't navigate if clicking on interactive elements or highlight marks
      const target = e.target as HTMLElement;
      if (target.closest("a, button, input, select, textarea, [data-highlight-id]")) {
        return;
      }

      // Determine navigation direction based on click position (1/3 zones)
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const relativeX = clickX / rect.width;

      if (relativeX < 0.33) {
        setTapFeedback("left");
        setTimeout(() => setTapFeedback(null), 150);
        onPrevPage?.();
      } else if (relativeX > 0.67) {
        setTapFeedback("right");
        setTimeout(() => setTapFeedback(null), 150);
        onNextPage?.();
      } else {
        onCenterTap?.();
      }
    },
    [onPrevPage, onNextPage, onCenterTap],
  );

  // Handle highlight save
  const handleHighlight = useCallback(
    (color: string, note?: string) => {
      if (currentSelection && onAddHighlight) {
        onAddHighlight(
          currentSelection.startPosition,
          currentSelection.endPosition,
          currentSelection.text,
          note,
          color,
        );
      }
      window.getSelection()?.removeAllRanges();
      setShowToolbar(false);
      setCurrentSelection(null);
    },
    [currentSelection, onAddHighlight],
  );

  const showSpread = isSpreadMode && displayRightContent?.html;
  const isFxl = displayContent.isFixedLayout;

  const textStyles = {
    maxWidth: `${settings.maxWidth}px`,
    fontFamily: font.value,
    fontSize: `${settings.fontSize}px`,
    lineHeight: settings.lineHeight,
    textAlign: settings.textAlign,
    padding: `0 ${settings.margins}%`,
    "--tw-prose-body": theme.foreground,
    "--tw-prose-headings": theme.foreground,
    "--tw-prose-lead": theme.foreground,
    "--tw-prose-links": theme.accent,
    "--tw-prose-bold": theme.foreground,
    "--tw-prose-counters": theme.muted,
    "--tw-prose-bullets": theme.muted,
    "--tw-prose-hr": theme.muted,
    "--tw-prose-quotes": theme.foreground,
    "--tw-prose-quote-borders": theme.muted,
    "--tw-prose-captions": theme.muted,
    "--tw-prose-code": theme.foreground,
    "--tw-prose-pre-code": theme.foreground,
    "--tw-prose-pre-bg": theme.background,
    "--tw-prose-th-borders": theme.muted,
    "--tw-prose-td-borders": theme.muted,
    "--reader-selection-color": theme.selection,
  } as React.CSSProperties;

  return (
    <div
      ref={containerRef}
      className="h-full overflow-auto px-4 md:px-8 py-4 md:py-8 relative"
      style={{
        backgroundColor: theme.background,
        color: theme.foreground,
      }}
      onClick={handleContentClick}
    >
      {/* Page transition wrapper — real slide, like turning a page */}
      <div
        className="transition-all duration-300 ease-out"
        style={{
          opacity: isTransitioning ? 0 : 1,
          transform: isTransitioning
            ? `translateX(${transitionDirection === "left" ? "-100%" : "100%"})`
            : "translateX(0)",
        }}
      >
        {isFxl ? (
          // Fixed layout EPUB: render as full-page viewport content
          <div className="h-full flex items-center justify-center">
            <div
              ref={contentRef}
              className="reader-content fxl-page"
              style={{
                width: "100%",
                height: "100%",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              // biome-ignore lint/security/noDangerouslySetInnerHtml: Content is sanitized server-side
              dangerouslySetInnerHTML={{ __html: displayContent.html || "" }}
            />
          </div>
        ) : showSpread ? (
          // Two-column spread layout
          <div
            className="mx-auto flex gap-8"
            style={{ maxWidth: `${settings.maxWidth * 2 + 64}px` }}
          >
            <div
              ref={contentRef}
              className="flex-1 prose max-w-none reader-content"
              style={textStyles}
              // biome-ignore lint/security/noDangerouslySetInnerHtml: Content is sanitized server-side
              dangerouslySetInnerHTML={{ __html: displayContent.html || "" }}
            />
            <div
              className="w-px self-stretch"
              style={{ backgroundColor: `${theme.foreground}15` }}
            />
            <div
              ref={rightContentRef}
              className="flex-1 prose max-w-none reader-content"
              style={textStyles}
              // biome-ignore lint/security/noDangerouslySetInnerHtml: Content is sanitized server-side
              dangerouslySetInnerHTML={{ __html: displayRightContent?.html || "" }}
            />
          </div>
        ) : (
          // Single column layout
          <div
            ref={contentRef}
            className="mx-auto prose max-w-none reader-content"
            style={textStyles}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: Content is sanitized server-side
            dangerouslySetInnerHTML={{ __html: displayContent.html || "" }}
          />
        )}
        {/* Injected EPUB publisher CSS (scoped under .reader-content) */}
        {contentCss && (
          // biome-ignore lint/security/noDangerouslySetInnerHtml: CSS is scoped and sanitized
          <style dangerouslySetInnerHTML={{ __html: contentCss }} />
        )}
        {/* FXL page scaling */}
        {isFxl && (
          <style>{`
            .fxl-page > * {
              max-width: 100%;
              max-height: 100%;
              margin: 0 auto;
            }
            .fxl-page img, .fxl-page svg {
              max-width: 100%;
              max-height: 100vh;
              object-fit: contain;
            }
          `}</style>
        )}
      </div>

      {/* Tap feedback overlays */}
      {tapFeedback && (
        <div
          className="absolute inset-y-0 pointer-events-none flex items-center justify-center"
          style={{
            left: tapFeedback === "left" ? 0 : undefined,
            right: tapFeedback === "right" ? 0 : undefined,
            width: "33%",
            backgroundColor: `${theme.foreground}06`,
            animation: "tapFlash 150ms ease-out forwards",
          }}
        >
          <svg
            className="w-8 h-8"
            fill="none"
            stroke={`${theme.foreground}30`}
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            {tapFeedback === "left" ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            )}
          </svg>
        </div>
      )}

      {/* Floating highlight toolbar (new selection) */}
      {showToolbar && currentSelection && (
        <HighlightToolbar
          position={toolbarPosition}
          selectedText={currentSelection.text}
          onHighlight={handleHighlight}
          onDismiss={() => {
            setShowToolbar(false);
            window.getSelection()?.removeAllRanges();
          }}
          onSearchInBook={onSearchInBook}
          theme={theme}
        />
      )}

      {/* Edit toolbar (existing highlight) */}
      {showEditToolbar && editingHighlight && (
        <HighlightEditToolbar
          position={editToolbarPosition}
          highlight={editingHighlight}
          onChangeColor={(highlightId, color) => {
            onUpdateHighlightColor?.(highlightId, color);
            setEditingHighlight((prev) => (prev ? { ...prev, color } : null));
          }}
          onSaveNote={(highlightId, note) => {
            onUpdateHighlightNote?.(highlightId, note);
            setEditingHighlight((prev) => (prev ? { ...prev, note: note ?? undefined } : null));
          }}
          onCopy={(text) => {
            if (navigator.clipboard?.writeText) {
              navigator.clipboard.writeText(text);
            } else {
              const ta = document.createElement("textarea");
              ta.value = text;
              ta.style.position = "fixed";
              ta.style.opacity = "0";
              document.body.appendChild(ta);
              ta.select();
              document.execCommand("copy");
              document.body.removeChild(ta);
            }
          }}
          onDelete={(highlightId) => {
            onRemoveHighlight?.(highlightId);
          }}
          onDismiss={() => {
            setShowEditToolbar(false);
            setEditingHighlight(null);
          }}
          onSearchInBook={onSearchInBook}
          theme={theme}
        />
      )}

      {/* Footnote popover */}
      {footnotePopover && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setFootnotePopover(null)} />
          <div
            className="absolute z-50 max-w-xs p-4 rounded-lg shadow-xl border"
            style={{
              left: Math.max(8, footnotePopover.position.x),
              top: footnotePopover.position.y,
              backgroundColor: theme.background,
              borderColor: `${theme.foreground}20`,
              color: theme.foreground,
              maxHeight: "200px",
              overflowY: "auto",
            }}
          >
            <p className="text-sm leading-relaxed">{footnotePopover.content}</p>
          </div>
        </>
      )}

      {/* Tap flash animation */}
      <style>{`
        @keyframes tapFlash {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

/**
 * Loading placeholder for images
 */
function ImageLoadingPlaceholder() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-muted-foreground/20 border-t-muted-foreground rounded-full animate-spin" />
        <span className="text-sm text-muted-foreground animate-pulse">Loading...</span>
      </div>
    </div>
  );
}

/**
 * Image content renderer (PDF pages, Comics)
 * Supports single page and two-page spread modes with tap zones and transitions.
 */
function ImageContent({
  content,
  rightContent,
  settings,
  isSpreadMode,
  isJumpNavigation,
  onPrevPage,
  onNextPage,
  onCenterTap,
}: {
  content: PageContent;
  rightContent?: PageContent | null;
  settings: ReaderSettings;
  isSpreadMode?: boolean;
  isJumpNavigation?: boolean;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  onCenterTap?: () => void;
}) {
  const theme = THEMES[settings.theme];
  const showSpread = isSpreadMode && rightContent?.imageUrl;

  // Refs to check if images are already cached
  const leftImgRef = useRef<HTMLImageElement>(null);
  const rightImgRef = useRef<HTMLImageElement>(null);

  // Track loading state for images
  const [leftLoaded, setLeftLoaded] = useState(false);
  const [rightLoaded, setRightLoaded] = useState(false);

  // Tap feedback
  const [tapFeedback, setTapFeedback] = useState<"left" | "right" | null>(null);

  // Page transition state
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionDirection, setTransitionDirection] = useState<"left" | "right" | "none">("none");
  const prevPositionRef = useRef(content.position);

  // Page transition effect
  useEffect(() => {
    const prevPos = prevPositionRef.current;
    const newPos = content.position;
    prevPositionRef.current = newPos;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isLargeJump = Math.abs(newPos - prevPos) > 0.05;

    if (isLargeJump || reducedMotion || prevPos === newPos || isJumpNavigation) {
      return;
    }

    const direction = newPos > prevPos ? "left" : "right";
    setTransitionDirection(direction);
    setIsTransitioning(true);

    const timer = setTimeout(() => {
      setTransitionDirection("none");
      setIsTransitioning(false);
    }, 200);

    return () => clearTimeout(timer);
  }, [content.position, isJumpNavigation]);

  // Reset loading state when content changes, but check for cached images
  useEffect(() => {
    setLeftLoaded(false);
    setRightLoaded(false);

    // Check if images are already cached (complete) after a microtask
    // This handles the case where onLoad fires before the handler is attached
    queueMicrotask(() => {
      if (leftImgRef.current?.complete && leftImgRef.current?.naturalHeight > 0) {
        setLeftLoaded(true);
      }
      if (rightImgRef.current?.complete && rightImgRef.current?.naturalHeight > 0) {
        setRightLoaded(true);
      }
    });
  }, [content.imageUrl, rightContent?.imageUrl]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when typing in input fields
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT"
      ) {
        return;
      }

      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        onNextPage?.();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        onPrevPage?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onPrevPage, onNextPage]);

  // Handle click navigation with 1/3 zones
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const relativeX = clickX / rect.width;

    if (relativeX < 0.33) {
      setTapFeedback("left");
      setTimeout(() => setTapFeedback(null), 150);
      if (settings.comicRtl) {
        onNextPage?.();
      } else {
        onPrevPage?.();
      }
    } else if (relativeX > 0.67) {
      setTapFeedback("right");
      setTimeout(() => setTapFeedback(null), 150);
      if (settings.comicRtl) {
        onPrevPage?.();
      } else {
        onNextPage?.();
      }
    } else {
      onCenterTap?.();
    }
  };

  // Common image styles for spread view — must fit within half the container
  const imageStyle = {
    objectFit: "contain" as const,
    maxWidth: "100%",
    maxHeight: "100%",
    width: "auto" as const,
    height: "auto" as const,
  };

  return (
    <div
      className="h-full overflow-hidden cursor-pointer relative"
      style={{ backgroundColor: theme.background }}
      onClick={handleClick}
    >
      {/* Page transition wrapper */}
      <div
        className="h-full w-full flex items-center justify-center transition-all duration-200 ease-in-out"
        style={{
          opacity: isTransitioning ? 0 : 1,
          transform: isTransitioning
            ? `translateX(${transitionDirection === "left" ? "-20px" : "20px"})`
            : "translateX(0)",
        }}
      >
        {showSpread ? (
          // Two-page spread view
          <div className="h-full w-full flex items-center justify-center gap-1">
            {content.imageUrl && (
              <div className="relative flex-1 h-full flex items-center justify-center overflow-hidden">
                {!leftLoaded && <ImageLoadingPlaceholder />}
                <img
                  ref={leftImgRef}
                  src={content.imageUrl}
                  alt={content.chapterTitle || "Left Page"}
                  style={{
                    ...imageStyle,
                    opacity: leftLoaded ? 1 : 0,
                    transition: "opacity 0.2s ease-in-out",
                  }}
                  onLoad={() => setLeftLoaded(true)}
                />
              </div>
            )}
            {rightContent?.imageUrl && (
              <div className="relative flex-1 h-full flex items-center justify-center overflow-hidden">
                {!rightLoaded && <ImageLoadingPlaceholder />}
                <img
                  ref={rightImgRef}
                  src={rightContent.imageUrl}
                  alt={rightContent.chapterTitle || "Right Page"}
                  style={{
                    ...imageStyle,
                    opacity: rightLoaded ? 1 : 0,
                    transition: "opacity 0.2s ease-in-out",
                  }}
                  onLoad={() => setRightLoaded(true)}
                />
              </div>
            )}
          </div>
        ) : (
          // Single page view
          content.imageUrl && (
            <div className="relative h-full w-full flex items-center justify-center overflow-hidden">
              {!leftLoaded && <ImageLoadingPlaceholder />}
              <img
                ref={leftImgRef}
                src={content.imageUrl}
                alt={content.chapterTitle || "Page"}
                style={{
                  objectFit: "contain",
                  maxWidth: "100%",
                  maxHeight: "100%",
                  width: settings.comicFitMode === "width" ? "100%" : "auto",
                  height: settings.comicFitMode === "height" ? "100%" : "auto",
                  opacity: leftLoaded ? 1 : 0,
                  transition: "opacity 0.2s ease-in-out",
                }}
                onLoad={() => setLeftLoaded(true)}
              />
            </div>
          )
        )}
      </div>

      {/* Tap feedback overlays */}
      {tapFeedback && (
        <div
          className="absolute inset-y-0 pointer-events-none flex items-center justify-center"
          style={{
            left: tapFeedback === "left" ? 0 : undefined,
            right: tapFeedback === "right" ? 0 : undefined,
            width: "33%",
            backgroundColor: `${theme.foreground}06`,
            animation: "tapFlash 150ms ease-out forwards",
          }}
        >
          <svg
            className="w-8 h-8"
            fill="none"
            stroke={`${theme.foreground}30`}
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            {tapFeedback === "left" ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            )}
          </svg>
        </div>
      )}

      <style>{`
        @keyframes tapFlash {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
