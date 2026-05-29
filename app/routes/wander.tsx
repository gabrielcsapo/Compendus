import { Link } from "react-flight-router/client";
import { listEntities, getEntityDetail, wander } from "../lib/knowledge/graph";
import { WanderClient } from "../components/WanderClient";

/**
 * Night-mode wander: a calm, source-grounded way to drift through the ideas,
 * people, and places in your library — one idea at a time, every thread rooted
 * in a real passage. Deliberately no feeds, metrics, or streaks.
 */
export default async function WanderPage() {
  const candidates = listEntities({ limit: 60 });

  if (candidates.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-[#0b0b0f] text-stone-300 font-serif px-6 text-center">
        <div className="text-xs uppercase tracking-[0.25em] text-stone-600 font-sans">
          The Living Library
        </div>
        <p className="text-2xl text-stone-200 max-w-md leading-snug">
          Your library hasn't been explored yet.
        </p>
        <p className="text-stone-500 max-w-sm font-sans text-sm">
          Open a book and run “Analyze for Living Library” to begin mapping its ideas — then wander
          through them here.
        </p>
        <Link
          to="/library"
          className="mt-2 text-amber-300 hover:text-amber-200 transition-colors font-sans text-sm"
        >
          Back to your library →
        </Link>
      </div>
    );
  }

  // Start somewhere with reach — a random pick from the most-connected entities,
  // so the entry point feels serendipitous rather than fixed.
  const topTier = candidates.slice(0, Math.min(25, candidates.length));
  const start = topTier[Math.floor(Math.random() * topTier.length)];
  const detail = getEntityDetail(start.id);

  if (!detail) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b0b0f] text-stone-400 font-serif">
        Nothing to wander yet.
      </div>
    );
  }

  const steps = wander(start.id, 6);
  const pool = candidates.map((c) => ({ id: c.id, name: c.canonicalName }));

  return <WanderClient initialEntity={detail} initialSteps={steps} pool={pool} />;
}
