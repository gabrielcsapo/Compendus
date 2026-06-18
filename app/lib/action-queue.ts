"use client";

/**
 * Serialize server-action calls. CONCURRENT react-flight-router action calls
 * can deadlock client-side (two+ in-flight `callServer` invocations — the
 * later promises never settle even though the server executes them; verified
 * 2026-06-12 on /admin where summary + sidebar-counts fired together and hung
 * forever while the fleet page's single-action poll worked fine). Until the
 * framework handles overlap, route every poll/click through this chain — the
 * serialization cost is irrelevant next to the network round-trip.
 */
let chain: Promise<unknown> = Promise.resolve();

export function queuedAction<T>(run: () => Promise<T>): Promise<T> {
  const next = chain.then(run, run);
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
