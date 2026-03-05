import { Suspense } from "react";
import { Link } from "react-flight-router/client";
import { getCollection, getBooksInCollection } from "../actions/collections";
import { BookGrid } from "../components/BookGrid";
import { CollectionActions } from "../components/CollectionActions";

export default async function CollectionDetail({ params }: { params?: Record<string, string> }) {
  const id = params?.id as string;
  const collection = await getCollection(id);
  if (!collection) {
    throw new Response("Collection not found", { status: 404 });
  }

  return (
    <main className="container my-8 px-8 mx-auto">
      <div className="mb-6">
        <Link to="/collections" className="text-primary hover:underline">
          &larr; Back to Collections
        </Link>
      </div>

      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-3">
            {collection.icon && <span className="text-3xl">{collection.icon}</span>}
            <div>
              <h1 className="text-2xl font-bold">{collection.name}</h1>
              {collection.description && (
                <p className="text-foreground-muted mt-1">{collection.description}</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <CollectionActions collection={collection} />
          <div
            className="w-4 h-16 rounded"
            style={{ backgroundColor: collection.color || "var(--color-primary)" }}
          />
        </div>
      </div>

      <Suspense fallback={<BookGridSkeleton />}>
        <CollectionBooks collectionId={id} />
      </Suspense>
    </main>
  );
}

async function CollectionBooks({ collectionId }: { collectionId: string }) {
  const books = await getBooksInCollection(collectionId);
  return (
    <>
      <p className="text-foreground-muted/70 mb-4">
        {books.length} {books.length === 1 ? "book" : "books"}
      </p>
      <BookGrid books={books} emptyMessage="No books in this collection yet" />
    </>
  );
}

function BookGridSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-4 bg-surface-elevated rounded w-24 mb-4" />
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="aspect-[2/3] bg-surface-elevated rounded-lg" />
            <div className="h-3 bg-surface-elevated rounded w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}
