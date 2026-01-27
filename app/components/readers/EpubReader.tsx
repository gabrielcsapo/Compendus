"use client";

import { useState, useCallback, useRef, useEffect } from "react";

interface EpubReaderProps {
  bookPath: string;
  position?: string;
  onPositionChange: (position: string, progress: number) => void;
}

interface TocItem {
  label: string;
  href: string;
  id?: string;
}

export function EpubReader({ bookPath, position, onPositionChange }: EpubReaderProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [showToc, setShowToc] = useState(false);
  const [currentSection, setCurrentSection] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<any>(null);

  useEffect(() => {
    let destroyed = false;

    async function loadBook() {
      if (!containerRef.current) return;

      try {
        setLoading(true);
        setError(null);

        // Fetch the epub file
        const url = `${window.location.origin}${bookPath}`;
        console.log("Fetching epub from:", url);

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.status}`);
        }

        const blob = await response.blob();
        const file = new File([blob], "book.epub", {
          type: "application/epub+zip",
        });
        console.log("Loaded epub file, size:", file.size);

        if (destroyed) return;

        // Import foliate-js
        const { makeBook } = await import("foliate-js/view.js");
        const book = await makeBook(file);
        bookRef.current = book;

        console.log("Book created:", book);

        // Get TOC
        const tocData = book.toc || [];
        setToc(
          tocData.map((item: any, i: number) => ({
            label: item.label || `Section ${i + 1}`,
            href: item.href || String(i),
            id: item.id,
          })),
        );

        // Get sections
        const sections = book.sections || [];
        console.log("Sections:", sections.length);

        if (destroyed) return;

        // Load first section or saved position
        let startIndex = 0;
        if (position) {
          try {
            const pos = JSON.parse(position);
            startIndex = pos.section || 0;
          } catch {
            // Ignore invalid position
          }
        }

        await loadSection(book, startIndex);
        setCurrentSection(startIndex);
        setLoading(false);
      } catch (err) {
        console.error("Error loading epub:", err);
        if (!destroyed) {
          setError(err instanceof Error ? err.message : "Failed to load book");
          setLoading(false);
        }
      }
    }

    async function loadSection(book: any, index: number) {
      if (!containerRef.current || !book) return;

      const sections = book.sections || [];
      if (index < 0 || index >= sections.length) return;

      const section = sections[index];
      console.log("Loading section:", index, section);

      try {
        // Load section content
        const doc = await section.createDocument();

        // Get the HTML content
        const content = doc.body?.innerHTML || doc.documentElement?.innerHTML || "";

        // Render to container using an iframe for proper isolation
        const iframe = document.createElement("iframe");
        iframe.style.width = "100%";
        iframe.style.height = "100%";
        iframe.style.border = "none";

        containerRef.current.innerHTML = "";
        containerRef.current.appendChild(iframe);

        // Check if dark mode is enabled
        const isDarkMode = document.documentElement.classList.contains("dark");
        const textColor = isDarkMode ? "#f1f5f9" : "#0f172a";
        const bgColor = isDarkMode ? "#1a2332" : "#ffffff";

        // Extract book ID from bookPath (e.g., /books/{id}.epub -> {id})
        const bookIdMatch = bookPath.match(/\/books\/([a-f0-9-]+)\./);
        const bookId = bookIdMatch ? bookIdMatch[1] : "";
        const baseUrl = bookId ? `${window.location.origin}/book/${bookId}/` : "";

        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc) {
          iframeDoc.open();
          iframeDoc.write(`
            <!DOCTYPE html>
            <html>
              <head>
                ${baseUrl ? `<base href="${baseUrl}">` : ""}
                <style>
                  body {
                    font-family: Georgia, serif;
                    line-height: 1.8;
                    padding: 40px;
                    max-width: 800px;
                    margin: 0 auto;
                    color: ${textColor};
                    background-color: ${bgColor};
                  }
                  img { max-width: 100%; height: auto; }
                  p { margin-bottom: 1em; }
                </style>
              </head>
              <body>${content}</body>
            </html>
          `);
          iframeDoc.close();
        }

        // Update progress
        const progress = (index + 1) / sections.length;
        onPositionChange(JSON.stringify({ section: index }), progress);
      } catch (err) {
        console.error("Error loading section:", err);
      }
    }

    loadBook();

    return () => {
      destroyed = true;
    };
  }, [bookPath, position, onPositionChange]);

  const goToSection = useCallback(
    async (index: number) => {
      if (!bookRef.current) return;
      const sections = bookRef.current.sections || [];
      if (index < 0 || index >= sections.length) return;

      setLoading(true);
      const section = sections[index];

      try {
        const doc = await section.createDocument();
        const content = doc.body?.innerHTML || doc.documentElement?.innerHTML || "";

        const iframe = containerRef.current?.querySelector("iframe");
        const iframeDoc = iframe?.contentDocument || iframe?.contentWindow?.document;
        if (iframeDoc) {
          iframeDoc.body.innerHTML = content;
          iframeDoc.body.scrollTop = 0;
        }

        setCurrentSection(index);
        const progress = (index + 1) / sections.length;
        onPositionChange(JSON.stringify({ section: index }), progress);
      } catch (err) {
        console.error("Error loading section:", err);
      }
      setLoading(false);
    },
    [onPositionChange],
  );

  const goPrev = useCallback(() => {
    goToSection(currentSection - 1);
  }, [currentSection, goToSection]);

  const goNext = useCallback(() => {
    goToSection(currentSection + 1);
  }, [currentSection, goToSection]);

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-surface">
        <div className="text-center">
          <p className="text-danger mb-2">{error}</p>
          <p className="text-foreground-muted text-sm">Try refreshing the page</p>
        </div>
      </div>
    );
  }

  const totalSections = bookRef.current?.sections?.length || 0;

  return (
    <div className="h-full flex bg-surface">
      {/* TOC Sidebar */}
      {showToc && (
        <div className="w-64 border-r border-border bg-surface-elevated flex flex-col flex-shrink-0">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h3 className="font-bold text-foreground">Contents</h3>
            <button
              onClick={() => setShowToc(false)}
              className="text-foreground-muted hover:text-foreground text-xl"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {toc.map((item, i) => (
              <button
                key={i}
                onClick={() => {
                  goToSection(i);
                  setShowToc(false);
                }}
                className={`w-full text-left p-2 text-sm hover:bg-surface rounded truncate ${
                  i === currentSection ? "bg-primary-light text-primary" : "text-foreground"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 p-2 border-b border-border bg-surface flex-shrink-0">
          <button
            onClick={() => setShowToc(!showToc)}
            className="p-2 hover:bg-surface-elevated rounded text-foreground"
            title="Table of Contents"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
          <button
            onClick={goPrev}
            disabled={currentSection <= 0}
            className="px-3 py-1 text-sm border border-border rounded hover:bg-surface-elevated disabled:opacity-50 disabled:cursor-not-allowed text-foreground"
          >
            ← Prev
          </button>
          <span className="text-sm text-foreground-muted">
            {currentSection + 1} / {totalSections || "..."}
          </span>
          <button
            onClick={goNext}
            disabled={currentSection >= totalSections - 1}
            className="px-3 py-1 text-sm border border-border rounded hover:bg-surface-elevated disabled:opacity-50 disabled:cursor-not-allowed text-foreground"
          >
            Next →
          </button>
        </div>

        {/* Reader area */}
        <div className="flex-1 relative overflow-hidden">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface z-10">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
            </div>
          )}
          <div ref={containerRef} className="h-full w-full" />
        </div>
      </div>
    </div>
  );
}
