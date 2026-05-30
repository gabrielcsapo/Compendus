"use client";

import { useState } from "react";

interface CandidateEntity {
  id: string;
  name: string;
  type: string;
}
interface CandidateLink {
  id: string;
  method: string;
  score: number | null;
  status: string;
  a: CandidateEntity;
  b: CandidateEntity;
}

interface DuplicatesClientProps {
  initial: CandidateLink[];
}

const METHOD_LABEL: Record<string, string> = {
  person_name: "name variant",
  embedding: "similar name",
};

type Filter = "open" | "confirmed" | "rejected";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "open", label: "To review" },
  { key: "confirmed", label: "Merged" },
  { key: "rejected", label: "Kept separate" },
];

const EMPTY_COPY: Record<Filter, string> = {
  open: "No duplicate suggestions to review. 🎉",
  confirmed: "No merges yet.",
  rejected: "No rejected pairs yet.",
};

export function DuplicatesClient({ initial }: DuplicatesClientProps) {
  const [filter, setFilter] = useState<Filter>("open");
  // Cache per-filter so switching tabs is instant; "open" seeds from the server.
  const [cache, setCache] = useState<Partial<Record<Filter, CandidateLink[]>>>({ open: initial });
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const links = cache[filter];

  const load = async (f: Filter) => {
    setError(null);
    try {
      const res = await fetch(`/api/graph/candidates?status=${f}`);
      const data = await res.json();
      setCache((c) => ({ ...c, [f]: data.candidates ?? [] }));
    } catch {
      setError("Failed to load — please retry");
    }
  };

  const switchFilter = (f: Filter) => {
    setFilter(f);
    if (!cache[f]) void load(f);
  };

  const act = async (id: string, verdict: "confirmed" | "rejected" | "undo") => {
    setError(null);
    setBusy((b) => new Set(b).add(id));
    try {
      const res = await fetch(`/api/graph/candidates/${id}/${verdict}`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Action failed");
        return;
      }
      // Drop the card from the current view; invalidate the destination filter's
      // cache so it refetches fresh (statuses moved between buckets).
      setCache((c) => {
        const next = { ...c, [filter]: (c[filter] ?? []).filter((l) => l.id !== id) };
        if (verdict === "undo") {
          delete next.open;
        } else if (verdict === "confirmed") {
          delete next.confirmed;
        } else {
          delete next.rejected;
        }
        return next;
      });
    } catch {
      setError("Network error — please retry");
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(id);
        return n;
      });
    }
  };

  return (
    <section>
      <h2 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
        <span className="w-3 h-3 bg-amber-500 rounded-full" />
        Possible Duplicates
      </h2>
      <p className="text-sm text-foreground-muted mb-4">
        These pairs look like the same entity. Nothing is merged automatically — confirm to merge
        them into one, or reject to keep them separate. Any decision can be undone.
      </p>

      {/* Status filter */}
      <div className="inline-flex gap-1 mb-4 p-1 rounded-lg bg-surface-elevated">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => switchFilter(f.key)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              filter === f.key
                ? "bg-primary text-white"
                : "text-foreground-muted hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {links === undefined ? (
        <div className="bg-surface-elevated rounded-lg p-8 text-center text-foreground-muted text-sm">
          Loading…
        </div>
      ) : links.length === 0 ? (
        <div className="bg-surface-elevated rounded-lg p-8 text-center text-foreground-muted text-sm">
          {EMPTY_COPY[filter]}
        </div>
      ) : (
        <ul className="space-y-3">
          {links.map((l) => {
            const isBusy = busy.has(l.id);
            return (
              <li
                key={l.id}
                className="bg-surface-elevated rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-4"
              >
                <div className="flex-1 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <EntityChip e={l.a} />
                  <span className="text-foreground-muted text-xs select-none">≈</span>
                  <EntityChip e={l.b} align="right" />
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-foreground-muted mr-1">
                    {METHOD_LABEL[l.method] ?? l.method}
                    {l.score != null ? ` · ${(l.score * 100).toFixed(0)}%` : ""}
                  </span>
                  {filter === "open" ? (
                    <>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => act(l.id, "confirmed")}
                        className="px-3 py-1.5 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        Same
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => act(l.id, "rejected")}
                        className="px-3 py-1.5 text-sm rounded-lg border border-border text-foreground-muted hover:text-foreground hover:bg-surface disabled:opacity-50 transition-colors"
                      >
                        Different
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => act(l.id, "undo")}
                      className="px-3 py-1.5 text-sm rounded-lg border border-border text-foreground-muted hover:text-foreground hover:bg-surface disabled:opacity-50 transition-colors"
                    >
                      Undo
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function EntityChip({ e, align = "left" }: { e: CandidateEntity; align?: "left" | "right" }) {
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <div className="text-sm font-medium text-foreground truncate">{e.name}</div>
      <div className="text-xs text-foreground-muted">{e.type}</div>
    </div>
  );
}
