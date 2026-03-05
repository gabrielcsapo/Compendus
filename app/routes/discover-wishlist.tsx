import { Suspense } from "react";
import { getWantedBooks } from "../actions/wanted";
import DiscoverWishlistClient from "./discover-wishlist.client";

export default function DiscoverWishlist() {
  return (
    <Suspense fallback={<WishlistSkeleton />}>
      <WishlistData />
    </Suspense>
  );
}

async function WishlistData() {
  const result = await getWantedBooks();
  return <DiscoverWishlistClient initialBooks={result.books} initialRemoved={result.removed} />;
}

function WishlistSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-6 bg-surface-elevated rounded w-40" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-24 bg-surface-elevated rounded-xl" />
      ))}
    </div>
  );
}
