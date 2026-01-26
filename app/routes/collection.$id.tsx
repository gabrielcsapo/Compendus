import { Link, type LoaderFunctionArgs } from "react-router";
import { getCollection, getBooksInCollection } from "../actions/collections";
import { BookGrid } from "../components/BookGrid";
import { CollectionActions } from "../components/CollectionActions";

type LoaderData = Awaited<ReturnType<typeof loader>>;

export async function loader({ params }: LoaderFunctionArgs) {
  const id = params.id as string;
  const collection = await getCollection(id);
  if (!collection) {
    throw new Response("Collection not found", { status: 404 });
  }

  const books = await getBooksInCollection(id);

  return { collection, books };
}

export default function CollectionDetail({ loaderData }: { loaderData: LoaderData }) {
  const { collection, books } = loaderData;

  return (
    <main className="container my-8 px-8 mx-auto">
      <div className="mb-6">
        <Link to="/collections" className="text-blue-600 hover:underline">
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
                <p className="text-gray-500 mt-1">{collection.description}</p>
              )}
            </div>
          </div>
          <p className="text-gray-400 mt-2">
            {books.length} {books.length === 1 ? "book" : "books"}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <CollectionActions collection={collection} />
          <div
            className="w-4 h-16 rounded"
            style={{ backgroundColor: collection.color || "#6366f1" }}
          />
        </div>
      </div>

      <BookGrid books={books} emptyMessage="No books in this collection yet" />
    </main>
  );
}
