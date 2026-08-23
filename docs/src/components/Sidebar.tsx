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
  return `block rounded-lg px-3 py-2 text-sm transition-colors ${
    isActive
      ? "bg-primary-light text-primary font-medium"
      : "text-foreground-muted hover:text-foreground hover:bg-surface-elevated"
  }`;
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-8" aria-label="Documentation">
      {/* Back to home */}
      <Link
        to="/"
        onClick={onNavigate}
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground-muted transition-colors hover:bg-surface-elevated hover:text-foreground"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        Product overview
      </Link>

      {navItems.map((group) => (
        <div key={group.section}>
          <h3 className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-primary-muted">
            {group.section}
          </h3>
          <ul className="space-y-1">
            {group.links.map((link) => (
              <li key={link.to}>
                <NavLink to={link.to} className={linkClass} onClick={onNavigate}>
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
