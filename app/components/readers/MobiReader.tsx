"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface MobiReaderProps {
  bookPath: string;
  position?: string;
  onPositionChange: (position: string, progress: number) => void;
}

interface Chapter {
  index: number;
  title: string;
  id: string;
}

export function MobiReader({ bookPath, position, onPositionChange }: MobiReaderProps) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [currentChapter, setCurrentChapter] = useState(0);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showToc, setShowToc] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const mobiRef = useRef<Awaited<
    ReturnType<typeof import("@lingo-reader/mobi-parser").initMobiFile>
  > | null>(null);

  // Load book
  useEffect(() => {
    async function loadBook() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(bookPath);
        if (!response.ok) {
          throw new Error("Failed to load book");
        }

        const arrayBuffer = await response.arrayBuffer();
        const { initMobiFile } = await import("@lingo-reader/mobi-parser");
        const mobi = await initMobiFile(new Uint8Array(arrayBuffer));
        mobiRef.current = mobi;

        const spine = mobi.getSpine();
        const toc = mobi.getToc();

        setChapters(
          spine.map((item, i) => {
            const tocEntry = toc.find((t) => t.href.includes(item.id));
            return {
              index: i,
              title: tocEntry?.label || `Chapter ${i + 1}`,
              id: item.id,
            };
          }),
        );

        // Restore position
        if (position) {
          try {
            const pos = JSON.parse(position);
            setCurrentChapter(pos.chapter || 0);
          } catch {
            // Invalid position, start from beginning
          }
        }

        // Load first chapter
        if (spine.length > 0) {
          const firstChapter = await mobi.loadChapter(spine[0].id);
          setContent(firstChapter?.html || "");
        }
        setLoading(false);
      } catch (err) {
        console.error("Failed to load MOBI:", err);
        setError("Failed to load book");
        setLoading(false);
      }
    }

    loadBook();
  }, [bookPath, position]);

  const loadChapter = useCallback(
    async (index: number) => {
      if (!mobiRef.current || index < 0 || index >= chapters.length) return;

      try {
        setLoading(true);
        const chapter = await mobiRef.current.loadChapter(chapters[index].id);
        setContent(chapter?.html || "");
        setCurrentChapter(index);

        // Update position
        const progress = (index + 1) / chapters.length;
        onPositionChange(JSON.stringify({ chapter: index, scroll: 0 }), progress);

        // Scroll to top
        contentRef.current?.scrollTo(0, 0);
        setLoading(false);
      } catch (err) {
        console.error("Failed to load chapter:", err);
        setLoading(false);
      }
    },
    [chapters, onPositionChange],
  );

  const handleScroll = useCallback(() => {
    if (!contentRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = contentRef.current;
    const scrollProgress = scrollTop / (scrollHeight - clientHeight || 1);

    const positionData = JSON.stringify({
      chapter: currentChapter,
      scroll: scrollTop,
    });
    const progress = (currentChapter + scrollProgress) / (chapters.length || 1);

    onPositionChange(positionData, progress);
  }, [currentChapter, chapters.length, onPositionChange]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="mobi-reader h-full flex bg-white">
      {/* TOC sidebar */}
      <div
        className={`${showToc ? "w-64" : "w-0"} transition-all overflow-hidden border-r bg-gray-50`}
      >
        <div className="p-4 w-64">
          <h3 className="font-bold mb-4">Chapters</h3>
          {chapters.map((chapter) => (
            <button
              key={chapter.index}
              onClick={() => {
                loadChapter(chapter.index);
                setShowToc(false);
              }}
              className={`w-full text-left p-2 text-sm hover:bg-gray-100 rounded ${
                chapter.index === currentChapter ? "bg-blue-100 text-blue-700" : ""
              }`}
            >
              {chapter.title}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-4 p-2 bg-white border-b shadow-sm">
          <button
            onClick={() => setShowToc(!showToc)}
            className="btn px-3 py-1 text-sm"
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
            onClick={() => loadChapter(Math.max(0, currentChapter - 1))}
            disabled={currentChapter <= 0}
            className="btn px-3 py-1 text-sm disabled:opacity-50"
          >
            Previous
          </button>

          <span className="text-sm text-gray-500">
            Chapter {currentChapter + 1} of {chapters.length}
          </span>

          <button
            onClick={() => loadChapter(Math.min(chapters.length - 1, currentChapter + 1))}
            disabled={currentChapter >= chapters.length - 1}
            className="btn px-3 py-1 text-sm disabled:opacity-50"
          >
            Next
          </button>
        </div>

        {/* Content area */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
          </div>
        ) : (
          <div ref={contentRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
            <div
              className="max-w-2xl mx-auto p-8 prose prose-lg"
              dangerouslySetInnerHTML={{ __html: content }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
