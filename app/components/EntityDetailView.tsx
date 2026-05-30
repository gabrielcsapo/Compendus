import { Link } from "react-flight-router/client";
import type { EntityDetail, MentionView, RelationshipView } from "../lib/knowledge/graph";

/**
 * The shared "learn more" atom of the Living Library: everything your library
 * says about one entity — its connections and every real passage where it
 * appears, grouped by book. Wander composes this for depth ("go deeper" on the
 * idea you're on); the Appendix browses straight into it. Awake/light mode,
 * inside the normal app chrome — the calm night surface is Wander's job.
 */

// Display names for the closed entity-type set; falls back to the raw type.
const TYPE_LABEL: Record<string, string> = {
  person: "Person",
  place: "Place",
  organization: "Organization",
  event: "Event",
  work: "Work",
  object: "Object",
  invention: "Invention",
  concept: "Concept",
  theme: "Theme",
  era: "Era",
};

function readerHref(m: MentionView): string {
  // Prefer a chapter-anchored locator (spine + within-chapter progress): the
  // reader shares the spine structure, so this lands on the right page where a
  // whole-book `position` fraction drifts (the pipeline's clean text and the
  // reader's rendered text are different char spaces). Fall back to the global
  // fraction, then to the book's detail page.
  if (m.spineIndex != null && m.chapterProgress != null) {
    return `/book/${m.bookId}/read?spine=${m.spineIndex}&p=${m.chapterProgress.toFixed(4)}`;
  }
  return m.position != null
    ? `/book/${m.bookId}/read?position=${m.position.toFixed(4)}`
    : `/book/${m.bookId}`;
}

function groupByBook(
  mentions: MentionView[],
): { bookId: string; bookTitle: string; items: MentionView[] }[] {
  const groups: { bookId: string; bookTitle: string; items: MentionView[] }[] = [];
  for (const m of mentions) {
    const last = groups[groups.length - 1];
    if (last && last.bookId === m.bookId) last.items.push(m);
    else groups.push({ bookId: m.bookId, bookTitle: m.bookTitle, items: [m] });
  }
  return groups;
}

function RelationshipRow({ rel }: { rel: RelationshipView }) {
  // out: this entity → other ("rival of Pompey"); in: other → this entity.
  const arrow = rel.direction === "out" ? "→" : "←";
  return (
    <Link
      to={`/entity/${rel.otherEntityId}`}
      className="group flex flex-col gap-1 rounded-xl border border-border hover:border-amber-500/50 bg-surface hover:bg-amber-500/[0.03] px-4 py-3 transition-colors"
    >
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-foreground-muted">
        <span className="text-amber-500/80">{arrow}</span>
        <span>{rel.label}</span>
        <span className="text-foreground-muted/60">
          · {TYPE_LABEL[rel.otherEntityType] ?? rel.otherEntityType}
        </span>
      </div>
      <div className="text-base text-foreground group-hover:text-amber-700 dark:group-hover:text-amber-300 transition-colors">
        {rel.otherEntityName}
      </div>
      {rel.reason ? (
        <div className="text-sm text-foreground-muted leading-snug">{rel.reason}</div>
      ) : null}
    </Link>
  );
}

export function EntityDetailView({ entity }: { entity: EntityDetail }) {
  const bookGroups = groupByBook(entity.mentions);
  const reach =
    `${entity.bookCount} ${entity.bookCount === 1 ? "book" : "books"}` +
    ` · ${entity.mentionCount} ${entity.mentionCount === 1 ? "mention" : "mentions"}`;

  return (
    <div className="mx-auto max-w-3xl px-5 sm:px-6 py-8">
      {/* hero */}
      <header className="mb-10">
        <div className="text-xs uppercase tracking-[0.2em] text-amber-600 dark:text-amber-500/80 font-medium mb-3">
          {TYPE_LABEL[entity.type] ?? entity.type}
          {entity.dateText ? (
            <span className="text-foreground-muted"> · {entity.dateText}</span>
          ) : null}
        </div>
        <h1 className="font-serif text-4xl sm:text-5xl leading-tight text-foreground">
          {entity.canonicalName}
        </h1>
        {entity.aliases.length > 0 ? (
          <p className="mt-2 text-sm text-foreground-muted">also: {entity.aliases.join(", ")}</p>
        ) : null}
        {entity.summary ? (
          <p className="mt-4 text-lg leading-relaxed text-foreground/85">{entity.summary}</p>
        ) : null}
        <p className="mt-4 text-sm text-foreground-muted">{reach}</p>
      </header>

      {/* connections */}
      {entity.relationships.length > 0 ? (
        <section className="mb-12">
          <h2 className="text-xs uppercase tracking-[0.2em] text-foreground-muted mb-4">
            Connections
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {entity.relationships.map((rel, i) => (
              <RelationshipRow key={rel.otherEntityId + rel.type + i} rel={rel} />
            ))}
          </div>
        </section>
      ) : null}

      {/* passages, grouped by book */}
      {bookGroups.length > 0 ? (
        <section>
          <h2 className="text-xs uppercase tracking-[0.2em] text-foreground-muted mb-4">
            In your library
          </h2>
          <div className="space-y-8">
            {bookGroups.map((g) => (
              <div key={g.bookId}>
                <Link
                  to={`/book/${g.bookId}`}
                  className="text-sm font-medium text-foreground hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
                >
                  {g.bookTitle}
                </Link>
                <ul className="mt-3 space-y-3 border-l border-border pl-4">
                  {g.items.map((m) => (
                    <li key={m.passageId}>
                      <Link
                        to={readerHref(m)}
                        className="group block rounded-lg -mx-2 px-2 py-1.5 hover:bg-surface transition-colors"
                      >
                        <p className="font-serif leading-relaxed text-foreground/90">{m.snippet}</p>
                        {m.chapterTitle ? (
                          <span className="mt-1 block text-xs text-foreground-muted group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                            {m.chapterTitle}
                            {m.page != null ? ` · p. ${m.page}` : ""} →
                          </span>
                        ) : (
                          <span className="mt-1 block text-xs text-foreground-muted group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                            Open in reader →
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <p className="text-foreground-muted">No passages recorded yet.</p>
      )}
    </div>
  );
}
