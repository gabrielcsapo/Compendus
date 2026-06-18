"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-flight-router/client";
import { getJourney, wanderStop } from "../actions/substrate";

/**
 * One journey: a meandering candlelit road through a theme. Nodes are real
 * passages (role-marked), modules are stretches of the road, the current node
 * glows, and the road forks at the end toward adjacent themes. Reading a node
 * records coverage server-side — the same coverage wander and the reader feed —
 * so the road remembers wherever you actually read. No streaks, no scores.
 */

interface StudyItem {
  ordinal: number;
  passageId: string;
  bookId: string;
  bookTitle: string;
  snippet: string;
  module: string;
  role: string;
  transition: string;
  seen: boolean;
}
interface Curriculum {
  id: string;
  topicId: string;
  title: string;
  builder: string;
  items: StudyItem[];
}
interface AdjacentTopic {
  id: string;
  label: string | null;
  size: number;
  bookCount: number;
}
interface StopView {
  passageId: string;
  bookId: string;
  spineIndex: number | null;
  text: string;
}

const ROLE_GLYPH: Record<string, string> = {
  definition: "✦",
  example: "❧",
  argument: "¶",
  application: "⚒",
  narrative: "☾",
};
const ROLE_LABEL: Record<string, string> = {
  definition: "a framing",
  example: "an example",
  argument: "an argument",
  application: "in practice",
  narrative: "a story",
};

export function JourneyClient({ topicId }: { topicId: string }) {
  const [curriculum, setCurriculum] = useState<Curriculum | null>(null);
  const [adjacent, setAdjacent] = useState<AdjacentTopic[]>([]);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [openText, setOpenText] = useState<StopView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    getJourney(topicId)
      .then(({ curriculum: c, adjacent: a }) => {
        if (!c) {
          setError("This road hasn't been mapped yet.");
          return;
        }
        setCurriculum(c as Curriculum);
        setSeen(new Set((c.items as StudyItem[]).filter((i) => i.seen).map((i) => i.passageId)));
        setAdjacent((a as AdjacentTopic[]) ?? []);
      })
      .catch(() => setError("Couldn't reach the library."));
  }, [topicId]);

  /** Opening a node fetches the full passage — which records coverage server-side. */
  const openNode = useCallback(
    async (item: StudyItem) => {
      if (openId === item.passageId) {
        setOpenId(null);
        setOpenText(null);
        return;
      }
      setOpenId(item.passageId);
      setOpenText(null);
      try {
        const stop = await wanderStop(item.passageId);
        if (stop) {
          setOpenText(stop as StopView);
          setSeen((s) => new Set([...s, item.passageId]));
        }
      } catch {
        // leave the snippet showing
      }
    },
    [openId],
  );

  const items = curriculum?.items ?? [];
  const currentIdx = items.findIndex((i) => !seen.has(i.passageId));
  const modules: string[] = [];
  for (const item of items) if (!modules.includes(item.module)) modules.push(item.module);
  const moduleComplete = (m: string) =>
    items.filter((i) => i.module === m).every((i) => seen.has(i.passageId));
  const walkedCount = items.filter((i) => seen.has(i.passageId)).length;

  const scrollToCurrent = useCallback(() => {
    currentRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#0b0b0f] text-stone-200 font-serif">
      {/* faint stars */}
      <div
        className="pointer-events-none fixed inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(1px 1px at 12% 18%, rgba(255,255,255,0.25) 50%, transparent 50%), radial-gradient(1px 1px at 78% 9%, rgba(255,255,255,0.18) 50%, transparent 50%), radial-gradient(1px 1px at 55% 31%, rgba(255,255,255,0.12) 50%, transparent 50%), radial-gradient(1px 1px at 88% 64%, rgba(255,255,255,0.16) 50%, transparent 50%), radial-gradient(1px 1px at 22% 76%, rgba(255,255,255,0.12) 50%, transparent 50%)",
        }}
      />

      <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-gradient-to-b from-[#0b0b0f] via-[#0b0b0f]/90 to-transparent">
        <Link
          to="/journeys"
          className="rounded-full border border-stone-800 hover:border-stone-600 px-3 py-1.5 text-stone-500 hover:text-stone-300 transition-colors text-sm font-sans"
        >
          ← all journeys
        </Link>
        {items.length > 0 && (
          <div className="text-xs font-sans text-stone-600">
            {walkedCount} of {items.length} walked
          </div>
        )}
      </div>

      <div className="mx-auto max-w-2xl px-6 pb-40 pt-6">
        {error ? (
          <p className="text-stone-500 font-sans text-sm">{error}</p>
        ) : !curriculum ? (
          <p className="text-stone-600 font-sans text-sm">Lighting the lanterns…</p>
        ) : (
          <>
            <div className="text-xs uppercase tracking-[0.3em] text-amber-500/70 font-sans mb-3">
              {curriculum.builder === "device" ? "A journey, named by your fleet" : "A journey"}
            </div>
            <h1 className="text-3xl text-stone-100 mb-12 leading-snug">{curriculum.title}</h1>

            <ol className="relative">
              {/* the road: a dotted spine down the middle */}
              <div
                className="absolute left-1/2 top-2 bottom-2 -translate-x-1/2 w-px"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(to bottom, rgba(235,179,77,0.35) 0 3px, transparent 3px 11px)",
                }}
              />

              {items.map((item, idx) => {
                const side = idx % 2 === 0 ? "left" : "right";
                const isCurrent = idx === currentIdx;
                const isSeen = seen.has(item.passageId);
                const isOpen = openId === item.passageId;
                const newModule = idx === 0 || items[idx - 1].module !== item.module;
                return (
                  <li key={item.passageId} ref={isCurrent ? currentRef : undefined}>
                    {newModule && (
                      <div className="relative flex items-center justify-center py-8">
                        <div className="rounded-full border border-stone-800 bg-[#0b0b0f] px-4 py-1.5 font-sans text-[11px] uppercase tracking-[0.25em] text-stone-500">
                          {item.module}
                          {moduleComplete(item.module) && (
                            <span className="ml-2 text-amber-400/90">✦ walked</span>
                          )}
                        </div>
                      </div>
                    )}

                    <div
                      className={`relative flex ${side === "left" ? "justify-start" : "justify-end"} py-3`}
                    >
                      {/* node marker on the spine */}
                      <span
                        className={`absolute left-1/2 top-8 -translate-x-1/2 z-10 flex h-5 w-5 items-center justify-center rounded-full border text-[10px] transition-colors ${
                          isSeen
                            ? "border-amber-500/80 bg-amber-400/90 text-[#0b0b0f]"
                            : isCurrent
                              ? "border-amber-400 bg-[#0b0b0f] text-amber-300 journey-glow"
                              : "border-stone-700 bg-[#0b0b0f] text-stone-600"
                        }`}
                      >
                        {isSeen ? "✓" : (ROLE_GLYPH[item.role] ?? "·")}
                      </span>

                      <button
                        onClick={() => openNode(item)}
                        className={`group w-[calc(50%-2.25rem)] text-left rounded-2xl border px-5 py-4 transition-all ${
                          isOpen ? "w-full z-20" : ""
                        } ${
                          isCurrent
                            ? "border-amber-800/80 bg-amber-950/20"
                            : "border-stone-800 hover:border-stone-600 bg-stone-900/30 hover:bg-stone-900/60"
                        } ${isSeen && !isOpen ? "opacity-70" : ""}`}
                      >
                        <div className="text-[11px] font-sans text-amber-200/60 mb-1.5 leading-snug">
                          {item.transition}
                        </div>
                        <div
                          className={`text-[15px] leading-relaxed ${isOpen ? "text-stone-200" : "text-stone-300 line-clamp-3"}`}
                        >
                          {isOpen ? (openText?.text ?? item.snippet) : item.snippet}
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <span className="text-xs font-sans text-stone-500 truncate">
                            {ROLE_LABEL[item.role] ?? item.role} · {item.bookTitle}
                          </span>
                          {isOpen && openText && (
                            <Link
                              to={
                                openText.spineIndex != null
                                  ? `/book/${openText.bookId}/read?spine=${openText.spineIndex}`
                                  : `/book/${openText.bookId}`
                              }
                              onClick={(e) => e.stopPropagation()}
                              className="shrink-0 text-xs font-sans text-amber-300/90 hover:text-amber-200"
                            >
                              open in book →
                            </Link>
                          )}
                        </div>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>

            {/* the fork: where the road goes from here */}
            {adjacent.length > 0 && (
              <div className="relative mt-4">
                <svg
                  viewBox="0 0 200 60"
                  className="mx-auto block h-16 w-52"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d="M100 0 C100 18 60 28 30 54"
                    stroke="rgba(235,179,77,0.35)"
                    strokeWidth="1.5"
                    strokeDasharray="3 8"
                  />
                  <path
                    d="M100 0 C100 18 140 28 170 54"
                    stroke="rgba(235,179,77,0.35)"
                    strokeWidth="1.5"
                    strokeDasharray="3 8"
                  />
                </svg>
                <div className="flex gap-4">
                  {adjacent.map((t) => (
                    <Link
                      key={t.id}
                      to={`/journey/${t.id}`}
                      className="group flex-1 rounded-2xl border border-stone-800 hover:border-amber-900/70 bg-stone-900/30 hover:bg-stone-900/60 px-5 py-4 transition-colors"
                    >
                      <div className="text-[11px] uppercase tracking-wider text-stone-600 font-sans mb-1">
                        the road continues
                      </div>
                      <div className="text-base text-stone-200 group-hover:text-amber-100 transition-colors leading-snug">
                        {t.label ?? "An unnamed thread"}
                      </div>
                      <div className="text-xs text-stone-500 font-sans mt-1">
                        {t.size} passages · {t.bookCount} {t.bookCount === 1 ? "book" : "books"}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* continue: drift down the road to the glowing node */}
      {currentIdx >= 0 && (
        <div className="fixed bottom-0 inset-x-0 flex justify-center py-6 bg-gradient-to-t from-[#0b0b0f] via-[#0b0b0f]/85 to-transparent">
          <button
            onClick={scrollToCurrent}
            className="rounded-full border border-amber-900/70 bg-amber-950/30 px-6 py-2.5 font-sans text-sm text-amber-200 hover:bg-amber-950/60 transition-colors"
          >
            continue the road →
          </button>
        </div>
      )}

      <style>{`
        .journey-glow { box-shadow: 0 0 0 0 rgba(235,179,77,0.45); animation: journeyGlow 2.6s ease-in-out infinite; }
        @keyframes journeyGlow {
          0%, 100% { box-shadow: 0 0 6px 1px rgba(235,179,77,0.25); }
          50% { box-shadow: 0 0 18px 5px rgba(235,179,77,0.45); }
        }
        .line-clamp-3 { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
      `}</style>
    </div>
  );
}
