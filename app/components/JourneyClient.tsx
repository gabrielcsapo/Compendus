"use client";

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-flight-router/client";
import { answerPod, getPod } from "../actions/substrate";
import type {
  PodAttemptResult,
  PodQuestion,
  PodSession,
  PodSessionItem,
  PodSummary,
  SourceLocator,
} from "../lib/learning/pods";

type AnswerState = {
  selectedChoiceId: string;
  attemptId?: string;
  submitting: boolean;
  result: PodAttemptResult | null;
  error?: string;
};

const ROLE_LABELS: Record<string, string> = {
  definition: "Definition",
  entry: "Starting point",
  derivation: "Reasoning",
  argument: "Argument",
  summary: "Summary",
  example: "Example",
  caveat: "Caveat",
  anecdote: "Story",
  application: "Application",
  exercise: "Exercise",
};

function sourceHref(source: SourceLocator): string {
  const params = new URLSearchParams();
  if (source.page != null && source.page > 0) {
    params.set("page", String(source.page));
  } else if (source.spineIndex != null && source.spineIndex >= 0) {
    params.set("spine", String(source.spineIndex));
    params.set("p", "0");
  }
  params.set("source", source.passageId);
  if (source.charStart != null) params.set("char", String(source.charStart));
  return `/book/${source.bookId}/read?${params.toString()}`;
}

function SourceLink({ source, onOpen }: { source: SourceLocator; onOpen?: () => void }) {
  return (
    <Link
      to={sourceHref(source)}
      onClick={onOpen}
      className="inline-flex items-center gap-1.5 rounded-full border border-amber-900/70 bg-amber-950/20 px-3 py-1.5 font-sans text-xs font-medium text-amber-200 transition-colors hover:border-amber-700 hover:bg-amber-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
    >
      Open in reader ↗
    </Link>
  );
}

function QuestionCard({
  podId,
  revision,
  question,
  state,
  onStateChange,
  onCorrect,
}: {
  podId: string;
  revision: string;
  question: PodQuestion;
  state: AnswerState | undefined;
  onStateChange: (state: AnswerState) => void;
  onCorrect: () => void;
}) {
  const selectedChoiceId = state?.selectedChoiceId ?? "";
  const result = state?.result ?? null;

  const submit = async () => {
    if (!selectedChoiceId || state?.submitting) return;
    const attemptId = state?.attemptId ?? crypto.randomUUID();
    onStateChange({ selectedChoiceId, attemptId, submitting: true, result });
    try {
      const nextResult = await answerPod(podId, revision, question.id, selectedChoiceId, attemptId);
      if (!nextResult) throw new Error("Question is no longer available");
      onStateChange({ selectedChoiceId, attemptId, submitting: false, result: nextResult });
      if (nextResult.correct) onCorrect();
    } catch {
      onStateChange({
        selectedChoiceId,
        attemptId,
        submitting: false,
        result: null,
        error: "The answer couldn't be checked. Try again.",
      });
    }
  };

  return (
    <section className="ml-0 rounded-2xl border border-amber-900/50 bg-amber-950/10 p-5 sm:ml-12 sm:p-6">
      <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-400/70">
        Check your understanding
      </p>
      <h3 className="mt-2 text-lg leading-snug text-stone-100">{question.prompt}</h3>
      <div className="mt-4 space-y-2">
        {question.choices.map((choice) => {
          const selected = selectedChoiceId === choice.id;
          return (
            <button
              key={choice.id}
              type="button"
              onClick={() =>
                onStateChange({ selectedChoiceId: choice.id, submitting: false, result: null })
              }
              aria-pressed={selected}
              disabled={state?.submitting || result?.correct}
              className={`w-full rounded-xl border px-4 py-3 text-left font-sans text-sm leading-relaxed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-default ${
                selected
                  ? "border-amber-700 bg-amber-950/35 text-stone-100"
                  : "border-stone-800 bg-stone-950/30 text-stone-400 hover:border-stone-600 hover:text-stone-200"
              }`}
            >
              {choice.text}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={!selectedChoiceId || state?.submitting || result?.correct}
          className="rounded-full bg-stone-100 px-4 py-2 font-sans text-sm font-medium text-stone-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {state?.submitting ? "Checking…" : result?.correct ? "Answered" : "Check answer"}
        </button>
        {result && (
          <p
            className={`font-sans text-sm ${result.correct ? "text-emerald-300" : "text-amber-200"}`}
            role="status"
          >
            {result.feedback}
          </p>
        )}
        {state?.error && (
          <p className="font-sans text-sm text-rose-300" role="alert">
            {state.error}
          </p>
        )}
      </div>

      {result && (
        <div className="mt-5 border-t border-stone-800 pt-4">
          <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-600">
            Evidence from {result.evidence.bookTitle}
          </p>
          <blockquote className="mt-2 text-sm leading-relaxed text-stone-400">
            “{result.evidence.excerpt}”
          </blockquote>
          <div className="mt-3">
            <SourceLink source={result.evidence} />
          </div>
        </div>
      )}
    </section>
  );
}

function SourceCard({
  item,
  reviewed,
  current,
  onToggleReviewed,
}: {
  item: PodSessionItem;
  reviewed: boolean;
  current: boolean;
  onToggleReviewed: () => void;
}) {
  return (
    <article
      className={`rounded-2xl border p-5 transition-colors sm:p-6 ${
        current ? "border-amber-800/70 bg-amber-950/15" : "border-stone-800 bg-stone-900/30"
      }`}
    >
      <div className="flex items-start gap-4">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border font-sans text-xs font-semibold ${
            reviewed
              ? "border-amber-500/70 bg-amber-400 text-stone-950"
              : "border-stone-700 text-stone-500"
          }`}
        >
          {reviewed ? "✓" : item.ordinal}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 font-sans text-[11px] uppercase tracking-[0.15em]">
            <span className="text-amber-400/70">{ROLE_LABELS[item.role] ?? item.role}</span>
            {item.source.chapterTitle && (
              <span className="truncate normal-case tracking-normal text-stone-600">
                {item.source.chapterTitle}
              </span>
            )}
          </div>
          {item.transition && (
            <p className="mt-2 font-sans text-xs leading-relaxed text-stone-500">
              {item.transition}
            </p>
          )}
          <blockquote className="mt-3 text-base leading-relaxed text-stone-200">
            {item.snippet}
          </blockquote>
          <p className="mt-4 font-sans text-xs text-stone-500">— {item.bookTitle}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <SourceLink source={item.source} onOpen={reviewed ? undefined : onToggleReviewed} />
            <button
              type="button"
              onClick={onToggleReviewed}
              aria-pressed={reviewed}
              className={`rounded-full border px-3 py-1.5 font-sans text-xs transition-colors ${
                reviewed
                  ? "border-stone-700 text-stone-400 hover:text-stone-200"
                  : "border-stone-800 text-stone-500 hover:border-stone-600 hover:text-stone-300"
              }`}
            >
              {reviewed ? "Reviewed ✓" : "Mark reviewed"}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

export function JourneyClient({ podId }: { podId: string }) {
  const [session, setSession] = useState<PodSession | null>(null);
  const [adjacent, setAdjacent] = useState<PodSummary[]>([]);
  const [reviewed, setReviewed] = useState<Set<string>>(() => new Set());
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSession(null);
    setAdjacent([]);
    setAnswers({});
    setError(null);
    getPod(podId)
      .then(({ session: nextSession, adjacent: nextAdjacent }) => {
        if (!nextSession) {
          setError("This Pod doesn’t have enough verified sources yet.");
          return;
        }
        setSession(nextSession);
        setAdjacent(nextAdjacent);
        setAnswers(
          Object.fromEntries(
            nextSession.questions.flatMap((question) =>
              question.savedAnswer
                ? [
                    [
                      question.id,
                      {
                        selectedChoiceId: question.savedAnswer.selectedChoiceId,
                        submitting: false,
                        result: question.savedAnswer.result,
                      },
                    ],
                  ]
                : [],
            ),
          ),
        );
        setReviewed(
          new Set([
            ...nextSession.items.filter((item) => item.seen).map((item) => item.passageId),
            ...nextSession.questions
              .filter((question) => question.savedAnswer?.result.correct)
              .map((question) => question.evidence.passageId),
          ]),
        );
      })
      .catch(() => setError("This Pod couldn't be loaded. Try returning to the Pod library."));
  }, [podId]);

  const questionsByOrdinal = useMemo(() => {
    const grouped = new Map<number, PodQuestion[]>();
    for (const question of session?.questions ?? []) {
      grouped.set(question.afterOrdinal, [...(grouped.get(question.afterOrdinal) ?? []), question]);
    }
    return grouped;
  }, [session]);

  const reviewedCount = session?.items.filter((item) => reviewed.has(item.passageId)).length ?? 0;
  const progress = session?.items.length ? reviewedCount / session.items.length : 0;
  const currentOrdinal = session?.items.find((item) => !reviewed.has(item.passageId))?.ordinal;

  const toggleReviewed = (passageId: string) => {
    setReviewed((current) => {
      const next = new Set(current);
      if (next.has(passageId)) next.delete(passageId);
      else next.add(passageId);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#0b0b0f] font-serif text-stone-200">
      <header className="sticky top-0 z-20 border-b border-stone-900/80 bg-[#0b0b0f]/90 px-6 py-4 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <Link
            to="/pods"
            className="rounded-full border border-stone-800 px-3 py-1.5 font-sans text-sm text-stone-500 transition-colors hover:border-stone-600 hover:text-stone-300"
          >
            ← All Pods
          </Link>
          {session && (
            <div className="min-w-32 text-right font-sans text-xs text-stone-500">
              <span>
                {reviewedCount} of {session.items.length} reviewed
              </span>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-stone-800">
                <div
                  className="h-full rounded-full bg-amber-400 transition-[width] duration-300"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-28 pt-9">
        {error ? (
          <div className="rounded-2xl border border-stone-800 bg-stone-900/30 p-6">
            <p className="font-sans text-sm text-stone-400">{error}</p>
            <Link
              to="/pods"
              className="mt-4 inline-block font-sans text-sm text-amber-300 hover:text-amber-200"
            >
              Browse Pods →
            </Link>
          </div>
        ) : !session ? (
          <p className="font-sans text-sm text-stone-600" role="status">
            Gathering the sources…
          </p>
        ) : (
          <>
            <p className="font-sans text-xs font-medium uppercase tracking-[0.26em] text-amber-500/70">
              {session.items.length}-source Pod
            </p>
            <h1 className="mt-3 max-w-2xl text-3xl leading-tight text-stone-100 sm:text-4xl">
              {session.title}
            </h1>
            <p className="mb-10 mt-4 max-w-xl font-sans text-sm leading-relaxed text-stone-500">
              Read each source here without leaving the Pod. Questions appear immediately after the
              passage they use; open the book only when you want the wider context.
            </p>

            <ol className="space-y-5">
              {session.items.map((item, index) => {
                const questions = questionsByOrdinal.get(item.ordinal) ?? [];
                const startsModule = index === 0 || session.items[index - 1].module !== item.module;
                return (
                  <li key={item.passageId}>
                    {startsModule && (
                      <div className="mb-3 mt-9 flex items-center gap-3 first:mt-0">
                        <span className="font-sans text-xs font-semibold uppercase tracking-[0.2em] text-amber-400/70">
                          {item.module}
                        </span>
                        <span className="h-px flex-1 bg-stone-800" />
                      </div>
                    )}
                    <SourceCard
                      item={item}
                      reviewed={reviewed.has(item.passageId)}
                      current={currentOrdinal === item.ordinal}
                      onToggleReviewed={() => toggleReviewed(item.passageId)}
                    />
                    {questions.map((question) => (
                      <div key={question.id} className="mt-4">
                        <QuestionCard
                          podId={session.podId}
                          revision={session.revision}
                          question={question}
                          state={answers[question.id]}
                          onStateChange={(nextState) =>
                            setAnswers((current) => ({
                              ...current,
                              [question.id]: nextState,
                            }))
                          }
                          onCorrect={() =>
                            setReviewed((current) =>
                              new Set(current).add(question.evidence.passageId),
                            )
                          }
                        />
                      </div>
                    ))}
                  </li>
                );
              })}
            </ol>

            {adjacent.length > 0 && (
              <section className="mt-14 border-t border-stone-800 pt-8">
                <p className="font-sans text-xs font-semibold uppercase tracking-[0.2em] text-stone-600">
                  Continue with another Pod
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {adjacent.slice(0, 4).map((pod) => (
                    <Link
                      key={pod.id}
                      to={`/pod/${pod.id}`}
                      className="rounded-2xl border border-stone-800 bg-stone-900/30 p-4 transition-colors hover:border-amber-900/70 hover:bg-stone-900/60"
                    >
                      <h2 className="leading-snug text-stone-200">{pod.title}</h2>
                      <p className="mt-2 font-sans text-xs text-stone-600">
                        {pod.passageCount} {pod.passageCount === 1 ? "passage" : "passages"} ·{" "}
                        {pod.bookCount} {pod.bookCount === 1 ? "book" : "books"} ·{" "}
                        {pod.questionCount} {pod.questionCount === 1 ? "check" : "checks"}
                      </p>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
