"use client";

import { Link, Outlet, useLocation } from "react-flight-router/client";

export default function AdminLayout() {
  const location = useLocation();

  const getActiveTab = () => {
    if (location.pathname === "/admin/batch-edit") return "batch-edit";
    if (location.pathname === "/admin/unmatched") return "unmatched";
    if (location.pathname === "/admin/profiles") return "profiles";
    return "data";
  };

  const activeTab = getActiveTab();

  return (
    <main className="container my-8 px-6 mx-auto">
      {/* Header */}
      <div className="mb-8">
        <Link
          to="/library"
          className="text-primary hover:text-primary-hover text-sm font-medium transition-colors"
        >
          &larr; Back to Library
        </Link>
        <h1 className="text-2xl font-bold mt-2 text-foreground">Admin</h1>
        <p className="text-foreground-muted">
          Manage your library data, batch edit books, and match metadata
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-6 border-b border-border">
        <TabLink to="/admin" active={activeTab === "data"}>
          Data
        </TabLink>
        <TabLink to="/admin/batch-edit" active={activeTab === "batch-edit"}>
          Batch Edit
        </TabLink>
        <TabLink to="/admin/unmatched" active={activeTab === "unmatched"}>
          Unmatched Books
        </TabLink>
        <TabLink to="/admin/profiles" active={activeTab === "profiles"}>
          Profiles
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
