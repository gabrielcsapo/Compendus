"use client";

import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-flight-router/client";
import { adminRest, type SidebarCounts } from "../lib/admin-rest";

/**
 * Admin workspace shell — a grouped sidebar (CMS-style), not a tab strip.
 * Sections are real routes; badge counts turn the nav into an inbox ("where
 * is work waiting?") refreshed once a minute and only while the tab is
 * visible. The old "Back to Library" header is gone — the global nav already
 * has it, and admin is a workspace, not a detour.
 */

interface NavItem {
  to: string;
  label: string;
  match: (path: string) => boolean;
  badge?: (c: SidebarCounts) => number;
  badgeTone?: "attention" | "info";
}

interface NavGroup {
  title: string | null;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    title: null,
    items: [{ to: "/admin", label: "Overview", match: (p) => p === "/admin" || p === "/admin/" }],
  },
  {
    title: "Library",
    items: [
      { to: "/admin/batch-edit", label: "Books", match: (p) => p.startsWith("/admin/batch-edit") },
      {
        to: "/admin/unmatched",
        label: "Matching",
        match: (p) => p.startsWith("/admin/unmatched"),
        badge: (c) => c.unmatched,
        badgeTone: "info",
      },
      {
        to: "/admin/duplicates",
        label: "Duplicates",
        match: (p) => p.startsWith("/admin/duplicates"),
        badge: (c) => c.duplicates,
        badgeTone: "info",
      },
    ],
  },
  {
    title: "System",
    items: [
      {
        to: "/admin/jobs",
        label: "Jobs",
        match: (p) => p.startsWith("/admin/jobs"),
        badge: (c) => c.jobErrors,
        badgeTone: "attention",
      },
      { to: "/admin/fleet", label: "Fleet", match: (p) => p.startsWith("/admin/fleet") },
      { to: "/admin/storage", label: "Storage", match: (p) => p.startsWith("/admin/storage") },
    ],
  },
  {
    title: "People",
    items: [
      { to: "/admin/profiles", label: "Profiles", match: (p) => p.startsWith("/admin/profiles") },
    ],
  },
];

export default function AdminLayout() {
  const location = useLocation();
  const [counts, setCounts] = useState<SidebarCounts | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      adminRest
        .counts()
        .then((c) => alive && setCounts(c))
        .catch(() => {});
    };
    const poll = () => {
      if (!document.hidden) load();
    };
    load(); // first paint always loads, even in a background tab
    const id = setInterval(poll, 60_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", poll);
    };
  }, []);

  return (
    <main className="container mx-auto my-6 px-4 sm:px-6">
      <div className="flex flex-col md:flex-row gap-6">
        {/* Sidebar */}
        <nav className="md:w-52 shrink-0">
          <div className="md:sticky md:top-20">
            <h1 className="px-3 text-lg font-bold text-foreground mb-3 hidden md:block">Admin</h1>
            <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-2 md:pb-0">
              {GROUPS.map((group, gi) => (
                <div key={gi} className="flex md:flex-col gap-1 md:mb-4 shrink-0">
                  {group.title && (
                    <div className="hidden md:block px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-widest text-foreground-muted/70">
                      {group.title}
                    </div>
                  )}
                  {group.items.map((item) => {
                    const active = item.match(location.pathname);
                    const badge = counts && item.badge ? item.badge(counts) : 0;
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        className={`flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${
                          active
                            ? "bg-surface-elevated text-foreground font-medium"
                            : "text-foreground-muted hover:text-foreground hover:bg-surface"
                        }`}
                      >
                        <span>{item.label}</span>
                        {badge > 0 && (
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none ${
                              item.badgeTone === "attention"
                                ? "bg-red-500/15 text-red-400"
                                : "bg-surface-elevated text-foreground-muted"
                            }`}
                          >
                            {badge > 999 ? "999+" : badge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </nav>

        {/* Section content */}
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </main>
  );
}
