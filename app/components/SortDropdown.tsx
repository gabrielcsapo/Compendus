"use client";

export type SortOption = "recent" | "title-asc" | "title-desc" | "oldest";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "recent", label: "Recently Added" },
  { value: "title-asc", label: "Title A-Z" },
  { value: "title-desc", label: "Title Z-A" },
  { value: "oldest", label: "Oldest First" },
];

export function SortDropdown({ currentSort }: { currentSort: SortOption }) {
  return (
    <div className="relative">
      <select
        value={currentSort}
        onChange={(e) => {
          const sort = e.target.value as SortOption;
          const url = new URL(window.location.href);
          if (sort === "recent") {
            url.searchParams.delete("sort");
          } else {
            url.searchParams.set("sort", sort);
          }
          url.searchParams.delete("page"); // Reset to page 1 when changing sort
          window.location.href = url.toString();
        }}
        className="appearance-none bg-surface border border-border rounded-lg px-3 py-2 pr-8 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer"
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <svg
        className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted pointer-events-none"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  );
}
