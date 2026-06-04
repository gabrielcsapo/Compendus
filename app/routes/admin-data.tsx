import { Suspense } from "react";
import { adminDataStats, adminListFiles, adminListJobs } from "../actions/books";
import { AdminDataClient } from "../components/AdminDataClient";

const MATCHED_PAGE_SIZE = 50;
const ORPHANED_PAGE_SIZE = 50;
const MISSING_PAGE_SIZE = 50;
const JOBS_PAGE_SIZE = 25;

export default function AdminData() {
  return (
    <Suspense fallback={<AdminDataSkeleton />}>
      <AdminDataContent />
    </Suspense>
  );
}

async function AdminDataContent() {
  // Load the summary stats and only the FIRST page of each section.
  // The full library is never serialized to the client; subsequent pages and
  // searches are fetched on demand via the admin* server actions.
  const [stats, matched, orphaned, missing, jobs] = await Promise.all([
    adminDataStats(),
    adminListFiles({ category: "matched", page: 1, pageSize: MATCHED_PAGE_SIZE }),
    adminListFiles({ category: "orphaned", page: 1, pageSize: ORPHANED_PAGE_SIZE }),
    adminListFiles({ category: "missing", page: 1, pageSize: MISSING_PAGE_SIZE }),
    adminListJobs({ page: 1, pageSize: JOBS_PAGE_SIZE }),
  ]);

  return (
    <AdminDataClient
      stats={stats}
      initialMatched={{ ...matched, pageSize: MATCHED_PAGE_SIZE }}
      initialOrphaned={{ ...orphaned, pageSize: ORPHANED_PAGE_SIZE }}
      initialMissing={{ ...missing, pageSize: MISSING_PAGE_SIZE }}
      initialJobs={{ ...jobs, pageSize: JOBS_PAGE_SIZE }}
    />
  );
}

function AdminDataSkeleton() {
  return (
    <div className="container my-8 px-6 mx-auto animate-pulse">
      <div className="h-8 bg-surface-elevated rounded w-64 mb-6" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 bg-surface-elevated rounded-xl" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 bg-surface-elevated rounded" />
        ))}
      </div>
    </div>
  );
}
