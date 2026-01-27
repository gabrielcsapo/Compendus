"use client";

import { useState, useCallback, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Configure worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfReaderProps {
  bookPath: string;
  position?: string;
  onPositionChange: (position: string, progress: number) => void;
}

export function PdfReader({ bookPath, position, onPositionChange }: PdfReaderProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(position ? parseInt(position, 10) : 1);
  const [scale, setScale] = useState<number>(1.0);
  const [, setLoading] = useState(true);

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setLoading(false);
  }, []);

  const goToPage = useCallback(
    (page: number) => {
      const newPage = Math.max(1, Math.min(page, numPages));
      setCurrentPage(newPage);
      onPositionChange(String(newPage), newPage / numPages);
    },
    [numPages, onPositionChange],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
          goToPage(currentPage + 1);
          break;
        case "ArrowLeft":
        case "PageUp":
          goToPage(currentPage - 1);
          break;
        case "Home":
          goToPage(1);
          break;
        case "End":
          goToPage(numPages);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentPage, numPages, goToPage]);

  return (
    <div className="pdf-reader flex flex-col h-full bg-surface-elevated">
      {/* Toolbar */}
      <div className="pdf-toolbar flex items-center justify-between p-2 bg-surface border-b border-border shadow-sm">
        <div className="flex items-center gap-2">
          <button
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            className="btn px-3 py-1 text-sm disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm">
            <input
              type="number"
              value={currentPage}
              onChange={(e) => goToPage(parseInt(e.target.value) || 1)}
              className="input w-16 text-center text-sm"
              min={1}
              max={numPages}
            />{" "}
            / {numPages}
          </span>
          <button
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= numPages}
            className="btn px-3 py-1 text-sm disabled:opacity-50"
          >
            Next
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
            className="btn px-3 py-1 text-sm"
          >
            -
          </button>
          <span className="text-sm w-16 text-center">{Math.round(scale * 100)}%</span>
          <button
            onClick={() => setScale((s) => Math.min(3, s + 0.25))}
            className="btn px-3 py-1 text-sm"
          >
            +
          </button>
        </div>
      </div>

      {/* Document viewer */}
      <div className="pdf-content flex-1 overflow-auto flex justify-center py-4">
        <Document
          file={bookPath}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
            </div>
          }
          error={<div className="text-center text-danger p-4">Failed to load PDF</div>}
        >
          <Page
            pageNumber={currentPage}
            scale={scale}
            renderTextLayer={true}
            renderAnnotationLayer={true}
            className="shadow-lg"
          />
        </Document>
      </div>
    </div>
  );
}
