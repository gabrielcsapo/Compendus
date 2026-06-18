"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useRouter } from "react-flight-router/client";
import { saveTrail as saveTrailAction, wanderStart, wanderStop } from "../actions/substrate";

interface StopEntity {
  id: string;
  name: string;
  type: string;
}
interface StepView {
  kind: "same_idea" | "relationship" | "different_take" | "deeper" | "leave";
  passageId: string;
  bookId: string;
  bookTitle: string;
  snippet: string;
  reason: string;
}
export interface StopView {
  passageId: string;
  bookId: string;
  bookTitle: string;
  chapterTitle: string | null;
  spineIndex: number | null;
  text: string;
  topicId: string | null;
  topicLabel: string | null;
  entities: StopEntity[];
  steps: StepView[];
}

const KIND_LABEL: Record<StepView["kind"], string> = {
  same_idea: "the same idea",
  relationship: "connected",
  different_take: "a different take",
  deeper: "go deeper",
  leave: "somewhere else",
};

export function WanderClient2({ initialStop }: { initialStop: StopView }) {
  const [stop, setStop] = useState<StopView>(initialStop);
  const [history, setHistory] = useState<string[]>([]);
  const [visible, setVisible] = useState(true);
  const [seeking, setSeeking] = useState(false);
  const [query, setQuery] = useState("");
  const [savedTitle, setSavedTitle] = useState<string | null>(null);
  const router = useRouter();

  // Interaction log: full path + which step kinds were taken — this is what
  // tunes step ranking over time (proposal §6).
  const startedAtRef = useRef(Date.now());
  const pathRef = useRef<string[]>([initialStop.passageId]);
  const stepsTakenRef = useRef<string[]>([]);
  const loggedRef = useRef(false);
  const logSession = useCallback(() => {
    if (loggedRef.current) return;
    loggedRef.current = true;
    try {
      const payload = JSON.stringify({
        startedAt: startedAtRef.current,
        ideasVisited: pathRef.current.length,
        path: pathRef.current,
        stepsTaken: stepsTakenRef.current,
      });
      navigator.sendBeacon?.(
        "/api/wander/sessions",
        new Blob([payload], { type: "application/json" }),
      );
    } catch {
      // best-effort; activity logging must never break the experience
    }
  }, []);

  useEffect(() => {
    window.addEventListener("pagehide", logSession);
    return () => {
      window.removeEventListener("pagehide", logSession);
      logSession();
    };
  }, [logSession]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.navigate("/library");
      if (e.key === "/" && !seeking) {
        e.preventDefault();
        setSeeking(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, seeking]);

  const show = useCallback((next: StopView, recordStep?: StepView["kind"], cameFrom?: string) => {
    if (cameFrom) setHistory((h) => [...h, cameFrom]);
    if (recordStep) stepsTakenRef.current.push(recordStep);
    pathRef.current.push(next.passageId);
    setStop(next);
    setSavedTitle(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const goTo = useCallback(
    async (passageId: string, recordStep?: StepView["kind"], cameFrom?: string) => {
      setVisible(false);
      try {
        const next = await wanderStop(passageId, pathRef.current.slice(-60));
        if (next) show(next as StopView, recordStep, cameFrom);
      } finally {
        setTimeout(() => setVisible(true), 120);
      }
    },
    [show],
  );

  const drift = useCallback(async () => {
    setVisible(false);
    try {
      const next = await wanderStart({});
      if (next) show(next as StopView, "leave", stop.passageId);
    } finally {
      setTimeout(() => setVisible(true), 120);
    }
  }, [show, stop.passageId]);

  const seek = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      setSeeking(false);
      setVisible(false);
      try {
        const r = await fetch(
          `/api/wander2/start?mode=query&q=${encodeURIComponent(trimmed)}`,
        ).then((x) => x.json());
        if (r?.stop) show(r.stop, undefined, stop.passageId);
      } finally {
        setQuery("");
        setTimeout(() => setVisible(true), 120);
      }
    },
    [show, stop.passageId],
  );

  const back = useCallback(() => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    goTo(prev);
  }, [history, goTo]);

  const saveTrail = useCallback(async () => {
    try {
      const saved = await saveTrailAction(pathRef.current);
      if (saved) setSavedTitle(saved.title);
    } catch {
      // non-fatal
    }
  }, []);

  const readerHref =
    stop.spineIndex != null
      ? `/book/${stop.bookId}/read?spine=${stop.spineIndex}`
      : `/book/${stop.bookId}`;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#0b0b0f] text-stone-200 font-serif">
      <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-gradient-to-b from-[#0b0b0f] to-transparent">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSeeking(true)}
            className="flex items-center gap-2 rounded-full border border-stone-800 hover:border-stone-600 px-3 py-1.5 text-stone-500 hover:text-stone-300 transition-colors text-sm font-sans"
          >
            <span className="text-[11px] uppercase tracking-wider text-stone-600">/</span>
            wander toward…
          </button>
          <Link
            to="/journeys"
            onClick={logSession}
            className="rounded-full border border-stone-800 hover:border-stone-600 px-3 py-1.5 text-stone-500 hover:text-stone-300 transition-colors text-sm font-sans"
          >
            journeys
          </Link>
        </div>
        <Link
          to="/library"
          className="flex items-center gap-2 rounded-full border border-stone-700 hover:border-stone-500 px-3 py-1.5 text-stone-400 hover:text-stone-200 transition-colors text-sm font-sans"
          aria-label="Exit wander mode"
        >
          <span className="text-[11px] uppercase tracking-wider text-stone-600">esc</span>
          Exit ✕
        </Link>
      </div>

      {seeking && (
        <div className="fixed inset-0 z-20 flex items-start justify-center pt-[20vh] bg-black/60">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              seek(query);
            }}
            className="w-full max-w-xl px-6"
          >
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => setSeeking(false)}
              onKeyDown={(e) => e.key === "Escape" && setSeeking(false)}
              placeholder="What are you curious about?"
              className="w-full rounded-2xl border border-stone-700 bg-stone-950 px-6 py-4 text-xl text-stone-100 placeholder-stone-600 outline-none focus:border-amber-700 font-serif"
            />
            <div className="mt-2 text-center text-xs text-stone-600 font-sans">
              enter to wander toward it · esc to cancel
            </div>
          </form>
        </div>
      )}

      <div
        className={`mx-auto max-w-2xl px-6 pb-32 pt-6 transition-opacity duration-700 ${
          visible ? "opacity-100" : "opacity-20"
        }`}
      >
        {/* the passage — real author's words are the unit of wander */}
        <div className="min-h-[40vh] flex flex-col justify-center">
          <div className="text-xs uppercase tracking-[0.25em] text-amber-500/70 mb-5 font-sans">
            {stop.topicLabel ? stop.topicLabel.split(",")[0] : "from your library"}
          </div>
          <blockquote className="text-xl sm:text-2xl leading-relaxed text-stone-200/95 whitespace-pre-line">
            {stop.text.length > 900 ? `${stop.text.slice(0, 900)}…` : stop.text}
          </blockquote>
          <footer className="mt-5 text-sm text-stone-500 font-sans">
            —{" "}
            <Link
              to={readerHref}
              onClick={logSession}
              className="hover:text-amber-200 transition-colors"
            >
              {stop.bookTitle}
              {stop.chapterTitle ? ` · ${stop.chapterTitle}` : ""} →
            </Link>
          </footer>

          {stop.entities.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-2">
              {stop.entities.map((e) => (
                <Link
                  key={e.id}
                  to={`/entity/${e.id}`}
                  onClick={logSession}
                  className="rounded-full border border-stone-800 hover:border-amber-800 px-3 py-1 text-xs font-sans text-stone-400 hover:text-amber-200 transition-colors"
                >
                  {e.name}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* grounded steps */}
        {stop.steps.length > 0 && (
          <div className="mt-16">
            <div className="text-xs uppercase tracking-[0.25em] text-stone-600 mb-5 font-sans">
              Wander on
            </div>
            <ul className="space-y-3">
              {stop.steps.map((s, i) => (
                <li key={s.passageId + i}>
                  <button
                    onClick={() => goTo(s.passageId, s.kind, stop.passageId)}
                    className="group w-full text-left rounded-xl border border-stone-800 hover:border-stone-600 bg-stone-900/30 hover:bg-stone-900/60 px-5 py-4 transition-colors"
                  >
                    <div className="text-[11px] uppercase tracking-wider text-stone-600 font-sans mb-1.5">
                      {KIND_LABEL[s.kind]} · {s.bookTitle}
                    </div>
                    <div className="text-base text-stone-300 group-hover:text-stone-100 leading-snug transition-colors">
                      {s.snippet}
                    </div>
                    <div className="text-sm text-stone-500 font-sans mt-1.5">{s.reason}</div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* gentle controls */}
      <div className="fixed bottom-0 inset-x-0 flex items-center justify-center gap-6 py-6 bg-gradient-to-t from-[#0b0b0f] to-transparent font-sans text-sm">
        {history.length > 0 && (
          <button onClick={back} className="text-stone-500 hover:text-stone-300 transition-colors">
            ← back
          </button>
        )}
        {pathRef.current.length > 2 && (
          <button
            onClick={saveTrail}
            className="text-stone-500 hover:text-amber-200 transition-colors"
          >
            {savedTitle ? `saved: ${savedTitle}` : "save this trail"}
          </button>
        )}
        <button
          onClick={drift}
          className="text-stone-400 hover:text-amber-200 transition-colors tracking-wide"
        >
          drift somewhere else →
        </button>
      </div>
    </div>
  );
}
