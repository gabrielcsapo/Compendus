import { Link } from "react-flight-router/client";
import { substrateReady } from "../lib/knowledge/substrate";
import { JourneysClient } from "../components/JourneysClient";

/**
 * Journeys — the directed face of the Living Library: every substantial theme
 * across your books as a road you can walk, definitions first, books
 * alternating, progress carried by what you've actually read anywhere in the
 * app. Direction without obligation: no streaks, no scores — just where the
 * road goes and how far along it you are.
 */
export default async function JourneysPage() {
  if (!substrateReady()) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-[#0b0b0f] text-stone-300 font-serif px-6 text-center">
        <div className="text-xs uppercase tracking-[0.25em] text-stone-600 font-sans">
          The Living Library
        </div>
        <p className="text-2xl text-stone-200 max-w-md leading-snug">No roads yet.</p>
        <p className="text-stone-500 max-w-sm font-sans text-sm">
          Analyze a few books and the themes that span them become journeys you can walk.
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
  return <JourneysClient />;
}
