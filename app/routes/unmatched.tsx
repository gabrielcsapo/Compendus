import { Suspense } from "react";
import { getUnmatchedBooks, getUnmatchedBooksCount } from "../actions/books";
import UnmatchedClient from "./unmatched.client";

export default function Unmatched() {
  return (
    <Suspense fallback={<UnmatchedSkeleton />}>
      <UnmatchedData />
    </Suspense>
  );
}

async function UnmatchedData() {
  const [books, count] = await Promise.all([getUnmatchedBooks(1), getUnmatchedBooksCount()]);
  return <UnmatchedClient initialBook={books[0] ?? null} initialCount={count} />;
}

function UnmatchedSkeleton() {
  return (
    <div className="container my-8 px-6 mx-auto">
      <div className="animate-pulse">
        <div className="h-8 bg-surface-elevated rounded w-48 mb-6" />
        <div className="h-4 bg-surface-elevated rounded w-32 mb-8" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="h-96 bg-surface-elevated rounded-xl" />
          <div className="h-96 bg-surface-elevated rounded-xl" />
        </div>
      </div>
    </div>
  );
}
