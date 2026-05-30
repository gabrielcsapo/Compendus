import { Suspense } from "react";
import { listCandidateLinks, type CandidateLinkView } from "../lib/knowledge/resolution";
import { DuplicatesClient } from "../components/DuplicatesClient";

/**
 * Admin → Duplicates: human review queue for probable-duplicate entity links.
 * Heuristics (person-name variants, near-identical embeddings) only *propose*
 * that two extracted entities are the same; a person confirms (→ pins the merge)
 * or rejects (→ suppresses re-proposal). Identity is never asserted automatically.
 *
 * Server component reads the open candidates directly (like admin-data reads the
 * DB); the client island handles the confirm/reject actions + optimistic removal.
 */
export default function AdminDuplicates() {
  return (
    <Suspense fallback={<DuplicatesSkeleton />}>
      <AdminDuplicatesContent />
    </Suspense>
  );
}

async function AdminDuplicatesContent() {
  let initial: CandidateLinkView[] = [];
  try {
    initial = listCandidateLinks("open", 200);
  } catch {
    // Table may not exist yet (pre-migration) — show empty state.
    initial = [];
  }
  return <DuplicatesClient initial={initial} />;
}

function DuplicatesSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-20 rounded-lg bg-surface-elevated animate-pulse" />
      ))}
    </div>
  );
}
