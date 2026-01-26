import "./styles.css";
import { Link, Outlet } from "react-router";
import { DumpError, GlobalNavigationLoadingBar } from "./routes/root.client";
import { SearchCommandPalette } from "./components/SearchCommandPalette";
import { DarkModeToggle } from "./components/DarkModeToggle.js";
import { GlobalUploadDropzone } from "./components/GlobalUploadDropzone";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Compendus - Personal Library</title>
        {/* Prevent flash of wrong theme */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function() {
              const theme = localStorage.getItem('theme');
              if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                document.documentElement.classList.add('dark');
              }
            })();`,
          }}
        />
        {/* Google Fonts - Inter */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <header className="sticky top-0 z-40 backdrop-blur-md bg-background/80 border-b border-border">
          <nav className="container px-6 py-4 mx-auto">
            <ul className="flex gap-2 flex-wrap items-center">
              <li className="font-bold text-xl mr-4">
                <Link
                  to="/"
                  className="text-primary hover:text-primary-hover transition-colors flex items-center gap-2"
                >
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                    />
                  </svg>
                  Compendus
                </Link>
              </li>
              <li>
                <Link
                  to="/"
                  className="px-3 py-2 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors font-medium"
                >
                  Library
                </Link>
              </li>
              <li>
                <Link
                  to="/collections"
                  className="px-3 py-2 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors font-medium"
                >
                  Collections
                </Link>
              </li>
              <li>
                <Link
                  to="/tags"
                  className="px-3 py-2 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors font-medium"
                >
                  Tags
                </Link>
              </li>
              <li className="ml-auto">
                <DarkModeToggle />
              </li>
            </ul>
          </nav>
        </header>
        <GlobalNavigationLoadingBar />
        <SearchCommandPalette />
        <GlobalUploadDropzone />
        {children}
      </body>
    </html>
  );
}

export default function Component() {
  return (
    <>
      <Outlet />
    </>
  );
}

export function ErrorBoundary() {
  return <DumpError />;
}
