"use client";

import { useState, useCallback, useRef } from "react";
import { ReactReader } from "react-reader";
import type { Rendition, NavItem } from "epubjs";

interface EpubReaderProps {
  bookPath: string;
  position?: string;
  onPositionChange: (position: string, progress: number) => void;
}

export function EpubReader({ bookPath, position, onPositionChange }: EpubReaderProps) {
  const [location, setLocation] = useState<string | null>(position || null);
  const [showToc, setShowToc] = useState(false);
  const [toc, setToc] = useState<NavItem[]>([]);
  const renditionRef = useRef<Rendition | null>(null);

  const locationChanged = useCallback(
    (epubcfi: string) => {
      setLocation(epubcfi);

      if (renditionRef.current) {
        const loc = renditionRef.current.location;
        if (loc && loc.start) {
          const progress = (loc.start.displayed?.page || 0) / (loc.start.displayed?.total || 1);
          onPositionChange(epubcfi, progress);
        }
      }
    },
    [onPositionChange],
  );

  const tocChanged = useCallback((newToc: NavItem[]) => {
    setToc(newToc);
  }, []);

  const getRendition = useCallback((rendition: Rendition) => {
    renditionRef.current = rendition;

    // Apply custom styles
    rendition.themes.default({
      body: {
        fontFamily: "Georgia, serif",
        lineHeight: "1.6",
      },
    });

    // Register themes
    rendition.themes.register("light", {
      body: { background: "#fff", color: "#000" },
    });
    rendition.themes.register("dark", {
      body: { background: "#1a1a1a", color: "#e0e0e0" },
    });
    rendition.themes.register("sepia", {
      body: { background: "#f4ecd8", color: "#5c4b37" },
    });
  }, []);

  return (
    <div className="epub-reader h-full relative bg-white">
      {/* TOC sidebar */}
      {showToc && (
        <div className="absolute left-0 top-0 h-full w-64 bg-white z-10 shadow-lg overflow-y-auto border-r">
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">Table of Contents</h3>
              <button
                onClick={() => setShowToc(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                &times;
              </button>
            </div>
            {toc.map((item, i) => (
              <button
                key={i}
                onClick={() => {
                  renditionRef.current?.display(item.href);
                  setShowToc(false);
                }}
                className="block w-full text-left py-2 px-2 hover:bg-gray-100 rounded text-sm"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Toggle TOC button */}
      <button
        onClick={() => setShowToc(!showToc)}
        className="absolute top-4 left-4 z-20 p-2 bg-white rounded shadow hover:bg-gray-50"
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

      <ReactReader
        url={bookPath}
        location={location}
        locationChanged={locationChanged}
        tocChanged={tocChanged}
        getRendition={getRendition}
        epubOptions={{
          flow: "paginated",
          manager: "continuous",
        }}
      />
    </div>
  );
}
