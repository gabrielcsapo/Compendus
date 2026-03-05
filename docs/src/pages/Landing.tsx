import { Link } from "react-router";
import { CodeBlock } from "@app/components/docs";
import { CompendusLogo } from "@app/components/CompendusLogo";
import { ShowcaseBookCard } from "../components/ShowcaseBookCard";
import { mockBooks } from "../data/mockBooks";

const features = [
  {
    title: "Multi-Format Support",
    description:
      "Read and manage EPUB, PDF, MOBI, and AZW3 ebooks; CBZ and CBR comic archives; and M4B, M4A, and MP3 audiobooks.",
    icon: (
      <svg
        className="w-6 h-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
        />
      </svg>
    ),
  },
  {
    title: "Automatic Metadata",
    description:
      "Fetch book metadata, covers, and descriptions from Google Books and Open Library automatically.",
    icon: (
      <svg
        className="w-6 h-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
    ),
  },
  {
    title: "Reading Progress",
    description:
      "Track reading progress, create highlights with notes, bookmark pages, and log reading sessions.",
    icon: (
      <svg
        className="w-6 h-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
        />
      </svg>
    ),
  },
  {
    title: "iOS & Web",
    description:
      "Native iOS app with custom EPUB/PDF/CBZ comic reader engine plus a full-featured responsive web interface.",
    icon: (
      <svg
        className="w-6 h-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
        />
      </svg>
    ),
  },
  {
    title: "User Profiles",
    description:
      "Support multiple readers on one server with PIN-protected profiles, per-user reading progress, and easy account switching on web and iOS.",
    icon: (
      <svg
        className="w-6 h-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
        />
      </svg>
    ),
  },
  {
    title: "Full-Text Search",
    description:
      "Search across titles, authors, descriptions, and optionally within book content itself.",
    icon: (
      <svg
        className="w-6 h-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
    ),
  },
  {
    title: "Collections & Tags",
    description:
      "Organize your library with hierarchical collections, color-coded tags, and series tracking.",
    icon: (
      <svg
        className="w-6 h-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
        />
      </svg>
    ),
  },
  {
    title: "Audiobook Transcription",
    description:
      "Transcribe audiobooks to searchable text with word-level timestamps using whisper.cpp — on the server or on-device on iOS.",
    icon: (
      <svg
        className="w-6 h-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
        />
      </svg>
    ),
  },
  {
    title: "Text-to-Speech",
    description:
      "Read EPUBs aloud with sentence highlighting on the web or neural TTS with karaoke-style word tracking on iOS.",
    icon: (
      <svg
        className="w-6 h-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
        />
      </svg>
    ),
  },
];

const formats = [
  { ext: "EPUB", type: "ebook" },
  { ext: "PDF", type: "ebook" },
  { ext: "MOBI", type: "ebook" },
  { ext: "AZW3", type: "ebook" },
  { ext: "CBZ", type: "comic" },
  { ext: "CBR", type: "comic" },
  { ext: "M4B", type: "audio" },
  { ext: "M4A", type: "audio" },
  { ext: "MP3", type: "audio" },
];

const typeTabs = [
  {
    label: "All",
    icon: null,
  },
  {
    label: "Ebooks",
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
  },
  {
    label: "Audiobooks",
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15.536a5 5 0 001.414 1.414m2.828-9.9a9 9 0 012.828-2.828" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15.5V9" />
      </svg>
    ),
  },
  {
    label: "Comics",
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
    ),
  },
];

const fakeNavItems = [
  "Library",
  "Collections",
  "Tags",
  "Highlights",
  "Discover",
];

export default function Landing() {
  return (
    <div>
      {/* Hero */}
      <section className="py-20 sm:py-28 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-5xl sm:text-6xl font-bold text-foreground tracking-tight mb-6">
            Your personal
            <br />
            <span className="text-primary">digital library</span>
          </h1>
          <p className="text-lg sm:text-xl text-foreground-muted max-w-2xl mx-auto mb-10">
            A self-hosted library manager for ebooks, audiobooks, and comics.
            Upload, organize, and read across web and iOS with automatic
            metadata, full-text search, and reading progress tracking.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              to="/docs/getting-started"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-lg font-medium hover:bg-primary-hover transition-colors shadow-button"
            >
              Get Started
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                />
              </svg>
            </Link>
            <Link
              to="/docs/architecture"
              className="inline-flex items-center gap-2 px-6 py-3 bg-surface border border-border text-foreground rounded-lg font-medium hover:bg-surface-elevated transition-colors"
            >
              How It Works
            </Link>
            <a
              href="https://github.com/gabrielcsapo/compendus"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 bg-surface border border-border text-foreground rounded-lg font-medium hover:bg-surface-elevated transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Profile Picker Preview */}
      <section className="pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-semibold text-foreground text-center mb-2">
            Multi-User Profiles
          </h2>
          <p className="text-foreground-muted text-center mb-8 max-w-xl mx-auto">
            Share one server with the whole family. Each reader gets their own
            library, reading progress, and highlights — with optional PIN
            protection.
          </p>

          {/* Mock profile picker window */}
          <div className="border border-border rounded-xl overflow-hidden shadow-xl bg-surface">
            {/* Faux window chrome */}
            <div className="border-b border-border bg-surface px-4 py-2.5 flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-danger/60" />
                <div className="w-3 h-3 rounded-full bg-warning/60" />
                <div className="w-3 h-3 rounded-full bg-success/60" />
              </div>
              <div className="flex items-center gap-0.5 ml-4">
                <CompendusLogo className="w-5 h-5 text-primary" />
                <span className="text-sm font-bold text-primary ml-1.5">
                  Compendus
                </span>
              </div>
            </div>

            {/* Profile picker content */}
            <div className="bg-background px-6 py-16 sm:py-20 flex flex-col items-center">
              <h3 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">
                Who&apos;s reading?
              </h3>
              <p className="text-sm text-foreground-muted mb-10">
                Select your profile to continue
              </p>

              {/* Profile cards */}
              <div className="flex flex-wrap justify-center gap-8">
                {/* Profile 1 — Admin */}
                <div className="flex flex-col items-center gap-3">
                  <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-surface-elevated border-2 border-primary shadow-lg flex items-center justify-center text-4xl transition-transform hover:scale-105">
                    <span>📚</span>
                    {/* Admin badge */}
                    <div className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-primary flex items-center justify-center">
                      <svg
                        className="w-3.5 h-3.5 text-white"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                        />
                      </svg>
                    </div>
                  </div>
                  <span className="text-sm font-medium text-foreground">
                    Bob
                  </span>
                </div>

                {/* Profile 2 — PIN-protected */}
                <div className="flex flex-col items-center gap-3">
                  <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-surface-elevated border-2 border-border flex items-center justify-center text-4xl transition-transform hover:scale-105 hover:border-primary hover:shadow-lg">
                    <span>🌸</span>
                    {/* Lock badge */}
                    <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-surface border-2 border-border flex items-center justify-center">
                      <svg
                        className="w-3.5 h-3.5 text-foreground-muted"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                        />
                      </svg>
                    </div>
                  </div>
                  <span className="text-sm font-medium text-foreground-muted">
                    Sarah
                  </span>
                </div>

                {/* Profile 3 — plain */}
                <div className="flex flex-col items-center gap-3">
                  <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-surface-elevated border-2 border-border flex items-center justify-center text-4xl transition-transform hover:scale-105 hover:border-primary hover:shadow-lg">
                    <span>🚀</span>
                  </div>
                  <span className="text-sm font-medium text-foreground-muted">
                    Alex
                  </span>
                </div>

                {/* Add Profile */}
                <div className="flex flex-col items-center gap-3">
                  <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full border-2 border-dashed border-border flex items-center justify-center transition-transform hover:scale-105 hover:border-primary">
                    <svg
                      className="w-10 h-10 text-foreground-muted"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-foreground-muted">
                    Add Profile
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* App Preview — mock app shell */}
      <section id="preview" className="pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-semibold text-foreground text-center mb-2">
            Your Library, Your Way
          </h2>
          <p className="text-foreground-muted text-center mb-8 max-w-xl mx-auto">
            Browse and organize your personal library with filtering, sorting,
            and multiple view modes.
          </p>

          {/* Mock app window */}
          <div className="border border-border rounded-xl overflow-hidden shadow-xl bg-surface">
            {/* Faux app header */}
            <div className="border-b border-border bg-surface px-4 py-2.5 flex items-center gap-4">
              {/* Window dots */}
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-danger/60" />
                <div className="w-3 h-3 rounded-full bg-warning/60" />
                <div className="w-3 h-3 rounded-full bg-success/60" />
              </div>

              {/* Faux nav */}
              <div className="flex items-center gap-0.5 ml-4">
                <CompendusLogo className="w-5 h-5 text-primary" />
                <span className="text-sm font-bold text-primary ml-1.5 mr-3">
                  Compendus
                </span>
                {fakeNavItems.map((item, i) => (
                  <span
                    key={item}
                    className={`hidden sm:inline px-2.5 py-1.5 text-xs rounded-lg font-medium ${
                      i === 0
                        ? "text-foreground"
                        : "text-foreground-muted hover:text-foreground"
                    }`}
                  >
                    {item}
                  </span>
                ))}
              </div>

              <div className="flex-1" />

              {/* Faux search */}
              <div className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 bg-surface-elevated border border-border rounded-lg text-xs text-foreground-muted">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                Search
                <kbd className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-mono bg-background rounded border border-border">
                  <span>⌘</span>K
                </kbd>
              </div>

              {/* Faux dark mode toggle */}
              <span className="hidden sm:flex p-1.5 rounded-lg text-foreground-muted">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              </span>

              {/* Faux admin icon */}
              <span className="hidden sm:flex p-1.5 rounded-lg text-foreground-muted">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </span>
            </div>

            {/* Faux content area */}
            <div className="p-4 sm:p-6 bg-background">
              {/* Toolbar row: view toggle + type tabs + sort */}
              <div className="flex flex-wrap items-center gap-2 mb-5">
                {/* View mode toggle */}
                <div className="inline-flex gap-0.5 p-0.5 bg-surface-elevated rounded-lg">
                  <span className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md bg-primary text-white shadow-sm">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    Books
                  </span>
                  <span className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md text-foreground-muted">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    Series
                  </span>
                </div>

                {/* Type tabs */}
                <div className="inline-flex gap-0.5 p-0.5 bg-surface-elevated rounded-lg">
                  {typeTabs.map((tab, i) => (
                    <span
                      key={tab.label}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                        i === 0
                          ? "bg-primary text-white shadow-sm"
                          : "text-foreground-muted"
                      }`}
                    >
                      {tab.icon}
                      {tab.label}
                    </span>
                  ))}
                </div>

                {/* Sort dropdown (faux) */}
                <div className="ml-auto hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 border border-border rounded-lg text-[11px] text-foreground-muted bg-surface">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
                  </svg>
                  Recent
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* Book grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
                {mockBooks.map((book) => (
                  <ShowcaseBookCard key={book.title} book={book} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section
        id="features"
        className="py-20 px-4 sm:px-6 lg:px-8 bg-surface-elevated/50"
      >
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-semibold text-foreground text-center mb-2">
            Everything you need
          </h2>
          <p className="text-foreground-muted text-center mb-10 max-w-xl mx-auto">
            A complete solution for managing your personal digital library.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="p-6 bg-surface border border-border rounded-xl"
              >
                <div className="w-10 h-10 bg-primary-light text-primary rounded-lg flex items-center justify-center mb-4">
                  {feature.icon}
                </div>
                <h3 className="font-semibold text-foreground mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-foreground-muted leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Reader Preview */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-semibold text-foreground text-center mb-2">
            Beautiful Reading Experience
          </h2>
          <p className="text-foreground-muted text-center mb-8 max-w-xl mx-auto">
            A custom-built reader with themes, highlights, bookmarks, and
            progress tracking.
          </p>

          {/* Mock reader window */}
          <div className="border border-border rounded-xl overflow-hidden shadow-xl">
            {/* Reader toolbar */}
            <div className="bg-surface border-b border-border px-4 py-2.5 flex items-center gap-3">
              <span className="p-1 text-foreground-muted">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </span>
              <span className="p-1 text-foreground-muted">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              </span>
              <div className="flex-1 text-center">
                <span className="text-sm font-medium text-foreground">
                  Chapter 1: The Beginning
                </span>
              </div>
              <span className="text-xs text-foreground-muted">14 / 312</span>
              <span className="p-1 text-foreground-muted">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
                  />
                </svg>
              </span>
              <span className="p-1 text-foreground-muted">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </span>
            </div>

            {/* Reader content */}
            <div className="bg-background px-8 sm:px-16 py-12 sm:py-16 min-h-[300px]">
              <p className="text-foreground leading-[1.8] text-base sm:text-lg font-serif max-w-prose mx-auto">
                <span className="text-5xl font-bold float-left mr-3 mt-1 leading-none text-primary">
                  I
                </span>
                t was a bright cold day in April, and the clocks were striking
                thirteen. Winston Smith, his chin nuzzled into his breast in an
                effort to escape the vile wind, slipped quickly through the
                glass doors of Victory Mansions, though not quickly enough to
                prevent a swirl of gritty dust from entering along with him.
              </p>
              <p className="text-foreground leading-[1.8] text-base sm:text-lg font-serif max-w-prose mx-auto mt-6">
                The hallway smelt of boiled cabbage and old rag mats. At one end
                of it a coloured poster, too large for indoor display, had been
                tacked to the wall. It depicted simply an enormous face, more
                than a metre wide: the face of a man of about forty-five, with a
                heavy black moustache and ruggedly handsome features.
              </p>
              {/* Simulated highlight */}
              <p className="text-foreground leading-[1.8] text-base sm:text-lg font-serif max-w-prose mx-auto mt-6">
                <span className="bg-yellow-200/40 dark:bg-yellow-500/20 rounded px-0.5">
                  The telescreen received and transmitted simultaneously. Any
                  sound that Winston made, above the level of a very low
                  whisper, would be picked up by it.
                </span>
              </p>
            </div>

            {/* Reader footer */}
            <div className="bg-surface border-t border-border px-4 py-3 flex items-center gap-3">
              <span className="text-xs text-foreground-muted shrink-0">
                Ch 1
              </span>
              <div className="flex-1 h-1.5 bg-surface-elevated rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
                  style={{ width: "4.5%" }}
                />
              </div>
              <span className="text-xs text-foreground-muted shrink-0">4%</span>
            </div>
          </div>
        </div>
      </section>

      {/* Audio & Speech Preview */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-surface-elevated/50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-semibold text-foreground text-center mb-2">
            Listen, Read Along, Transcribe
          </h2>
          <p className="text-foreground-muted text-center mb-8 max-w-xl mx-auto">
            Turn audiobooks into searchable text with word-level timestamps, or
            have your EPUBs read aloud with synchronized highlighting.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Mock Audiobook Player — dark, lyrics-first like the real iOS app */}
            <div className="rounded-xl overflow-hidden shadow-xl flex flex-col bg-gradient-to-b from-stone-900 to-stone-950 border border-white/10">
              {/* Title */}
              <div className="px-5 pt-5 pb-2 text-center">
                <h3 className="text-white font-semibold text-base">Dune</h3>
              </div>

              {/* Karaoke lyrics — main content area */}
              <div className="px-5 py-4 flex-1 space-y-3">
                <p className="text-sm leading-relaxed text-white/40">
                  &ldquo;It was wonderful,&rdquo; Howatt had said.
                </p>
                <p className="text-sm leading-relaxed text-white/40">
                  &ldquo;Arrakis, dune, desert planet.&rdquo;
                </p>
                <p className="text-sm leading-relaxed">
                  <span className="text-white font-semibold">
                    Paul fell asleep , to dream of
                  </span>{" "}
                  <span className="text-white/50">
                    an Ar ach ene cavern , silent people all around him moving
                  </span>
                </p>
                <p className="text-sm leading-relaxed text-white/30">
                  in the dim light of glow-globes.
                </p>
                <p className="text-sm leading-relaxed text-white/30">
                  It was solemn there, and like a cathedral, as he listened to a
                  faint sound, the drip,
                </p>
                <p className="text-sm leading-relaxed text-white/30">
                  drip, drip of water.
                </p>
                <p className="text-sm leading-relaxed text-white/25">
                  While he remained in the dream Paul knew he would remember it
                  upon awakening.
                </p>
                <p className="text-sm leading-relaxed text-white/20">
                  He always remembered the dreams that were predictions.
                </p>
                <p className="text-sm leading-relaxed text-white/15">
                  The dream faded.
                </p>
              </div>

              {/* Floating transcription pill */}
              <div className="px-5 pb-3 flex justify-center">
                <span className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-white/10 backdrop-blur rounded-full text-xs text-white/70">
                  <svg className="w-3.5 h-3.5 text-white/50 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  Transcribing
                  <span className="text-white/40">0% complete</span>
                  <svg className="w-3 h-3 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </span>
              </div>

              {/* Audio controls bar */}
              <div className="px-5 pb-4 pt-1">
                {/* Scrubber */}
                <div className="mb-2">
                  <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-white/50 rounded-full"
                      style={{ width: "2%" }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-white/40 font-mono mt-1">
                    <span>6:13</span>
                    <span>-22:41:20</span>
                  </div>
                </div>

                {/* Transport controls */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-white/40 font-mono w-8">
                    1x
                  </span>
                  <div className="flex items-center gap-4">
                    {/* Skip back 15s */}
                    <span className="text-white/50">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
                      </svg>
                    </span>
                    {/* Stop */}
                    <span className="w-8 h-8 bg-white/15 rounded-full flex items-center justify-center">
                      <svg className="w-3.5 h-3.5 text-white/70" fill="currentColor" viewBox="0 0 24 24">
                        <rect x="6" y="6" width="12" height="12" rx="1" />
                      </svg>
                    </span>
                    {/* Pause */}
                    <span className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                      </svg>
                    </span>
                    {/* Skip forward 15s — intentionally omitted for space */}
                  </div>
                  {/* Mic / transcript toggle */}
                  <span className="text-white/50">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  </span>
                </div>
              </div>
            </div>

            {/* Mock Read-Aloud EPUB View — light reader, dark TTS bar */}
            <div className="border border-border rounded-xl overflow-hidden shadow-xl bg-surface flex flex-col">
              {/* Reader header */}
              <div className="bg-surface border-b border-border px-4 py-2.5 flex items-center gap-3">
                <span className="p-1 text-foreground-muted">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </span>
                <span className="p-1 text-foreground-muted">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </span>
                <div className="flex-1 text-center">
                  <span className="text-sm font-medium text-foreground">
                    Chapter 1
                  </span>
                </div>
                <span className="text-xs text-foreground-muted">3 / 180</span>
                <span className="p-1 text-foreground-muted">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </span>
              </div>

              {/* Reader content with TTS sentence highlighting */}
              <div className="bg-background px-6 sm:px-10 py-8 sm:py-10 flex-1">
                <p className="text-foreground leading-[1.8] text-sm sm:text-base font-serif max-w-prose mx-auto">
                  <span className="text-4xl font-bold float-left mr-2.5 mt-0.5 leading-none text-primary">
                    I
                  </span>
                  n my younger and more vulnerable years my father gave me some
                  advice that I&apos;ve been turning over in my mind ever since.
                </p>
                <p className="text-foreground leading-[1.8] text-sm sm:text-base font-serif max-w-prose mx-auto mt-4">
                  <span className="bg-accent/15 rounded px-0.5 py-0.5">
                    &ldquo;Whenever you feel like criticizing anyone,&rdquo; he
                    told me, &ldquo;just remember that all the people in this
                    world haven&apos;t had the advantages that you&apos;ve
                    had.&rdquo;
                  </span>
                </p>
                <p className="text-foreground leading-[1.8] text-sm sm:text-base font-serif max-w-prose mx-auto mt-4">
                  He didn&apos;t say any more, but we&apos;ve always been
                  unusually communicative in a reserved way, and I understood
                  that he meant a great deal more than that.
                </p>
              </div>

              {/* Dark TTS control bar — matches audiobook player style */}
              <div className="bg-gradient-to-r from-stone-900 to-stone-950 px-5 py-3 rounded-b-xl">
                {/* Scrubber */}
                <div className="mb-2">
                  <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-white/50 rounded-full"
                      style={{ width: "14%" }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-white/40 font-mono mt-1">
                    <span>0:34</span>
                    <span>-3:52</span>
                  </div>
                </div>

                {/* Transport controls */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-white/40 font-mono w-8">
                    1x
                  </span>
                  <div className="flex items-center gap-4">
                    {/* Skip back */}
                    <span className="text-white/50">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
                      </svg>
                    </span>
                    {/* Circular progress + sentence count */}
                    <span className="relative w-10 h-10 flex items-center justify-center">
                      <svg className="absolute inset-0 w-10 h-10 -rotate-90" viewBox="0 0 36 36">
                        <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
                        <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeDasharray="100.53" strokeDashoffset={100.53 * (1 - 2 / 14)} strokeLinecap="round" />
                      </svg>
                      <span className="text-[9px] font-mono text-white/70 font-semibold">
                        2/14
                      </span>
                    </span>
                    {/* Pause */}
                    <span className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                      </svg>
                    </span>
                    {/* Skip forward */}
                    <span className="text-white/50">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" />
                      </svg>
                    </span>
                  </div>
                  {/* Voice label */}
                  <span className="text-[10px] text-white/40 w-8 text-right truncate">
                    Voice 3
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Capability pills */}
          <div className="flex flex-wrap justify-center gap-3 mt-8">
            {[
              { label: "Whisper.cpp Transcription", icon: "M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" },
              { label: "Word-Level Timestamps", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
              { label: "On-Device Processing", icon: "M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" },
              { label: "8 Neural Voices", icon: "M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" },
              { label: "Background Pre-Generation", icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" },
            ].map((pill) => (
              <span
                key={pill.label}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border rounded-lg text-xs font-medium text-foreground-muted"
              >
                <svg className="w-3.5 h-3.5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={pill.icon} />
                </svg>
                {pill.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Supported Formats */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl font-semibold text-foreground mb-2">
            Supported Formats
          </h2>
          <p className="text-foreground-muted mb-8">
            Access anything in your digital collection.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {formats.map((f) => (
              <span
                key={f.ext}
                className={`px-4 py-2 rounded-lg text-sm font-mono font-medium border ${
                  f.type === "audio"
                    ? "bg-accent-light text-accent border-accent/20"
                    : f.type === "comic"
                      ? "bg-warning-light text-warning border-warning/20"
                      : "bg-primary-light text-primary border-primary/20"
                }`}
              >
                .{f.ext.toLowerCase()}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Developer Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-surface-elevated/50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-semibold text-foreground text-center mb-2">
            Easy to Query
          </h2>
          <p className="text-foreground-muted text-center mb-8">
            A clean REST API you can query from anywhere — scripts, automations,
            or your own tools.
          </p>
          <CodeBlock language="bash">{`# List all books in your library
curl http://localhost:3000/api/books | jq

# Search by title or author
curl "http://localhost:3000/api/search?q=dune"

# Upload a new book
curl -X POST http://localhost:3000/api/upload \\
  -F "file=@./my-book.epub"

# Get book details
curl http://localhost:3000/api/books/42`}</CodeBlock>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-foreground mb-4">
            Ready to build your library?
          </h2>
          <p className="text-foreground-muted mb-8">
            Get Compendus running locally in minutes. Self-hosted, open source,
            and completely free.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              to="/docs/getting-started"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-lg font-medium hover:bg-primary-hover transition-colors shadow-button"
            >
              Get Started
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                />
              </svg>
            </Link>
            <a
              href="https://github.com/gabrielcsapo/compendus"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 bg-surface border border-border text-foreground rounded-lg font-medium hover:bg-surface-elevated transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              View on GitHub
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
