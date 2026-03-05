import { Link } from "react-flight-router/client";
import type { BookType } from "../lib/book-types";

export type TypeFilter = BookType | "all";

const TYPE_OPTIONS: { value: TypeFilter; label: string; icon: React.ReactNode }[] = [
  {
    value: "all",
    label: "All",
    icon: null,
  },
  {
    value: "ebook",
    label: "Ebooks",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
        />
      </svg>
    ),
  },
  {
    value: "audiobook",
    label: "Audiobooks",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15.536a5 5 0 001.414 1.414m2.828-9.9a9 9 0 012.828-2.828"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 18.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15.5V9" />
      </svg>
    ),
  },
  {
    value: "comic",
    label: "Comics",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
        />
      </svg>
    ),
  },
];

function buildUrl(type: TypeFilter, currentSort: string, currentView?: "series" | "books", basePath = "/library"): string {
  const params = new URLSearchParams();
  if (currentView === "series") {
    params.set("view", "series");
  }
  if (type !== "all") {
    params.set("type", type);
  }
  if (currentSort !== "recent") {
    params.set("sort", currentSort);
  }
  const queryString = params.toString();
  return queryString ? `${basePath}?${queryString}` : basePath;
}

export function TypeTabs({
  currentType,
  currentSort,
  currentView,
  basePath = "/library",
}: {
  currentType: TypeFilter;
  currentSort: string;
  currentView?: "series" | "books";
  basePath?: string;
}) {
  return (
    <div className="inline-flex gap-1 p-1 bg-surface-elevated rounded-lg">
      {TYPE_OPTIONS.map((option) => {
        const isActive = option.value === currentType;
        return (
          <Link
            key={option.value}
            to={buildUrl(option.value, currentSort, currentView, basePath)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
              isActive
                ? "bg-primary text-white shadow-sm"
                : "text-foreground-muted hover:text-foreground hover:bg-surface"
            }`}
          >
            {option.icon}
            {option.label}
          </Link>
        );
      })}
    </div>
  );
}
