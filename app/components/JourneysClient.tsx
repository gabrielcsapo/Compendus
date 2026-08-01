"use client";

import { useEffect, useRef, useState } from "react";
import { Link } from "react-flight-router/client";
import { findPods, getPods } from "../actions/substrate";
import type { PodSummary } from "../lib/learning/pods";

const PAGE_SIZE = 24;

function PodCard({ pod }: { pod: PodSummary }) {
  return (
    <Link
      to={`/pod/${pod.id}`}
      className="group block rounded-2xl border border-stone-800 bg-stone-900/30 px-5 py-5 transition-colors hover:border-amber-900/70 hover:bg-stone-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
    >
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0">
          <h2 className="text-lg leading-snug text-stone-100 transition-colors group-hover:text-amber-100">
            {pod.title}
          </h2>
          {pod.description && (
            <p className="mt-2 line-clamp-2 font-sans text-sm leading-relaxed text-stone-500">
              {pod.description}
            </p>
          )}
          <p className="mt-3 font-sans text-xs text-stone-600">
            {pod.passageCount} {pod.passageCount === 1 ? "passage" : "passages"} · {pod.bookCount}{" "}
            {pod.bookCount === 1 ? "book" : "books"} · {pod.questionCount}{" "}
            {pod.questionCount === 1 ? "check" : "checks"}
          </p>
        </div>
        <span className="mt-0.5 shrink-0 font-sans text-sm text-stone-600 transition-colors group-hover:text-amber-300">
          Begin →
        </span>
      </div>
    </Link>
  );
}

export function JourneysClient() {
  const [pods, setPods] = useState<PodSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("q") ?? ""),
  );
  const [results, setResults] = useState<PodSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const searchSequence = useRef(0);

  useEffect(() => {
    getPods({ limit: PAGE_SIZE })
      .then((result) => {
        setPods(result.pods);
        setTotal(result.total);
      })
      .catch(() => setPods([]));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    const search = params.toString();
    window.history.replaceState(null, "", search ? `?${search}` : window.location.pathname);
  }, [query]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      searchSequence.current++;
      setResults(null);
      setSearching(false);
      setSearchError(false);
      return;
    }

    const sequence = ++searchSequence.current;
    setSearching(true);
    setSearchError(false);
    const handle = window.setTimeout(() => {
      findPods(trimmed)
        .then((found) => {
          if (searchSequence.current === sequence) {
            setResults(found);
            setSearching(false);
          }
        })
        .catch(() => {
          if (searchSequence.current === sequence) {
            setResults(null);
            setSearching(false);
            setSearchError(true);
          }
        });
    }, 300);

    return () => window.clearTimeout(handle);
  }, [query]);

  const loadMore = async () => {
    if (!pods || loadingMore || pods.length >= total) return;
    setLoadingMore(true);
    try {
      const next = await getPods({ limit: PAGE_SIZE, offset: pods.length });
      setPods((current) => [...(current ?? []), ...next.pods]);
      setTotal(next.total);
    } finally {
      setLoadingMore(false);
    }
  };

  const shown = results ?? pods;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#0b0b0f] font-serif text-stone-200">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-gradient-to-b from-[#0b0b0f] via-[#0b0b0f]/95 to-transparent px-6 py-4">
        <Link
          to="/wander"
          className="rounded-full border border-stone-800 px-3 py-1.5 font-sans text-sm text-stone-500 transition-colors hover:border-stone-600 hover:text-stone-300"
        >
          ← Wander
        </Link>
        <Link
          to="/library"
          className="rounded-full border border-stone-700 px-3 py-1.5 font-sans text-sm text-stone-400 transition-colors hover:border-stone-500 hover:text-stone-200"
        >
          Exit ✕
        </Link>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-24 pt-8">
        <p className="mb-3 font-sans text-xs font-medium uppercase tracking-[0.28em] text-amber-500/70">
          Pods
        </p>
        <h1 className="max-w-xl text-3xl leading-tight text-stone-100 sm:text-4xl">
          Learn one idea from the books you already own.
        </h1>
        <p className="mb-9 mt-4 max-w-xl font-sans text-sm leading-relaxed text-stone-500">
          Each ready Pod draws verified passages from at least three books, then checks what stayed
          with you against those sources.
        </p>

        <label className="block">
          <span className="sr-only">Find a Pod</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a Pod — “pruning fruit trees”, “the duel”…"
            className="w-full rounded-2xl border border-stone-800 bg-stone-900/40 px-5 py-3 font-serif text-base text-stone-200 outline-none transition-colors placeholder:text-stone-600 focus:border-amber-800 focus:ring-2 focus:ring-amber-900/30"
          />
        </label>

        <div className="mt-8">
          {searching ? (
            <p className="font-sans text-sm text-stone-600" role="status">
              Finding Pods…
            </p>
          ) : searchError ? (
            <div
              className="rounded-2xl border border-red-950/80 bg-red-950/20 px-5 py-6 font-sans text-sm leading-relaxed text-red-200/80"
              role="alert"
            >
              Pod search is temporarily unavailable. Your library is still here; try again in a
              moment.
            </div>
          ) : shown === null ? (
            <div className="space-y-3" aria-label="Loading Pods">
              {[0, 1, 2].map((value) => (
                <div
                  key={value}
                  className="h-28 animate-pulse rounded-2xl border border-stone-800 bg-stone-900/30"
                />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <div className="rounded-2xl border border-stone-800 bg-stone-900/30 px-5 py-6 font-sans text-sm leading-relaxed text-stone-500">
              {results
                ? "No ready Pods match that yet. Try a broader idea or the name of an author."
                : "No Pods are ready yet. Analyze a few books to build source-grounded sessions."}
            </div>
          ) : (
            <ul className="space-y-3">
              {shown.map((pod) => (
                <li key={pod.id}>
                  <PodCard pod={pod} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {!results && pods && pods.length < total && (
          <div className="mt-8 flex justify-center">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="rounded-full border border-stone-800 px-6 py-2 font-sans text-sm text-stone-500 transition-colors hover:border-stone-600 hover:text-stone-300 disabled:opacity-50"
            >
              {loadingMore ? "Loading more…" : `Show more Pods (${total - pods.length})`}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
