import { Link } from "react-flight-router/client";

export default function NotFound() {
  return (
    <main className="container my-8 px-6 mx-auto">
      <div className="text-center py-16">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-elevated flex items-center justify-center">
          <svg className="w-8 h-8 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Page Not Found</h1>
        <p className="text-foreground-muted mb-6">The page you're looking for doesn't exist.</p>
        <Link to="/" className="px-4 py-2 rounded-lg bg-primary text-white font-medium hover:bg-primary-hover transition-colors">
          Back to Library
        </Link>
      </div>
    </main>
  );
}
