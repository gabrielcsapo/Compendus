"use client";

import { Link, useNavigation } from "react-flight-router/client";
import { SearchCommandPalette } from "./SearchCommandPalette";
import { DarkModeToggle } from "./DarkModeToggle";
import { GlobalUploadDropzone } from "./GlobalUploadDropzone";
import { SearchInput } from "./SearchInput";
import { Footer } from "./Footer";

function GlobalNavigationLoadingBar() {
  const navigation = useNavigation();

  if (navigation.state === "idle") return null;

  return (
    <div className="h-1 w-full bg-primary-light overflow-hidden fixed top-0 left-0 z-50 opacity-50">
      <div className="animate-progress origin-[0%_50%] w-full h-full bg-primary" />
    </div>
  );
}

export function ClientShell({ children }: { children: React.ReactNode }) {
  return (
    <>
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
                to="/highlights"
                className="px-3 py-2 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors font-medium"
              >
                Highlights
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
            <li>
              <Link
                to="/admin"
                className="p-2 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors"
                title="Admin"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </Link>
            </li>
          </ul>
        </nav>
      </header>
      <GlobalNavigationLoadingBar />
      <SearchCommandPalette />
      <GlobalUploadDropzone />
      <div className="flex-1">{children}</div>
      <Footer />
    </>
  );
}
