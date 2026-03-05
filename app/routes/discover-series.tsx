import { Suspense } from "react";
import { getAllSeriesWithCounts } from "../actions/series";
import DiscoverSeriesClient from "./discover-series.client";

export default function DiscoverSeries() {
  return (
    <Suspense fallback={<SeriesSkeleton />}>
      <DiscoverSeriesData />
    </Suspense>
  );
}

async function DiscoverSeriesData() {
  const series = await getAllSeriesWithCounts();
  return <DiscoverSeriesClient initialSeriesList={series} />;
}

function SeriesSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-6 bg-surface-elevated rounded w-40" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-20 bg-surface-elevated rounded-xl" />
      ))}
    </div>
  );
}
