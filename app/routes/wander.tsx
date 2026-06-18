import { Link } from "react-flight-router/client";
import { substrateReady } from "../lib/knowledge/substrate";
import { startRandom, getStop } from "../lib/knowledge/wander2";
import { WanderClient2 } from "../components/WanderClient2";

/**
 * Night-mode wander: a calm, source-grounded way to drift through the ideas in
 * your library — one passage at a time, every thread rooted in a real book.
 * Deliberately no feeds, metrics, or streaks.
 *
 * Passage-centric wander rides the semantic substrate; until a library has
 * been analyzed (embed → link → structure) there is nothing to wander.
 */
export default async function WanderPage() {
  if (substrateReady()) {
    const passageId = startRandom();
    const stop = passageId ? getStop(passageId) : null;
    if (stop) return <WanderClient2 initialStop={stop} />;
  }

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
