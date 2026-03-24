import { Suspense } from "react";
import { getWantedBooks } from "../actions/wanted";
import DiscoverIndexClient from "./discover-index.client";

export default function DiscoverIndex() {
  return (
    <Suspense fallback={<DiscoverIndexClient />}>
      <DiscoverIndexData />
    </Suspense>
  );
}

async function DiscoverIndexData() {
  const result = await getWantedBooks();
  return <DiscoverIndexClient initialBooks={result.books} initialRemoved={result.removed} />;
}
