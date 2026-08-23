import { Suspense } from "react";
import { Link } from "react-flight-router/client";
import { getCollections, getCollectionBookCounts } from "../actions/collections";
import { CreateCollectionButton } from "../components/CreateCollectionModal";

export default function Collections() {
  return (
    <Suspense fallback={<CollectionsSkeleton />}>
      <CollectionsData />
    </Suspense>
  );
}

async function CollectionsData() {
  const collections = await getCollections();
  // Batch-fetch all book counts in a single query instead of N+1
  const counts = await getCollectionBookCounts(collections.map((c) => c.id));

  return (
    <main className="mx-auto my-10 w-full max-w-[90rem] px-5 sm:my-14 sm:px-8 lg:px-11">
      <div className="mb-10 flex items-end justify-between gap-6 border-b border-border pb-8">
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
            {collections.length} {collections.length === 1 ? "collection" : "collections"}
          </p>
          <h1 className="text-5xl font-extrabold leading-[.95] tracking-[-.06em] text-foreground sm:text-6xl">
            Keep good books close.
          </h1>
          <p className="mt-3 text-base text-foreground-muted">
            Quiet shelves for themes, projects, and books worth returning to.
          </p>
        </div>
        <CreateCollectionButton />
      </div>

      {collections.length > 0 ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((collection) => {
            const bookCount = counts.get(collection.id) ?? 0;
            return (
              <Link
                key={collection.id}
                to={`/collection/${collection.id}`}
                className="group relative min-h-44 overflow-hidden rounded-[1.35rem] border border-border bg-surface p-7 shadow-[0_1px_2px_rgba(23,32,28,.04)] transition-all duration-300 hover:-translate-y-1 hover:border-border-hover hover:shadow-[0_18px_42px_rgba(23,32,28,.09)]"
              >
                <div
                  className="absolute inset-y-0 left-0 w-1.5"
                  style={{ backgroundColor: collection.color || "var(--color-primary)" }}
                />
                <div className="flex h-full flex-col justify-between">
                  <div className="mb-6 flex items-center gap-3">
                    {collection.icon && <span className="text-xl">{collection.icon}</span>}
                    <h3 className="text-xl font-bold tracking-[-0.025em] text-foreground transition-colors group-hover:text-primary">
                      {collection.name}
                    </h3>
                  </div>
                  {collection.description && (
                    <p className="mb-5 line-clamp-2 text-sm leading-relaxed text-foreground-muted">
                      {collection.description}
                    </p>
                  )}
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground-muted">
                    {bookCount} {bookCount === 1 ? "book" : "books"}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-16 bg-surface border border-border rounded-xl">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-elevated flex items-center justify-center">
            <svg
              className="w-8 h-8 text-foreground-muted"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            </svg>
          </div>
          <p className="text-foreground-muted mb-2">No collections yet</p>
          <p className="text-foreground-muted/60 text-sm">
            Create a collection to organize your books
          </p>
        </div>
      )}
    </main>
  );
}

function CollectionsSkeleton() {
  return (
    <main className="container my-8 px-6 mx-auto animate-pulse">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="h-8 bg-surface-elevated rounded w-40 mb-2" />
          <div className="h-4 bg-surface-elevated rounded w-24" />
        </div>
        <div className="h-10 bg-surface-elevated rounded w-36" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="h-2 bg-surface-elevated" />
            <div className="p-5 space-y-3">
              <div className="h-5 bg-surface-elevated rounded w-3/4" />
              <div className="h-4 bg-surface-elevated rounded w-full" />
              <div className="h-4 bg-surface-elevated rounded w-16" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
