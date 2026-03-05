import { Suspense } from "react";
import { getRecentBooks } from "../actions/books";
import { getReadingStats } from "../actions/stats";
import DashboardClient from "./dashboard.client";

export default function Dashboard() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardData />
    </Suspense>
  );
}

async function DashboardData() {
  const [continueReading, stats] = await Promise.all([getRecentBooks(10), getReadingStats()]);
  return <DashboardClient initialContinueReading={continueReading} initialStats={stats} />;
}

function DashboardSkeleton() {
  return (
    <main className="container my-8 px-6 mx-auto">
      <div className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="bg-surface border border-border rounded-xl p-5 h-48 animate-pulse">
            <div className="h-4 bg-surface-elevated rounded w-24 mb-4" />
            <div className="h-10 bg-surface-elevated rounded w-16 mb-3" />
            <div className="h-3 bg-surface-elevated rounded w-40" />
          </div>
          <div className="md:col-span-2 bg-surface border border-border rounded-xl p-5 h-48 animate-pulse">
            <div className="h-4 bg-surface-elevated rounded w-20 mb-4" />
            <div className="flex items-end gap-2 h-24">
              {Array.from({ length: 7 }).map((_, i) => (
                <div
                  key={i}
                  className="flex-1 bg-surface-elevated rounded-t"
                  style={{ height: `${20 + ((i * 17) % 60)}%` }}
                />
              ))}
            </div>
          </div>
        </div>
        <div>
          <div className="h-5 bg-surface-elevated rounded w-40 mb-4 animate-pulse" />
          <div className="flex gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex-shrink-0 w-28">
                <div className="aspect-[2/3] bg-surface-elevated rounded-lg animate-pulse" />
                <div className="h-3 bg-surface-elevated rounded w-20 mt-2 animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
