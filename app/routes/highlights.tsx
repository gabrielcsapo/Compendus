import { Suspense } from "react";
import { getAllHighlights } from "../actions/reader";
import HighlightsClient from "./highlights.client";

export default function Highlights() {
  return (
    <Suspense fallback={<HighlightsSkeleton />}>
      <HighlightsData />
    </Suspense>
  );
}

async function HighlightsData() {
  const highlights = await getAllHighlights();
  return <HighlightsClient initialHighlights={highlights} />;
}

function HighlightsSkeleton() {
  return (
    <main className="container my-8 px-6 mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Highlights</h1>
        <p className="text-foreground-muted">Loading...</p>
      </div>
    </main>
  );
}
