import { Link } from "react-router";

interface FooterProps {
  variant?: "full" | "compact";
}

export function Footer({ variant = "full" }: FooterProps) {
  const currentYear = new Date().getFullYear();

  if (variant === "compact") {
    return (
      <footer className="border-t border-border mt-auto">
        <div className="container mx-auto px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-foreground-muted">
            <div className="flex items-center gap-4">
              <Link
                to="/"
                className="font-semibold text-foreground hover:text-primary transition-colors"
              >
                Compendus
              </Link>
              <span>·</span>
              <span>Personal Library Manager</span>
            </div>
            <div className="flex items-center gap-4">
              <Link
                to="/docs"
                className="hover:text-foreground transition-colors"
              >
                API Docs
              </Link>
              <a
                href="https://github.com/gabrielcsapo/Compendus"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors"
              >
                GitHub
              </a>
              <span>© {currentYear}</span>
            </div>
          </div>
        </div>
      </footer>
    );
  }

  return (
    <footer className="border-t border-border mt-auto bg-surface">
      <div className="container mx-auto px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link
              to="/"
              className="flex items-center gap-2 text-foreground hover:text-primary transition-colors mb-4"
            >
              <svg
                className="w-6 h-6"
                viewBox="0 0 64 64"
              >
                <rect x="14" y="10" width="38" height="44" rx="6" fill="currentColor"/>
                <rect x="18" y="14" width="26" height="36" rx="3" fill="rgba(255,255,255,0.15)"/>
              </svg>
              <span className="font-bold text-lg">Compendus</span>
            </Link>
            <p className="text-sm text-foreground-muted">
              Self-hosted personal library manager for ebooks, audiobooks, and
              comics.
            </p>
          </div>

          {/* Navigation */}
          <div>
            <h3 className="font-semibold text-foreground mb-4">Library</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  to="/"
                  className="text-foreground-muted hover:text-foreground transition-colors"
                >
                  Browse Books
                </Link>
              </li>
              <li>
                <Link
                  to="/collections"
                  className="text-foreground-muted hover:text-foreground transition-colors"
                >
                  Collections
                </Link>
              </li>
              <li>
                <Link
                  to="/tags"
                  className="text-foreground-muted hover:text-foreground transition-colors"
                >
                  Tags
                </Link>
              </li>
              <li>
                <Link
                  to="/discover"
                  className="text-foreground-muted hover:text-foreground transition-colors"
                >
                  Discover
                </Link>
              </li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="font-semibold text-foreground mb-4">Resources</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  to="/docs"
                  className="text-foreground-muted hover:text-foreground transition-colors"
                >
                  API Documentation
                </Link>
              </li>
              <li>
                <Link
                  to="/admin.data"
                  className="text-foreground-muted hover:text-foreground transition-colors"
                >
                  Data Administration
                </Link>
              </li>
            </ul>
          </div>

          {/* Community */}
          <div>
            <h3 className="font-semibold text-foreground mb-4">Community</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <a
                  href="https://github.com/gabrielcsapo/Compendus"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground-muted hover:text-foreground transition-colors inline-flex items-center gap-1.5"
                >
                  <svg
                    className="w-4 h-4"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      fillRule="evenodd"
                      clipRule="evenodd"
                      d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0012 2z"
                    />
                  </svg>
                  GitHub
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/gabrielcsapo/Compendus/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground-muted hover:text-foreground transition-colors"
                >
                  Report an Issue
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-12 pt-8 border-t border-border flex flex-wrap items-center justify-between gap-4 text-sm text-foreground-muted">
          <p>© {currentYear} Compendus. Open source software.</p>
          <p className="font-mono text-xs">Self-hosted personal library</p>
        </div>
      </div>
    </footer>
  );
}
