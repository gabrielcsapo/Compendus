export default function ErrorBoundary({ error }: { error?: unknown; params?: Record<string, string> }) {
  const message =
    error instanceof Error ? (
      <div>
        <pre className="whitespace-pre-wrap text-sm">
          {JSON.stringify(
            {
              ...error,
              name: error.name,
              message: error.message,
            },
            null,
            2,
          )}
        </pre>
        {error.stack && <pre className="whitespace-pre-wrap text-xs mt-4 text-foreground-muted">{error.stack}</pre>}
      </div>
    ) : (
      <div>Unknown Error</div>
    );
  return (
    <main className="container my-8 px-6 mx-auto">
      <h1 className="text-2xl font-bold text-foreground mb-4">Something went wrong</h1>
      <div className="bg-surface border border-border rounded-xl p-6">{message}</div>
    </main>
  );
}
