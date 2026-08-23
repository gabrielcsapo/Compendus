"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useRouter } from "react-flight-router/client";
import type { BookType, ReadingState } from "../lib/book-types";
import { SortDropdown, type SortOption } from "./SortDropdown";
import { TypeTabs, type TypeFilter } from "./TypeTabs";

export type LibraryDensity = "covers" | "compact";

interface LibraryToolbarProps {
  currentType: TypeFilter;
  currentSort: SortOption;
  currentView: "books" | "series";
  currentFormats: string[];
  currentReadingState?: ReadingState;
  currentDensity: LibraryDensity;
  formatCounts: { format: string; count: number }[];
  typeCounts: Record<BookType, number>;
}

const READING_STATES: { value: ReadingState; label: string }[] = [
  { value: "in-progress", label: "In progress" },
  { value: "unread", label: "Unread" },
  { value: "finished", label: "Finished" },
];

function buildLibraryUrl({
  type,
  sort,
  view,
  formats,
  readingState,
  density,
}: {
  type: TypeFilter;
  sort: SortOption;
  view: "books" | "series";
  formats: string[];
  readingState?: ReadingState;
  density: LibraryDensity;
}) {
  const params = new URLSearchParams();
  if (view === "series") params.set("view", "series");
  if (type !== "all") params.set("type", type);
  if (sort !== "recent") params.set("sort", sort);
  if (formats.length > 0 && view === "books") params.set("format", formats.join(","));
  if (readingState) params.set("state", readingState);
  if (density === "compact" && view === "books") params.set("density", density);
  const query = params.toString();
  return query ? `/library?${query}` : "/library";
}

export function LibraryToolbar({
  currentType,
  currentSort,
  currentView,
  currentFormats,
  currentReadingState,
  currentDensity,
  formatCounts,
  typeCounts,
}: LibraryToolbarProps) {
  const { navigate } = useRouter();
  const [open, setOpen] = useState(false);
  const refineRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const availableTypes = useMemo(
    () =>
      (Object.entries(typeCounts) as [BookType, number][])
        .filter(([, count]) => count > 0)
        .map(([type]) => type),
    [typeCounts],
  );

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (refineRef.current && !refineRef.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const go = (overrides: Partial<Parameters<typeof buildLibraryUrl>[0]>) => {
    setOpen(false);
    navigate(
      buildLibraryUrl({
        type: currentType,
        sort: currentSort,
        view: currentView,
        formats: currentFormats,
        readingState: currentReadingState,
        density: currentDensity,
        ...overrides,
      }),
    );
  };

  const toggleFormat = (format: string) => {
    go({
      view: "books",
      formats: currentFormats.includes(format)
        ? currentFormats.filter((current) => current !== format)
        : [...currentFormats, format],
    });
  };

  const refinementCount =
    currentFormats.length +
    (currentReadingState ? 1 : 0) +
    (currentDensity === "compact" ? 1 : 0) +
    (currentView === "series" ? 1 : 0);
  const hasActiveRefinements = refinementCount > 0;

  return (
    <div className="relative">
      <div className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-center lg:justify-between">
        <TypeTabs
          currentType={currentType}
          currentSort={currentSort}
          currentView={currentView}
          currentReadingState={currentReadingState}
          currentDensity={currentDensity}
          availableTypes={availableTypes}
        />

        <div className="flex flex-wrap items-center gap-2">
          <form
            action="/search"
            method="get"
            onSubmit={(event) => {
              event.preventDefault();
              const query = new FormData(event.currentTarget).get("q")?.toString().trim();
              if (query) navigate(`/search?q=${encodeURIComponent(query)}`);
            }}
            className="group flex h-10 w-10 items-center gap-2 overflow-hidden rounded-xl border border-border bg-surface px-3 text-foreground-muted transition-[width,border-color] duration-300 focus-within:w-64 focus-within:border-primary"
          >
            <button
              type="button"
              aria-label="Open library search"
              title="Search this library"
              onClick={() => searchInputRef.current?.focus()}
              className="-m-2 grid h-8 w-8 shrink-0 place-items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"
                />
              </svg>
            </button>
            <input
              ref={searchInputRef}
              name="q"
              aria-label="Search this library"
              placeholder="Search this library…"
              className="w-36 min-w-36 bg-transparent text-sm text-foreground opacity-0 outline-none transition-opacity group-focus-within:opacity-100"
            />
            <button
              type="submit"
              aria-label="Search library"
              className="-mr-2 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-primary opacity-0 transition-opacity hover:bg-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 group-focus-within:opacity-100"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="m9 18 6-6-6-6"
                />
              </svg>
            </button>
          </form>

          <div ref={refineRef} className="relative">
            <button
              type="button"
              onClick={() => setOpen((current) => !current)}
              aria-expanded={open}
              aria-controls="library-refine-panel"
              className={`flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors ${
                open || hasActiveRefinements
                  ? "border-primary/50 bg-primary-light text-primary"
                  : "border-border bg-surface text-foreground-muted hover:text-foreground"
              }`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M4 6h10m4 0h2M4 12h3m4 0h9M4 18h8m4 0h4"
                />
                <circle cx="16" cy="6" r="2" />
                <circle cx="9" cy="12" r="2" />
                <circle cx="14" cy="18" r="2" />
              </svg>
              Refine
              {refinementCount > 0 && (
                <span className="inline-grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
                  {refinementCount}
                </span>
              )}
            </button>

            {open && (
              <div
                id="library-refine-panel"
                className="absolute right-0 top-full z-30 mt-2 grid w-[min(32rem,calc(100vw-2.5rem))] grid-cols-1 gap-6 rounded-2xl border border-border bg-surface p-5 shadow-2xl sm:grid-cols-2"
              >
                {formatCounts.length > 0 && (
                  <RefineSection label="Format">
                    {formatCounts.map(({ format, count }) => (
                      <RefineButton
                        key={format}
                        active={currentFormats.includes(format)}
                        onClick={() => toggleFormat(format)}
                      >
                        {format.toUpperCase()} <span className="opacity-55">{count}</span>
                      </RefineButton>
                    ))}
                  </RefineSection>
                )}

                <RefineSection label="Organization">
                  <Link to="/collections" className="refine-control">
                    Collections
                  </Link>
                  <Link to="/tags" className="refine-control">
                    Tags
                  </Link>
                  <RefineButton
                    active={currentView === "series"}
                    onClick={() => go({ view: currentView === "series" ? "books" : "series" })}
                  >
                    Series
                  </RefineButton>
                </RefineSection>

                <RefineSection label="Reading state">
                  {READING_STATES.map((state) => (
                    <RefineButton
                      key={state.value}
                      active={currentReadingState === state.value}
                      onClick={() =>
                        go({
                          readingState:
                            currentReadingState === state.value ? undefined : state.value,
                        })
                      }
                    >
                      {state.label}
                    </RefineButton>
                  ))}
                </RefineSection>

                <RefineSection label="View">
                  <RefineButton
                    active={currentDensity === "covers" && currentView === "books"}
                    onClick={() => go({ view: "books", density: "covers" })}
                  >
                    Covers
                  </RefineButton>
                  <RefineButton
                    active={currentDensity === "compact" && currentView === "books"}
                    onClick={() => go({ view: "books", density: "compact" })}
                  >
                    Compact
                  </RefineButton>
                </RefineSection>
              </div>
            )}
          </div>

          {currentView === "books" && <SortDropdown currentSort={currentSort} />}
        </div>
      </div>

      {hasActiveRefinements && (
        <div className="flex flex-wrap items-center gap-2 pt-3">
          {currentFormats.map((format) => (
            <ActiveFilter key={format} onRemove={() => toggleFormat(format)}>
              {format.toUpperCase()}
            </ActiveFilter>
          ))}
          {currentReadingState && (
            <ActiveFilter onRemove={() => go({ readingState: undefined })}>
              {READING_STATES.find((state) => state.value === currentReadingState)?.label}
            </ActiveFilter>
          )}
          {currentDensity === "compact" && (
            <ActiveFilter onRemove={() => go({ density: "covers" })}>Compact</ActiveFilter>
          )}
          {currentView === "series" && (
            <ActiveFilter onRemove={() => go({ view: "books" })}>Series</ActiveFilter>
          )}
          <button
            type="button"
            onClick={() =>
              go({
                view: "books",
                formats: [],
                readingState: undefined,
                density: "covers",
              })
            }
            className="px-1 text-xs font-semibold text-foreground-muted hover:text-foreground"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

function RefineSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-foreground-muted">
        {label}
      </h3>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </section>
  );
}

function RefineButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`refine-control ${active ? "refine-control-active" : ""}`}
    >
      {children}
    </button>
  );
}

function ActiveFilter({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="rounded-full bg-surface-elevated px-3 py-1.5 text-xs font-semibold text-foreground-muted transition-colors hover:text-foreground"
    >
      {children}&nbsp; ×
    </button>
  );
}
