"use client";

import { useEffect, useRef, useState } from "react";
import { Link } from "react-flight-router/client";
import { getJourneyTopics, getRealms, searchJourneys } from "../actions/substrate";

interface TopicView {
  id: string;
  label: string | null;
  size: number;
  bookCount: number;
  coverage: { seen: number; total: number } | null;
}

interface RealmView {
  id: string;
  key: string;
  label: string;
  blurb: string | null;
  named: boolean;
  topicIds: string[];
  roadCount: number;
  passages: number;
  coverage: { seen: number; total: number };
}

/** Thin progress arc — quiet, no numbers shouting. */
function ProgressRing({ fraction }: { fraction: number }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" className="shrink-0 -rotate-90">
      <circle cx="22" cy="22" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2" />
      <circle
        cx="22"
        cy="22"
        r={r}
        fill="none"
        stroke="rgba(235,179,77,0.85)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, fraction))}
        style={{ transition: "stroke-dashoffset 0.8s ease" }}
      />
    </svg>
  );
}

const PAGE = 24;

export function JourneysClient() {
  const [topics, setTopics] = useState<TopicView[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [realmTopics, setRealmTopics] = useState<TopicView[] | null>(null);
  const [realms, setRealms] = useState<RealmView[]>([]);
  const [activeRealm, setActiveRealm] = useState<string | null>(null);
  const [query, setQuery] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("q") ?? ""),
  );
  // Deep link: ?realm=<content key> applies once realms arrive.
  const pendingRealmKey = useRef<string | null>(
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("realm"),
  );
  const [results, setResults] = useState<TopicView[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  useEffect(() => {
    getJourneyTopics({ limit: PAGE })
      .then((d) => {
        setTopics((d?.topics as TopicView[]) ?? []);
        setTotal(d?.total ?? 0);
      })
      .catch(() => setTopics([]));
    getRealms()
      .then((r) => {
        const loaded = (r as RealmView[]) ?? [];
        setRealms(loaded);
        if (pendingRealmKey.current) {
          const match = loaded.find((realm) => realm.key === pendingRealmKey.current);
          if (match) setActiveRealm(match.id);
          pendingRealmKey.current = null;
        }
      })
      .catch(() => setRealms([]));
  }, []);

  // Shareable state: realm + query live in the URL (replaceState — no history spam).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    const realmKey = realms.find((r) => r.id === activeRealm)?.key;
    if (realmKey) params.set("realm", realmKey);
    if (query.trim()) params.set("q", query.trim());
    const search = params.toString();
    window.history.replaceState(null, "", search ? `?${search}` : window.location.pathname);
  }, [activeRealm, query, realms]);

  const loadMore = () => {
    if (loadingMore || !topics) return;
    setLoadingMore(true);
    getJourneyTopics({ limit: PAGE, offset: topics.length })
      .then((d) => setTopics([...topics, ...((d?.topics as TopicView[]) ?? [])]))
      .finally(() => setLoadingMore(false));
  };

  // Realm drill-down fetches that territory's roads directly (not page-bound).
  useEffect(() => {
    if (!activeRealm) {
      setRealmTopics(null);
      return;
    }
    const selected = realms.find((r) => r.id === activeRealm);
    if (!selected) return;
    getJourneyTopics({ ids: selected.topicIds.slice(0, 80) })
      .then((d) => setRealmTopics((d?.topics as TopicView[]) ?? []))
      .catch(() => setRealmTopics([]));
  }, [activeRealm, realms]);

  // Debounced semantic search: "find a road toward…"
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++searchSeq.current;
    const handle = setTimeout(() => {
      searchJourneys(q)
        .then((d) => {
          if (searchSeq.current === seq) {
            setResults((d as TopicView[]) ?? []);
            setSearching(false);
          }
        })
        .catch(() => {
          if (searchSeq.current === seq) {
            setResults([]);
            setSearching(false);
          }
        });
    }, 350);
    return () => clearTimeout(handle);
  }, [query]);

  const realm = realms.find((r) => r.id === activeRealm) ?? null;
  const shown = results ?? (realm ? realmTopics : topics);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#0b0b0f] text-stone-200 font-serif">
      <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-gradient-to-b from-[#0b0b0f] via-[#0b0b0f]/90 to-transparent">
        <Link
          to="/wander"
          className="rounded-full border border-stone-800 hover:border-stone-600 px-3 py-1.5 text-stone-500 hover:text-stone-300 transition-colors text-sm font-sans"
        >
          ← wander
        </Link>
        <Link
          to="/library"
          className="flex items-center gap-2 rounded-full border border-stone-700 hover:border-stone-500 px-3 py-1.5 text-stone-400 hover:text-stone-200 transition-colors text-sm font-sans"
        >
          <span className="text-[11px] uppercase tracking-wider text-stone-600">esc</span>
          Exit ✕
        </Link>
      </div>

      <div className="mx-auto max-w-2xl px-6 pb-24 pt-8">
        <div className="text-xs uppercase tracking-[0.3em] text-amber-500/70 font-sans mb-3">
          Journeys
        </div>
        <h1 className="text-3xl text-stone-100 mb-2">The roads through your library</h1>
        <p className="text-stone-500 font-sans text-sm mb-10 max-w-md">
          Every theme that spans your books, walkable end to end — definitions first, authors
          alternating. Read anywhere; the road remembers.
        </p>

        {/* find a road */}
        <div className="mb-6">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a road — “pruning fruit trees”, “the duel”…"
            className="w-full rounded-2xl border border-stone-800 focus:border-amber-800 bg-stone-900/40 px-5 py-3 text-base text-stone-200 placeholder-stone-600 outline-none font-serif transition-colors"
          />
        </div>

        {/* realms: the high-altitude view */}
        {realms.length > 1 && !results && (
          <div className="mb-8 flex flex-wrap gap-2">
            <button
              onClick={() => setActiveRealm(null)}
              className={`rounded-full border px-4 py-1.5 font-sans text-xs tracking-wide transition-colors ${
                activeRealm === null
                  ? "border-amber-700 bg-amber-950/40 text-amber-200"
                  : "border-stone-800 text-stone-500 hover:border-stone-600 hover:text-stone-300"
              }`}
            >
              Everywhere
            </button>
            {realms.map((r) => (
              <button
                key={r.id}
                onClick={() => setActiveRealm(activeRealm === r.id ? null : r.id)}
                className={`rounded-full border px-4 py-1.5 font-sans text-xs tracking-wide transition-colors ${
                  activeRealm === r.id
                    ? "border-amber-700 bg-amber-950/40 text-amber-200"
                    : "border-stone-800 text-stone-500 hover:border-stone-600 hover:text-stone-300"
                }`}
              >
                {r.label}
                <span className="ml-1.5 text-stone-600">{r.roadCount}</span>
              </button>
            ))}
          </div>
        )}

        {/* the active realm's shelf card, when the fleet has written one */}
        {realm?.blurb && !results && (
          <p className="mb-6 -mt-3 text-sm text-amber-200/60 font-serif italic max-w-lg">
            {realm.blurb}
          </p>
        )}

        {searching ? (
          <div className="text-stone-600 font-sans text-sm">Searching the territory…</div>
        ) : shown === null ? (
          <div className="text-stone-600 font-sans text-sm">Surveying the territory…</div>
        ) : shown.length === 0 ? (
          <div className="text-stone-500 font-sans text-sm">
            {results ? "No roads lead there yet." : "No journeys yet — analyze a few books first."}
          </div>
        ) : (
          <ul className="space-y-3">
            {shown.map((topic, i) => {
              const fraction =
                topic.coverage && topic.coverage.total > 0
                  ? topic.coverage.seen / topic.coverage.total
                  : 0;
              return (
                <li
                  key={topic.id}
                  style={{ animationDelay: `${Math.min(i, 12) * 45}ms` }}
                  className="journey-rise"
                >
                  <Link
                    to={`/journey/${topic.id}`}
                    className="group flex items-center gap-4 rounded-2xl border border-stone-800 hover:border-amber-900/70 bg-stone-900/30 hover:bg-stone-900/60 px-5 py-4 transition-colors"
                  >
                    <ProgressRing fraction={fraction} />
                    <div className="min-w-0 flex-1">
                      <div className="text-lg text-stone-200 group-hover:text-amber-100 transition-colors leading-snug truncate">
                        {topic.label ?? "An unnamed thread"}
                      </div>
                      <div className="text-xs text-stone-500 font-sans mt-1">
                        {topic.size} passages · {topic.bookCount}{" "}
                        {topic.bookCount === 1 ? "book" : "books"}
                        {fraction > 0 && fraction < 1 && " · underway"}
                        {fraction >= 1 && " · walked"}
                      </div>
                    </div>
                    <span className="text-stone-600 group-hover:text-amber-300/80 transition-colors font-sans text-sm whitespace-nowrap">
                      walk →
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {/* quiet pagination: the road list grows only when asked */}
        {!results && !realm && topics && topics.length < total && (
          <div className="mt-8 flex justify-center">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="rounded-full border border-stone-800 hover:border-stone-600 px-6 py-2 font-sans text-sm text-stone-500 hover:text-stone-300 transition-colors disabled:opacity-50"
            >
              {loadingMore ? "unrolling the map…" : `more roads (${total - topics.length}) →`}
            </button>
          </div>
        )}
      </div>

      <style>{`
        .journey-rise { opacity: 0; animation: journeyRise 0.5s ease forwards; }
        @keyframes journeyRise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
      `}</style>
    </div>
  );
}
