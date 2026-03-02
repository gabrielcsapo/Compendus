import { NavLink, Link } from "react-router";

const navItems = [
  {
    section: "Overview",
    links: [
      { to: "/docs/getting-started", label: "Getting Started" },
      { to: "/docs/architecture", label: "Architecture" },
    ],
  },
  {
    section: "Reference",
    links: [
      { to: "/docs/api", label: "API Reference" },
      { to: "/docs/formats", label: "Supported Formats" },
      { to: "/docs/audio-speech", label: "Audio & Speech" },
    ],
  },
  {
    section: "Platforms",
    links: [{ to: "/docs/ios", label: "iOS App" }],
  },
];

function linkClass({ isActive }: { isActive: boolean }) {
  return `block px-3 py-1.5 rounded-md text-sm transition-colors ${
    isActive
      ? "bg-primary-light text-primary font-medium"
      : "text-foreground-muted hover:text-foreground hover:bg-surface-elevated"
  }`;
}

export function Sidebar({
  onNavigate,
}: {
  onNavigate?: () => void;
}) {
  return (
    <nav className="space-y-6">
      {/* Back to home */}
      <Link
        to="/"
        onClick={onNavigate}
        className="flex items-center gap-2 px-3 py-1.5 text-sm text-foreground-muted hover:text-foreground rounded-md hover:bg-surface-elevated transition-colors"
      >
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
            d="M10 19l-7-7m0 0l7-7m-7 7h18"
          />
        </svg>
        Home
      </Link>

      {navItems.map((group) => (
        <div key={group.section}>
          <h3 className="px-3 text-xs font-semibold uppercase tracking-wider text-foreground-muted mb-2">
            {group.section}
          </h3>
          <ul className="space-y-1">
            {group.links.map((link) => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  className={linkClass}
                  onClick={onNavigate}
                >
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div>
        <h3 className="px-3 text-xs font-semibold uppercase tracking-wider text-foreground-muted mb-2">
          Links
        </h3>
        <ul className="space-y-1">
          <li>
            <a
              href="https://github.com/gabrielcsapo/compendus"
              target="_blank"
              rel="noopener noreferrer"
              className="block px-3 py-1.5 rounded-md text-sm text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors"
            >
              GitHub
              <svg className="inline-block w-3 h-3 ml-1 -mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </li>
        </ul>
      </div>
    </nav>
  );
}
