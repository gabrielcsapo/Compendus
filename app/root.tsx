import "./styles.css";
import { Link, Outlet } from "react-router";
import { DumpError, GlobalNavigationLoadingBar } from "./routes/root.client";
import { SearchCommandPalette } from "./components/SearchCommandPalette";
import { DarkModeToggle } from "./components/DarkModeToggle.js";
import { GlobalUploadDropzone } from "./components/GlobalUploadDropzone";
import { SearchInput } from "./components/SearchInput";
import { Footer } from "./components/Footer";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Compendus - Personal Library</title>
        <link
          rel="icon"
          type="image/png"
          href="/favicon-96x96.png"
          sizes="96x96"
        />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="shortcut icon" href="/favicon.ico" />
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href="/apple-touch-icon.png"
        />
        <link rel="manifest" href="/site.webmanifest" />
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
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen flex flex-col">
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
                    viewBox="0 0 64 64"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <rect x="14" y="10" width="38" height="44" rx="6" fill="currentColor"/>
                    <rect x="18" y="14" width="26" height="36" rx="3" fill="rgba(255,255,255,0.15)"/>
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
              <li>
                <Link
                  to="/discover"
                  className="px-3 py-2 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors font-medium"
                >
                  Discover
                </Link>
              </li>
              <li className="ml-auto">
                <SearchInput />
              </li>
              <li>
                <DarkModeToggle />
              </li>
            </ul>
          </nav>
        </header>
        <GlobalNavigationLoadingBar />
        <SearchCommandPalette />
        <GlobalUploadDropzone />
        <div className="flex-1">{children}</div>
        <Footer />
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
