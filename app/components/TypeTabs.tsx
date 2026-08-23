import { Link } from "react-flight-router/client";
import type { BookType, ReadingState } from "../lib/book-types";

export type TypeFilter = BookType | "all";

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ebook", label: "Ebooks" },
  { value: "audiobook", label: "Audiobooks" },
  { value: "comic", label: "Comics" },
];

function buildUrl({
  type,
  currentSort,
  currentView,
  currentReadingState,
  currentDensity,
  basePath,
}: {
  type: TypeFilter;
  currentSort: string;
  currentView?: "series" | "books" | "grid";
  currentReadingState?: ReadingState;
  currentDensity?: "covers" | "compact";
  basePath: string;
}): string {
  const params = new URLSearchParams();
  if (currentView === "series") params.set("view", "series");
  if (type !== "all") params.set("type", type);
  if (currentSort !== "recent") params.set("sort", currentSort);
  if (currentReadingState) params.set("state", currentReadingState);
  if (currentDensity === "compact") params.set("density", "compact");
  const queryString = params.toString();
  return queryString ? `${basePath}?${queryString}` : basePath;
}

export function TypeTabs({
  currentType,
  currentSort,
  currentView,
  currentReadingState,
  currentDensity,
  availableTypes,
  basePath = "/library",
}: {
  currentType: TypeFilter;
  currentSort: string;
  currentView?: "series" | "books" | "grid";
  currentReadingState?: ReadingState;
  currentDensity?: "covers" | "compact";
  availableTypes?: BookType[];
  basePath?: string;
}) {
  const visibleOptions = TYPE_OPTIONS.filter(
    (option) =>
      option.value === "all" ||
      option.value === currentType ||
      !availableTypes ||
      availableTypes.includes(option.value),
  );

  return (
    <div
      className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-xl bg-surface-elevated p-1"
      aria-label="Library types"
    >
      {visibleOptions.map((option) => {
        const isActive = option.value === currentType;
        return (
          <Link
            key={option.value}
            to={buildUrl({
              type: option.value,
              currentSort,
              currentView,
              currentReadingState,
              currentDensity,
              basePath,
            })}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
              isActive
                ? "bg-surface text-foreground shadow-sm"
                : "text-foreground-muted hover:text-foreground"
            }`}
          >
            {option.label}
          </Link>
        );
      })}
    </div>
  );
}
