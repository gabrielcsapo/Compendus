import { Link } from "react-flight-router/client";

/** The Living Library is Compendus' signature experience, not another filter. */
export function ExploreCallout() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-stone-800 bg-[#0b0b0f] px-6 py-8 text-stone-200 sm:px-8">
      <div className="absolute -right-16 -top-20 h-48 w-48 rounded-full bg-amber-300/5 blur-3xl" />
      <div className="relative max-w-2xl">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.22em] text-amber-300/70">
          Explore your shelves
        </p>
        <h2 className="font-serif text-2xl text-stone-100 sm:text-3xl">
          Follow an idea beyond a single book.
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-stone-400">
          Drift into a surprising passage, or open a source-grounded Pod for one focused idea.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to="/wander"
            className="rounded-full bg-stone-100 px-4 py-2 text-sm font-medium text-stone-950 transition-colors hover:bg-white"
          >
            Drift through the library
          </Link>
          <Link
            to="/pods"
            className="rounded-full border border-stone-700 px-4 py-2 text-sm font-medium text-stone-300 transition-colors hover:border-stone-500 hover:text-white"
          >
            Browse Pods
          </Link>
        </div>
      </div>
    </section>
  );
}
