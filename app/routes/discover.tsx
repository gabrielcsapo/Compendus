import { Suspense } from "react";
import { getWantedBooks } from "../actions/wanted";
import DiscoverClient from "./discover.client";

export default function Discover() {
  return (
    <Suspense fallback={<DiscoverClient initialWantedCount={0} />}>
      <DiscoverData />
    </Suspense>
  );
}

async function DiscoverData() {
  const result = await getWantedBooks({ filterOwned: true });
  return <DiscoverClient initialWantedCount={result.books.length} />;
}
