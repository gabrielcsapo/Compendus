"use client";

import { useState, useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { getWantedBooks } from "../actions/wanted.js";

export function Component() {
  const location = useLocation();
  const [wantedCount, setWantedCount] = useState(0);

  useEffect(() => {
    loadWantedCount();
  }, []);

  const loadWantedCount = async () => {
    try {
      const result = await getWantedBooks({ filterOwned: true });
      setWantedCount(result.books.length);
    } catch (error) {
      console.error("Failed to load wanted count:", error);
    }
  };

  // Determine active tab from pathname
  const getActiveTab = () => {
    if (location.pathname === "/discover/wishlist") return "wishlist";
    if (location.pathname === "/discover/series") return "series";
    return "search";
  };

  const activeTab = getActiveTab();

  return (
    <main className="container my-8 px-6 mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <Link
            to="/"
            className="text-primary hover:text-primary-hover text-sm font-medium transition-colors"
          >
            &larr; Back to Library
          </Link>
          <h1 className="text-2xl font-bold mt-2 text-foreground">Discover</h1>
          <p className="text-foreground-muted">
            Find new books and complete your series
          </p>
        </div>
        {wantedCount > 0 && (
          <div className="text-sm text-foreground-muted">
            {wantedCount} book{wantedCount !== 1 ? "s" : ""} on wanted list
          </div>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-6 border-b border-border">
        <TabLink to="/discover" active={activeTab === "search"}>
          Search Books
        </TabLink>
        <TabLink to="/discover/wishlist" active={activeTab === "wishlist"}>
          Wanted List {wantedCount > 0 && `(${wantedCount})`}
        </TabLink>
        <TabLink to="/discover/series" active={activeTab === "series"}>
          Series Tracker
        </TabLink>
      </div>

      {/* Child Route Content */}
      <Outlet />
    </main>
  );
}

function TabLink({
  to,
  active,
  children,
}: {
  to: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-primary text-primary"
          : "border-transparent text-foreground-muted hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}
