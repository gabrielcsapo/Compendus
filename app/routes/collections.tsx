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
    <main className="container my-8 px-6 mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Collections</h1>
          <p className="text-foreground-muted">
            {collections.length} {collections.length === 1 ? "collection" : "collections"}
          </p>
        </div>
        <CreateCollectionButton />
      </div>

      {collections.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {collections.map((collection) => {
            const bookCount = counts.get(collection.id) ?? 0;
            return (
              <Link
                key={collection.id}
                to={`/collection/${collection.id}`}
                className="bg-surface border border-border rounded-xl overflow-hidden hover:shadow-lg hover:-translate-y-1 transition-all duration-200"
              >
                <div
                  className="h-2"
                  style={{ backgroundColor: collection.color || "var(--color-primary)" }}
                />
                <div className="p-5">
                  <div className="flex items-center gap-2 mb-2">
                    {collection.icon && <span className="text-xl">{collection.icon}</span>}
                    <h3 className="font-semibold text-foreground">{collection.name}</h3>
                  </div>
                  {collection.description && (
                    <p className="text-sm text-foreground-muted line-clamp-2 mb-3">
                      {collection.description}
                    </p>
                  )}
                  <p className="text-sm text-foreground-muted">
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
