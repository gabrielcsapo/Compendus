"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { HighlightToolbar, HighlightEditToolbar } from "./HighlightToolbar";
import type { ReaderHighlight } from "@/lib/reader/types";

export interface PdfReaderViewHandle {
  goToPage: (page: number) => void;
}

interface PdfReaderViewProps {
  bookId: string;
  initialPage?: number;
  onPageChange: (page: number, total: number) => void;
  onCenterTap: () => void;
  className?: string;
  highlights?: ReaderHighlight[];
  onAddHighlight?: (
    startPosition: number,
    endPosition: number,
    text: string,
    note?: string,
    color?: string,
  ) => Promise<void>;
  onRemoveHighlight?: (highlightId: string) => Promise<void>;
  onUpdateHighlightColor?: (highlightId: string, color: string) => Promise<void>;
  onUpdateHighlightNote?: (highlightId: string, note: string | null) => Promise<void>;
  theme: {
    background: string;
    foreground: string;
    muted: string;
    accent: string;
  };
}

/**
 * After the text layer renders, apply background colors to spans that match saved highlights.
 * Uses normalized text matching across concatenated span content.
 */
function applyHighlightsToTextLayer(
  textLayer: HTMLDivElement,
  pageHighlights: Array<{ id: string; text: string; color: string }>,
) {
  const spans = Array.from(textLayer.querySelectorAll<HTMLElement>("span:not(.markedContent)"));
  console.log("[PDF highlights] applyHighlightsToTextLayer", {
    spanCount: spans.length,
    highlights: pageHighlights.map((h) => ({ text: h.text.slice(0, 60), color: h.color })),
  });
  if (spans.length === 0 || pageHighlights.length === 0) return;

  // Build a concatenated string from all spans (no spaces added between spans —
  // that's intentional; we use a flex-whitespace regex below to compensate for
  // inter-span gaps that browser selection adds but span concatenation drops).
  let fullText = "";
  const spanMap: Array<{ span: HTMLElement; start: number; end: number }> = [];
  for (const span of spans) {
    const text = span.textContent ?? "";
    spanMap.push({ span, start: fullText.length, end: fullText.length + text.length });
    fullText += text;
  }
  const lowerFull = fullText.toLowerCase();
  console.log("[PDF highlights] page text (first 300 chars):", lowerFull.slice(0, 300));

  for (const { id, text, color } of pageHighlights) {
    // Build a regex that treats each whitespace run in the search text as \s*
    // so it matches even when adjacent PDF spans have no space between them.
    const escaped = text.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = escaped.replace(/\s+/g, "\\s*");
    let match: RegExpExecArray | null = null;
    try {
      match = new RegExp(pattern, "i").exec(fullText);
    } catch {
      continue;
    }
    console.log(
      "[PDF highlights] searching for:",
      JSON.stringify(text.slice(0, 60)),
      "→ match:",
      match ? `idx=${match.index} len=${match[0].length}` : "null",
    );
    if (!match) continue;

    const idx = match.index;
    const endIdx = idx + match[0].length;
    const bgColor = /^#[0-9a-f]{6}$/i.test(color) ? color + "80" : color;

    let matchedSpans = 0;
    for (const { span, start, end } of spanMap) {
      if (end > idx && start < endIdx) {
        span.style.backgroundColor = bgColor;
        span.style.borderRadius = "2px";
        span.dataset.highlightId = id;
        matchedSpans++;
      }
    }
    console.log("[PDF highlights] matched", matchedSpans, "spans");
  }
}

// Inject PDF.js text layer CSS once.
// Mirrors the official pdf_viewer.css rules; the critical addition is
// `span.markedContent { height: 0 }` which prevents PDF structural-marker
// spans from being included in text selections and causing ghost highlights.
let textLayerCssInjected = false;
function injectTextLayerCss() {
  if (textLayerCssInjected || typeof document === "undefined") return;
  textLayerCssInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .pdf-text-layer {
      position: absolute;
      inset: 0;
      overflow: hidden;
      line-height: 1;
      text-size-adjust: none;
      forced-color-adjust: none;
      transform-origin: 0 0;
      user-select: text;
      -webkit-user-select: text;
    }
    .pdf-text-layer :is(span, br) {
      color: transparent;
      position: absolute;
      white-space: pre;
      cursor: text;
      transform-origin: 0% 0%;
    }
    /* Keep selected text transparent — only show the background tint.
       Without this, browsers reveal the raw span text at its actual font size
       which doesn't match the canvas-rendered scale. */
    .pdf-text-layer :is(span, br)::selection {
      background: rgba(0, 100, 255, 0.25);
      color: transparent;
    }
    /* Zero out PDF marked-content structural markers so they can't be selected */
    .pdf-text-layer span.markedContent {
      top: 0;
      height: 0;
    }
  `;
  document.head.appendChild(style);
}

export const PdfReaderView = forwardRef<PdfReaderViewHandle, PdfReaderViewProps>(
  function PdfReaderView(
    {
      bookId,
      initialPage = 1,
      onPageChange,
      onCenterTap,
      className = "",
      highlights = [],
      onAddHighlight,
      onRemoveHighlight,
      onUpdateHighlightColor,
      onUpdateHighlightNote,
      theme,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const textLayerRef = useRef<HTMLDivElement>(null);

    // PDF.js lib + document instances
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfjsRef = useRef<any>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfDocRef = useRef<any>(null);
    const currentPageRef = useRef(initialPage);
    const [totalPages, setTotalPages] = useState(0);
    const [pdfLoaded, setPdfLoaded] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
    const isRenderingRef = useRef(false);
    const pendingPageRef = useRef<number | null>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const navigateToPageRef = useRef<(page: number) => void>(() => {});

    // Keep highlights in a ref so renderPage can read the latest value without being recreated
    const highlightsRef = useRef(highlights);
    useEffect(() => {
      highlightsRef.current = highlights;
    }, [highlights]);
    const totalPagesRef = useRef(totalPages);
    useEffect(() => {
      totalPagesRef.current = totalPages;
    }, [totalPages]);

    // New-highlight toolbar state
    const [showToolbar, setShowToolbar] = useState(false);
    const [toolbarPosition, setToolbarPosition] = useState<{
      x: number;
      y: number;
      above: boolean;
    }>({ x: 0, y: 0, above: true });
    const [currentSelection, setCurrentSelection] = useState<{
      text: string;
      pagePosition: number;
    } | null>(null);

    // Edit-highlight toolbar state (clicking an existing highlight)
    const [showEditToolbar, setShowEditToolbar] = useState(false);
    const [editToolbarPosition, setEditToolbarPosition] = useState<{
      x: number;
      y: number;
      above: boolean;
    }>({ x: 0, y: 0, above: true });
    const [editHighlight, setEditHighlight] = useState<ReaderHighlight | null>(null);

    // Expose goToPage imperatively via stable ref
    useImperativeHandle(ref, () => ({
      goToPage: (page: number) => {
        navigateToPageRef.current(page);
      },
    }));

    // Load PDF.js and the document
    useEffect(() => {
      let cancelled = false;

      const load = async () => {
        try {
          injectTextLayerCss();

          // Dynamic import — keeps PDF.js out of the main bundle
          const pdfjsLib = await import("pdfjs-dist");
          pdfjsRef.current = pdfjsLib;

          // Set up worker — use minified build to avoid source-map 404 noise in dev
          if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
              "pdfjs-dist/build/pdf.worker.min.mjs",
              import.meta.url,
            ).href;
          }

          const pdfUrl = `/api/reader/${bookId}/pdf-stream`;
          const loadingTask = pdfjsLib.getDocument(pdfUrl);
          const doc = await loadingTask.promise;

          if (cancelled) {
            doc.destroy();
            return;
          }

          pdfDocRef.current = doc;
          const total = doc.numPages;
          setTotalPages(total);
          setPdfLoaded(true);

          const startPage = Math.min(Math.max(1, currentPageRef.current), total);
          await renderPage(startPage, doc);
          onPageChange(startPage, total);
        } catch (err) {
          if (!cancelled) {
            console.error("PDF load error:", err);
            setLoadError("Failed to load PDF");
          }
        }
      };

      load();

      return () => {
        cancelled = true;
        if (pdfDocRef.current) {
          pdfDocRef.current.destroy();
          pdfDocRef.current = null;
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bookId]);

    // Re-render on resize
    useEffect(() => {
      if (!pdfLoaded) return;
      const container = containerRef.current;
      if (!container) return;

      const ro = new ResizeObserver(() => {
        if (pdfDocRef.current) {
          renderPage(currentPageRef.current, pdfDocRef.current);
        }
      });
      ro.observe(container);
      return () => ro.disconnect();
    }, [pdfLoaded]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const renderPage = useCallback(async (pageNum: number, doc?: any) => {
      const pdfDoc = doc ?? pdfDocRef.current;
      if (!pdfDoc) return;

      const canvas = canvasRef.current;
      const textLayer = textLayerRef.current;
      const container = containerRef.current;
      if (!canvas || !textLayer || !container) return;

      // If already rendering, queue up this page for after
      if (isRenderingRef.current) {
        pendingPageRef.current = pageNum;
        return;
      }

      isRenderingRef.current = true;

      try {
        // Cancel any in-progress render
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
          renderTaskRef.current = null;
        }

        const page = await pdfDoc.getPage(pageNum);
        const containerRect = container.getBoundingClientRect();
        const containerWidth = containerRect.width || container.clientWidth;
        const containerHeight = containerRect.height || container.clientHeight;

        if (containerWidth === 0) return;

        const unscaledViewport = page.getViewport({ scale: 1 });
        const scaleW = containerWidth / unscaledViewport.width;
        const scaleH = containerHeight / unscaledViewport.height;
        const scale = Math.min(scaleW, scaleH);
        const dpr = window.devicePixelRatio || 1;

        const viewport = page.getViewport({ scale });

        // Size canvas for DPR sharpness
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const renderTask = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = renderTask;

        // Clear old text layer
        textLayer.style.width = `${viewport.width}px`;
        textLayer.style.height = `${viewport.height}px`;
        textLayer.replaceChildren();

        await renderTask.promise;
        renderTaskRef.current = null;

        // Render text layer for selection (PDF.js 5.x TextLayer class API)
        if (pdfjsRef.current?.TextLayer) {
          const textStream = page.streamTextContent();
          const textLayerInstance = new pdfjsRef.current.TextLayer({
            textContentSource: textStream,
            container: textLayer,
            viewport,
          });
          await textLayerInstance.render();
        }

        // Apply saved highlights for this page
        const total = totalPagesRef.current;
        const pagePos = (pageNum - 1) / Math.max(1, total - 1);
        const tolerance = total > 1 ? 1.5 / (total - 1) : 0.1;
        console.log("[PDF highlights] renderPage highlights check:", {
          pageNum,
          total,
          pagePos,
          tolerance,
          allHighlights: highlightsRef.current.map((h) => ({
            startPosition: h.startPosition,
            text: h.text.slice(0, 30),
          })),
        });
        const pageHighlights = highlightsRef.current
          .filter((h) => Math.abs(h.startPosition - pagePos) <= tolerance)
          .map((h) => ({ id: h.id, text: h.text, color: h.color }));
        if (pageHighlights.length > 0) {
          applyHighlightsToTextLayer(textLayer, pageHighlights);
        }
      } catch (err: unknown) {
        // Cancelled renders are expected — ignore them
        if (
          err &&
          typeof err === "object" &&
          "name" in err &&
          err.name === "RenderingCancelledException"
        ) {
          return;
        }
        console.error("PDF render error:", err);
      } finally {
        isRenderingRef.current = false;

        // If a page was requested while we were rendering, do it now
        const pending = pendingPageRef.current;
        if (pending !== null) {
          pendingPageRef.current = null;
          renderPage(pending);
        }
      }
    }, []);

    const navigateToPage = useCallback(
      (page: number) => {
        if (!pdfDocRef.current) return;
        const clamped = Math.max(1, Math.min(page, totalPages));
        if (clamped === currentPageRef.current) return;
        currentPageRef.current = clamped;
        renderPage(clamped);
        onPageChange(clamped, totalPages);
      },
      [totalPages, renderPage, onPageChange],
    );

    // Keep navigateToPageRef up to date so useImperativeHandle can use it
    navigateToPageRef.current = navigateToPage;

    // When highlights change and the PDF is already loaded, re-render the current page
    // so applyHighlightsToTextLayer runs after the text layer is freshly populated.
    // renderPage is intentionally omitted from deps — it has [] deps so it is always stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
      if (!pdfLoaded || highlights.length === 0) return;
      const total = totalPagesRef.current;
      const pageNum = currentPageRef.current;
      const pagePos = (pageNum - 1) / Math.max(1, total - 1);
      const tolerance = total > 1 ? 1.5 / (total - 1) : 0.1;
      const hasHighlightOnPage = highlights.some(
        (h) => Math.abs(h.startPosition - pagePos) <= tolerance,
      );
      console.log("[PDF highlights] useEffect highlights changed:", {
        highlightCount: highlights.length,
        pageNum,
        total,
        pagePos,
        tolerance,
        hasHighlightOnPage,
      });
      if (hasHighlightOnPage) {
        renderPage(pageNum);
      }
    }, [highlights, pdfLoaded]);

    // Tap detection — distinguish tap from text-selection drag
    const pointerDownRef = useRef<{ x: number; y: number; t: number } | null>(null);

    const handlePointerDown = useCallback((e: React.PointerEvent) => {
      // Don't start tap detection if the click is on an interactive element (e.g. toolbar buttons)
      if ((e.target as HTMLElement).closest('button, [role="button"], a, input')) return;
      pointerDownRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    }, []);

    const handlePointerUp = useCallback(
      (e: React.PointerEvent) => {
        const down = pointerDownRef.current;
        pointerDownRef.current = null;
        if (!down) return;

        const dx = Math.abs(e.clientX - down.x);
        const dy = Math.abs(e.clientY - down.y);
        const dt = Date.now() - down.t;

        // Not a tap if moved too much or held too long
        if (dx > 10 || dy > 10 || dt > 500) return;

        // Check if tapping on an existing highlighted span
        const target = e.target as HTMLElement;
        const highlightSpan = target.closest("[data-highlight-id]") as HTMLElement | null;
        if (highlightSpan?.dataset.highlightId) {
          const hId = highlightSpan.dataset.highlightId;
          const found = highlightsRef.current.find((h) => h.id === hId);
          if (found) {
            const container = containerRef.current;
            const containerRect = container?.getBoundingClientRect();
            if (containerRect) {
              const TOOLBAR_WIDTH = 300;
              const GAP = 8;
              let x = e.clientX - TOOLBAR_WIDTH / 2;
              x = Math.max(
                containerRect.left + GAP,
                Math.min(x, containerRect.right - TOOLBAR_WIDTH - GAP),
              );
              let y = e.clientY - 52 - GAP;
              const above = y >= containerRect.top + GAP;
              if (!above) y = e.clientY + GAP;
              setEditHighlight(found);
              setEditToolbarPosition({ x, y, above });
              setShowEditToolbar(true);
            }
            return;
          }
        }

        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const xRatio = (e.clientX - rect.left) / rect.width;

        if (xRatio < 0.25) {
          navigateToPage(currentPageRef.current - 1);
        } else if (xRatio > 0.75) {
          navigateToPage(currentPageRef.current + 1);
        } else {
          onCenterTap();
        }
      },
      [navigateToPage, onCenterTap],
    );

    // Keyboard navigation
    useEffect(() => {
      const handleKey = (e: KeyboardEvent) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          navigateToPage(currentPageRef.current + 1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          navigateToPage(currentPageRef.current - 1);
        }
      };
      window.addEventListener("keydown", handleKey);
      return () => window.removeEventListener("keydown", handleKey);
    }, [navigateToPage]);

    // Track the last pointer-up position for toolbar placement.
    // PDF.js text-layer spans use CSS transforms so range.getBoundingClientRect()
    // often returns garbage — using raw mouse/touch coordinates is far more reliable.
    const lastPointerUpPos = useRef<{ x: number; y: number } | null>(null);

    // Text selection in the PDF text layer → show highlight toolbar
    useEffect(() => {
      if (!onAddHighlight) return;

      const handlePointerUpCapture = (e: MouseEvent | TouchEvent) => {
        if ("changedTouches" in e) {
          const t = e.changedTouches[0];
          lastPointerUpPos.current = { x: t.clientX, y: t.clientY };
        } else {
          lastPointerUpPos.current = { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY };
        }
      };

      const handleSelectionEnd = () => {
        setTimeout(() => {
          const textLayer = textLayerRef.current;
          if (!textLayer) return;
          const selection = window.getSelection();
          if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
          const range = selection.getRangeAt(0);
          const text = selection.toString().trim();
          if (!text || !textLayer.contains(range.commonAncestorContainer)) return;

          // Use page-based position (PDF doesn't have character-level positions across pages)
          const total = totalPages || 1;
          const pagePos = (currentPageRef.current - 1) / Math.max(1, total - 1);
          setCurrentSelection({ text, pagePosition: pagePos });

          // Use actual pointer coordinates — more reliable than range rects for PDF text layers
          const pos = lastPointerUpPos.current;
          const containerRect = containerRef.current?.getBoundingClientRect();
          if (pos && containerRect) {
            const TOOLBAR_WIDTH = 210;
            const TOOLBAR_HEIGHT = 44;
            const GAP = 8;
            let x = pos.x - TOOLBAR_WIDTH / 2;
            x = Math.max(
              containerRect.left + GAP,
              Math.min(x, containerRect.right - TOOLBAR_WIDTH - GAP),
            );
            let y = pos.y - TOOLBAR_HEIGHT - GAP;
            const above = y >= containerRect.top + GAP;
            if (!above) y = pos.y + GAP;
            setToolbarPosition({ x, y, above });
          }
          setShowToolbar(true);
        }, 50);
      };

      document.addEventListener("mouseup", handlePointerUpCapture, true);
      document.addEventListener("touchend", handlePointerUpCapture, true);
      document.addEventListener("mouseup", handleSelectionEnd);
      document.addEventListener("touchend", handleSelectionEnd);
      return () => {
        document.removeEventListener("mouseup", handlePointerUpCapture, true);
        document.removeEventListener("touchend", handlePointerUpCapture, true);
        document.removeEventListener("mouseup", handleSelectionEnd);
        document.removeEventListener("touchend", handleSelectionEnd);
      };
    }, [onAddHighlight, totalPages]);

    // Note: PDF.js text-layer spans use CSS transforms for exact positioning, making it
    // impossible to reliably wrap individual character ranges like EPUB highlights do.
    // Existing PDF highlights are accessible via the sidebar; per-span visual rendering
    // is not implemented and the full-page overlay approach caused a ghost artifact.

    const handleHighlight = useCallback(
      async (color: string, note?: string) => {
        if (!currentSelection || !onAddHighlight) return;
        const { text, pagePosition } = currentSelection;
        // Use a small epsilon so the highlight covers the page
        const epsilon = totalPages > 1 ? 1 / Math.max(1, totalPages - 1) : 0.01;
        await onAddHighlight(pagePosition, pagePosition + epsilon, text, note, color);
        window.getSelection()?.removeAllRanges();
        setShowToolbar(false);
        setCurrentSelection(null);
      },
      [currentSelection, onAddHighlight, totalPages],
    );

    if (loadError) {
      return (
        <div className={`flex items-center justify-center h-full text-red-500 ${className}`}>
          {loadError}
        </div>
      );
    }

    if (!pdfLoaded) {
      return (
        <div className={`flex items-center justify-center h-full ${className}`}>
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-current" />
        </div>
      );
    }

    return (
      <div
        ref={containerRef}
        className={`relative flex items-center justify-center h-full w-full select-none ${className}`}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        {/* Canvas layer */}
        <div className="relative shadow-lg">
          <canvas ref={canvasRef} className="block" />
          {/* Text layer overlay for selection */}
          <div ref={textLayerRef} className="pdf-text-layer" />
        </div>

        {/* New highlight toolbar */}
        {showToolbar && currentSelection && (
          <HighlightToolbar
            position={toolbarPosition}
            selectedText={currentSelection.text}
            onHighlight={handleHighlight}
            onDismiss={() => {
              setShowToolbar(false);
              setCurrentSelection(null);
            }}
            theme={theme}
          />
        )}

        {/* Edit existing highlight toolbar */}
        {showEditToolbar && editHighlight && (
          <HighlightEditToolbar
            position={editToolbarPosition}
            highlight={editHighlight}
            onChangeColor={async (id, color) => {
              await onUpdateHighlightColor?.(id, color);
              setEditHighlight((prev) => (prev ? { ...prev, color } : null));
              renderPage(currentPageRef.current);
            }}
            onSaveNote={async (id, note) => {
              await onUpdateHighlightNote?.(id, note);
            }}
            onCopy={(text) => {
              navigator.clipboard?.writeText(text).catch(() => {});
            }}
            onDelete={async (id) => {
              await onRemoveHighlight?.(id);
              setShowEditToolbar(false);
              setEditHighlight(null);
              renderPage(currentPageRef.current);
            }}
            onDismiss={() => {
              setShowEditToolbar(false);
              setEditHighlight(null);
            }}
            theme={theme}
          />
        )}
      </div>
    );
  },
);
