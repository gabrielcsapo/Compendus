import { Suspense } from "react";
import { Link } from "react-flight-router/client";
import { getCollection, getBooksInCollection } from "../actions/collections";
import { BookGrid } from "../components/BookGrid";
import { BookGridSkeleton } from "../components/BookGridSkeleton";
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
