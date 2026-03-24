"use client";

import { Link, Outlet } from "react-flight-router/client";

export default function Component() {
  return (
    <main className="container my-8 px-6 mx-auto">
      <div className="mb-8">
        <Link
          to="/library"
          className="text-primary hover:text-primary-hover text-sm font-medium transition-colors"
        >
          &larr; Back to Library
        </Link>
        <h1 className="text-2xl font-bold mt-2 text-foreground">Discover</h1>
        <p className="text-foreground-muted">Find new books to add to your library</p>
      </div>

      <Outlet />
    </main>
  );
}
