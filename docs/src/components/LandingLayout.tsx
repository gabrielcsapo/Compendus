import { Link, Outlet } from "react-router";
import { BrandLockup } from "@app/components/BrandLockup";
import { PRODUCT_FRAME_CLASS } from "@app/lib/product-ui";
import { DarkModeToggle } from "./DarkModeToggle";

export function LandingLayout() {
  const currentYear = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b border-border/80 bg-background/88 backdrop-blur-xl">
        <div className={`${PRODUCT_FRAME_CLASS} flex h-16 items-center gap-5`}>
          <Link to="/" className="shrink-0 text-foreground transition-colors hover:text-primary">
            <BrandLockup />
          </Link>

          <nav
            className="ml-auto hidden items-center gap-1 sm:flex"
            aria-label="Documentation site"
          >
            <Link
              to="/#reading"
              className="rounded-lg px-3 py-2 text-sm text-foreground-muted transition-colors hover:bg-surface-elevated hover:text-foreground"
            >
              Reading
            </Link>
            <Link
              to="/#formats"
              className="rounded-lg px-3 py-2 text-sm text-foreground-muted transition-colors hover:bg-surface-elevated hover:text-foreground"
            >
              Formats
            </Link>
            <Link
              to="/tour"
              className="rounded-lg px-3 py-2 text-sm text-foreground-muted transition-colors hover:bg-surface-elevated hover:text-foreground"
            >
              Tour
            </Link>
            <Link
              to="/docs/getting-started"
              className="rounded-lg px-3 py-2 text-sm text-foreground-muted transition-colors hover:bg-surface-elevated hover:text-foreground"
            >
              Docs
            </Link>
          </nav>

          <DarkModeToggle />
          <a
            href="https://github.com/gabrielcsapo/Compendus"
            target="_blank"
            rel="noopener noreferrer"
            className="grid h-9 w-9 place-items-center rounded-full text-foreground-muted transition-colors hover:bg-surface-elevated hover:text-foreground"
            aria-label="Compendus on GitHub"
          >
            <GitHubIcon />
          </a>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-border bg-surface/60">
        <div
          className={`${PRODUCT_FRAME_CLASS} flex flex-col gap-7 py-9 sm:flex-row sm:items-end sm:justify-between`}
        >
          <div>
            <BrandLockup logoClassName="h-6 w-6" wordmarkClassName="h-5 w-auto" />
            <p className="mt-3 max-w-sm text-sm leading-6 text-foreground-muted">
              A self-hosted home for ebooks, audiobooks, and comics—designed around reading.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-foreground-muted">
            <Link to="/docs/getting-started" className="hover:text-foreground">
              Documentation
            </Link>
            <Link to="/tour" className="hover:text-foreground">
              Product tour
            </Link>
            <a href="https://github.com/gabrielcsapo/Compendus" className="hover:text-foreground">
              GitHub
            </a>
            <span className="font-mono text-xs">© {currentYear}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function GitHubIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0012 2z" />
    </svg>
  );
}
