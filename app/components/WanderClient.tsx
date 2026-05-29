"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useRouter } from "react-flight-router/client";

interface MentionView {
  bookId: string;
  bookTitle: string;
  chapterTitle: string | null;
  snippet: string;
  position: number | null;
}
interface EntityView {
  id: string;
  canonicalName: string;
  type: string;
  dateText: string | null;
  bookCount: number;
  mentions: MentionView[];
}
interface WanderStep {
  kind: "relationship" | "co_occurrence" | "semantic";
  reason: string;
  entityId: string | null;
  entityName: string | null;
  entityType: string | null;
  bookTitle: string | null;
  snippet: string | null;
}
interface PoolEntry {
  id: string;
  name: string;
}

const KIND_LABEL: Record<string, string> = {
  relationship: "connected",
  co_occurrence: "appears with",
  semantic: "feels related",
};

export function WanderClient({
  initialEntity,
  initialSteps,
  pool,
}: {
  initialEntity: EntityView;
  initialSteps: WanderStep[];
  pool: PoolEntry[];
}) {
  const [entity, setEntity] = useState<EntityView>(initialEntity);
  const [steps, setSteps] = useState<WanderStep[]>(initialSteps);
  const [history, setHistory] = useState<string[]>([]);
  const [visible, setVisible] = useState(true);
  const router = useRouter();

  // Activity tracking: log a wander session (start time + ideas visited) when the
  // surface closes, mirroring reading sessions. sendBeacon survives unload and
  // rides the profile cookie. loggedRef guards against double-logging when both
  // pagehide and the effect cleanup fire.
  const startedAtRef = useRef(Date.now());
  const ideasVisitedRef = useRef(1);
  const loggedRef = useRef(false);
  const logSession = useCallback(() => {
    if (loggedRef.current) return;
    loggedRef.current = true;
    try {
      const payload = JSON.stringify({
        startedAt: startedAtRef.current,
        ideasVisited: ideasVisitedRef.current,
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
      logSession(); // SPA navigation away from /wander
    };
  }, [logSession]);

  // Escape exits wander mode (the surface covers the app nav).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.navigate("/library");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const goTo = useCallback(async (id: string, cameFrom?: string) => {
    setVisible(false);
    try {
      const [d, w] = await Promise.all([
        fetch(`/api/graph/entities/${id}`).then((r) => r.json()),
        fetch(`/api/graph/entities/${id}/wander?limit=6`).then((r) => r.json()),
      ]);
      if (d?.entity) {
        if (cameFrom) setHistory((h) => [...h, cameFrom]);
        setEntity(d.entity);
        setSteps(w?.steps ?? []);
        ideasVisitedRef.current += 1;
        if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } finally {
      // brief beat so the fade reads as a calm transition, not a flicker
      setTimeout(() => setVisible(true), 120);
    }
  }, []);

  const drift = useCallback(() => {
    if (pool.length === 0) return;
    let pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick.id === entity.id && pool.length > 1) {
      pick = pool[(pool.indexOf(pick) + 1) % pool.length];
    }
    goTo(pick.id, entity.id);
  }, [pool, entity.id, goTo]);

  const back = useCallback(() => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    goTo(prev);
  }, [history, goTo]);

  const passage = entity.mentions?.[0];
  const threads = steps.filter((s) => s.entityId);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#0b0b0f] text-stone-200 font-serif">
      {/* minimal chrome */}
      <div className="sticky top-0 z-10 flex items-center justify-end px-6 py-4 bg-gradient-to-b from-[#0b0b0f] to-transparent">
        <Link
          to="/library"
          className="flex items-center gap-2 rounded-full border border-stone-700 hover:border-stone-500 px-3 py-1.5 text-stone-400 hover:text-stone-200 transition-colors text-sm font-sans"
          aria-label="Exit wander mode"
        >
          <span className="text-[11px] uppercase tracking-wider text-stone-600">esc</span>
          Exit ✕
        </Link>
      </div>

      <div
        className={`mx-auto max-w-2xl px-6 pb-32 pt-6 transition-opacity duration-700 ${
          visible ? "opacity-100" : "opacity-20"
        }`}
      >
        {/* the idea */}
        <div className="min-h-[40vh] flex flex-col justify-center">
          <div className="text-xs uppercase tracking-[0.25em] text-amber-500/70 mb-4 font-sans">
            {entity.type}
            {entity.dateText ? ` · ${entity.dateText}` : ""}
          </div>
          {/* The name itself is the way down: lateral drift stays in the threads
              below; tapping the idea goes deep into everything the library holds. */}
          <Link
            to={`/entity/${entity.id}`}
            onClick={logSession}
            className="group inline-flex items-baseline gap-3 mb-8"
          >
            <h1 className="text-4xl sm:text-5xl leading-tight text-stone-100 group-hover:text-amber-100 transition-colors">
              {entity.canonicalName}
            </h1>
            <span className="text-sm text-stone-600 group-hover:text-amber-300/80 transition-colors font-sans whitespace-nowrap">
              learn more →
            </span>
          </Link>

          {passage ? (
            <blockquote className="border-l border-stone-700 pl-5 text-lg leading-relaxed text-stone-300/90">
              {passage.snippet}
              <footer className="mt-3 text-sm text-stone-500 font-sans not-italic">
                — {passage.bookTitle}
                {passage.chapterTitle ? ` · ${passage.chapterTitle}` : ""}
              </footer>
            </blockquote>
          ) : (
            <p className="text-stone-500">Mentioned across your library.</p>
          )}
        </div>

        {/* threads to wander */}
        {threads.length > 0 && (
          <div className="mt-16">
            <div className="text-xs uppercase tracking-[0.25em] text-stone-600 mb-5 font-sans">
              Wander on
            </div>
            <ul className="space-y-3">
              {threads.map((s, i) => (
                <li key={(s.entityId ?? "") + i}>
                  <button
                    onClick={() => s.entityId && goTo(s.entityId, entity.id)}
                    className="group w-full text-left rounded-xl border border-stone-800 hover:border-stone-600 bg-stone-900/30 hover:bg-stone-900/60 px-5 py-4 transition-colors"
                  >
                    <div className="text-[11px] uppercase tracking-wider text-stone-600 font-sans mb-1">
                      {KIND_LABEL[s.kind] ?? "related"} · {s.entityType}
                    </div>
                    <div className="text-xl text-stone-200 group-hover:text-amber-100 transition-colors">
                      {s.entityName}
                    </div>
                    <div className="text-sm text-stone-500 font-sans mt-1.5 leading-snug">
                      {s.reason}
                    </div>
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
