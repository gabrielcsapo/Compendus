import { useCallback, useEffect, useState } from "react";
import { Link, Outlet } from "react-router";
import { BrandLockup } from "@app/components/BrandLockup";
import { PRODUCT_FRAME_CLASS } from "@app/lib/product-ui";
import { DarkModeToggle } from "./DarkModeToggle";
import { SearchModal } from "./SearchModal";
import { Sidebar } from "./Sidebar";

export function DocsLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b border-border/80 bg-background/88 backdrop-blur-xl">
        <div className={`${PRODUCT_FRAME_CLASS} flex h-16 items-center gap-3 sm:gap-5`}>
          <button
            onClick={() => setSidebarOpen((open) => !open)}
            className="-ml-2 grid h-9 w-9 place-items-center rounded-full text-foreground-muted transition-colors hover:bg-surface-elevated hover:text-foreground lg:hidden"
            aria-label="Toggle documentation navigation"
            aria-expanded={sidebarOpen}
          >
            <MenuIcon />
          </button>

          <Link
            to="/"
            className="flex shrink-0 items-center gap-3 text-foreground hover:text-primary"
          >
            <BrandLockup wordmarkClassName="hidden h-[1.25rem] w-auto sm:block" />
            <span className="rounded-full bg-surface-elevated px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-foreground-muted">
              Docs
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={openSearch}
              className="flex h-9 items-center gap-2 rounded-full border border-border bg-surface px-3 text-sm text-foreground-muted transition-colors hover:border-border-hover hover:text-foreground sm:min-w-52"
              aria-label="Search documentation"
            >
              <SearchIcon />
              <span className="hidden sm:inline">Search the guide</span>
              <kbd className="ml-auto hidden rounded border border-border bg-surface-elevated px-1.5 py-0.5 font-mono text-[9px] md:inline">
                ⌘K
              </kbd>
            </button>
            <DarkModeToggle />
            <a
              href="https://github.com/gabrielcsapo/Compendus"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden h-9 w-9 place-items-center rounded-full text-foreground-muted transition-colors hover:bg-surface-elevated hover:text-foreground sm:grid"
              aria-label="Compendus on GitHub"
            >
              <GitHubIcon />
            </a>
          </div>
        </div>
      </header>

      <div
        className={`${PRODUCT_FRAME_CLASS} flex-1 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12`}
      >
        {sidebarOpen && (
          <button
            className="fixed inset-0 z-30 bg-black/45 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close documentation navigation"
          />
        )}

        <aside
          className={`fixed inset-y-0 left-0 z-40 w-[min(19rem,88vw)] overflow-y-auto border-r border-border bg-background px-5 pb-8 pt-24 transition-transform lg:sticky lg:top-16 lg:z-0 lg:h-[calc(100vh-4rem)] lg:w-auto lg:translate-x-0 lg:border-r-0 lg:bg-transparent lg:px-0 lg:py-10 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <Sidebar onNavigate={() => setSidebarOpen(false)} />
        </aside>

        <main className="min-w-0 py-10 sm:py-14 lg:py-16">
          <Outlet />
        </main>
      </div>

      <footer className="border-t border-border">
        <div
          className={`${PRODUCT_FRAME_CLASS} flex flex-col gap-3 py-7 text-sm text-foreground-muted sm:flex-row sm:items-center sm:justify-between`}
        >
          <p>Compendus documentation follows the product’s shared design system.</p>
          <div className="flex items-center gap-5">
            <Link to="/" className="hover:text-foreground">
              Product
            </Link>
            <a
              href="https://github.com/gabrielcsapo/Compendus/issues"
              className="hover:text-foreground"
            >
              Report an issue
            </a>
          </div>
        </div>
      </footer>

      <SearchModal open={searchOpen} onClose={closeSearch} />
    </div>
  );
}

function MenuIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeWidth={1.8} d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="6.5" strokeWidth={1.8} />
      <path strokeLinecap="round" strokeWidth={1.8} d="m16 16 4 4" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0012 2z" />
    </svg>
  );
}
