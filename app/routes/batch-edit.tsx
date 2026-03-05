import { Suspense } from "react";
import { getAllBooksWithTags, getDistinctSeries, getDistinctAuthors } from "../actions/batch";
import { getTags } from "../actions/tags";
import { BatchEditClient } from "../components/BatchEditClient";

export default function BatchEdit() {
  return (
    <Suspense fallback={<BatchEditSkeleton />}>
      <BatchEditData />
    </Suspense>
  );
}

async function BatchEditData() {
  const [{ books, bookTags }, allTags, seriesNames, authorNames] = await Promise.all([
    getAllBooksWithTags(),
    getTags(),
    getDistinctSeries(),
    getDistinctAuthors(),
  ]);

  return <BatchEditClient books={books} bookTags={bookTags} allTags={allTags} seriesNames={seriesNames} authorNames={authorNames} />;
}

function BatchEditSkeleton() {
  return (
    <div className="container my-8 px-6 mx-auto animate-pulse">
      <div className="h-8 bg-surface-elevated rounded w-48 mb-6" />
      <div className="flex gap-4 mb-6">
        <div className="h-10 bg-surface-elevated rounded w-64" />
        <div className="h-10 bg-surface-elevated rounded w-32" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-12 bg-surface-elevated rounded" />
        ))}
      </div>
    </div>
  );
}
