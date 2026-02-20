"use client";

import { useState, useRef, useEffect } from "react";
import type { TypeFilter } from "./TypeTabs";

interface FormatDropdownProps {
  formatCounts: { format: string; count: number }[];
  selectedFormats: string[];
  currentType: TypeFilter;
  currentSort: string;
}

export function FormatDropdown({
  formatCounts,
  selectedFormats,
  currentType,
  currentSort,
}: FormatDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [open]);

  const sorted = [...formatCounts].sort((a, b) => b.count - a.count);

  function buildUrl(formats: string[]) {
    const params = new URLSearchParams();
    if (currentType !== "all") {
      params.set("type", currentType);
    }
    if (currentSort !== "recent") {
      params.set("sort", currentSort);
    }
    if (formats.length > 0) {
      params.set("format", formats.join(","));
    }
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  }

  function toggle(fmt: string) {
    const next = selectedFormats.includes(fmt)
      ? selectedFormats.filter((f) => f !== fmt)
      : [...selectedFormats, fmt];
    window.location.href = buildUrl(next);
  }

  function clearAll() {
    window.location.href = buildUrl([]);
  }

  const activeCount = selectedFormats.length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-all duration-200 ${
          activeCount > 0
            ? "border-primary bg-primary-light text-primary"
            : "border-border bg-surface text-foreground-muted hover:text-foreground hover:bg-surface-elevated"
        }`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
          />
        </svg>
        Format
        {activeCount > 0 && (
          <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-bold rounded-full bg-primary text-white">
            {activeCount}
          </span>
        )}
        <svg
          className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[200px] bg-surface border border-border rounded-xl shadow-lg p-2">
          {sorted.map(({ format, count }) => {
            const checked = selectedFormats.includes(format);
            return (
              <label
                key={format}
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer hover:bg-surface-elevated transition-colors"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(format)}
                  className="w-4 h-4 rounded border-border text-primary focus:ring-primary accent-primary"
                />
                <span className="text-sm font-medium text-foreground uppercase flex-1">
                  {format}
                </span>
                <span className="text-xs text-foreground-muted tabular-nums">{count}</span>
              </label>
            );
          })}
          {activeCount > 0 && (
            <>
              <div className="border-t border-border my-1" />
              <button
                onClick={clearAll}
                className="w-full text-left px-2.5 py-2 text-sm text-foreground-muted hover:text-foreground rounded-lg hover:bg-surface-elevated transition-colors"
              >
                Clear filters
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
