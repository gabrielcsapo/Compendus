import { Link, useFetcher } from "react-router";
import { useState, useRef, useEffect } from "react";
import { getAllHighlights, deleteHighlight, updateHighlightNote } from "../actions/reader";

type LoaderData = Awaited<ReturnType<typeof loader>>;

export async function loader() {
  const highlights = await getAllHighlights();

  // Group by bookId
  const grouped = new Map<
    string,
    {
      bookId: string;
      bookTitle: string;
      bookAuthors: string[];
      bookCoverPath?: string;
      bookFormat: string;
      highlights: typeof highlights;
    }
  >();

  for (const h of highlights) {
    if (!grouped.has(h.bookId)) {
      grouped.set(h.bookId, {
        bookId: h.bookId,
        bookTitle: h.bookTitle,
        bookAuthors: h.bookAuthors,
        bookCoverPath: h.bookCoverPath,
        bookFormat: h.bookFormat,
        highlights: [],
      });
    }
    grouped.get(h.bookId)!.highlights.push(h);
  }

  return {
    totalCount: highlights.length,
    groups: Array.from(grouped.values()),
  };
}

export async function action({ request }: { request: Request }) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete") {
    const highlightId = formData.get("highlightId") as string;
    if (highlightId) {
      await deleteHighlight(highlightId);
    }
  } else if (intent === "updateNote") {
    const highlightId = formData.get("highlightId") as string;
    const note = formData.get("note") as string;
    if (highlightId) {
      await updateHighlightNote(highlightId, note || null);
    }
  }

  return { ok: true };
}

function HighlightNote({
  highlightId,
  note,
}: {
  highlightId: string;
  note?: string;
}) {
  const fetcher = useFetcher();
  const [isEditing, setIsEditing] = useState(false);
  const [noteText, setNoteText] = useState(note || "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isEditing]);

  // Update local state when prop changes (e.g., after fetcher submission)
  useEffect(() => {
    if (!isEditing) {
      setNoteText(note || "");
    }
  }, [note, isEditing]);

  const handleSave = () => {
    const trimmed = noteText.trim();
    fetcher.submit(
      { intent: "updateNote", highlightId, note: trimmed },
      { method: "post" },
    );
    setIsEditing(false);
  };

  const handleCancel = () => {
    setNoteText(note || "");
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
        <textarea
          ref={textareaRef}
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Add a note..."
          rows={2}
          className="w-full px-2.5 py-2 text-sm rounded-md border border-border bg-surface-elevated resize-none focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSave();
            } else if (e.key === "Escape") {
              handleCancel();
            }
          }}
        />
        <div className="flex gap-2 mt-1.5">
          <button
            onClick={handleSave}
            className="text-xs px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Save
          </button>
          <button
            onClick={handleCancel}
            className="text-xs px-2.5 py-1 rounded text-foreground-muted hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (note) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsEditing(true);
        }}
        className="text-sm text-foreground-muted mt-2 text-left hover:underline cursor-pointer"
      >
        {note}
      </button>
    );
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setIsEditing(true);
      }}
      className="text-xs text-foreground-muted/60 mt-2 hover:text-foreground-muted hover:underline cursor-pointer"
    >
      Add note...
    </button>
  );
}

export default function Highlights({ loaderData }: { loaderData: LoaderData }) {
  const { totalCount, groups } = loaderData;

  return (
    <main className="container my-8 px-6 mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Highlights</h1>
        <p className="text-foreground-muted">
          {totalCount} {totalCount === 1 ? "highlight" : "highlights"} across{" "}
          {groups.length} {groups.length === 1 ? "book" : "books"}
        </p>
      </div>

      {groups.length > 0 ? (
        <div className="space-y-8">
          {groups.map((group) => (
            <div key={group.bookId}>
              {/* Book header */}
              <Link
                to={`/book/${group.bookId}`}
                className="flex items-center gap-4 mb-4 group"
              >
                {group.bookCoverPath ? (
                  <img
                    src={group.bookCoverPath}
                    alt={group.bookTitle}
                    className="w-12 h-[4.5rem] object-cover rounded-md shadow-sm"
                  />
                ) : (
                  <div className="w-12 h-[4.5rem] rounded-md bg-surface-elevated flex items-center justify-center">
                    <svg
                      className="w-6 h-6 text-foreground-muted"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                      />
                    </svg>
                  </div>
                )}
                <div>
                  <h2 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                    {group.bookTitle}
                  </h2>
                  <p className="text-sm text-foreground-muted">
                    {group.bookAuthors.join(", ") || "Unknown Author"}
                    {" · "}
                    {group.highlights.length}{" "}
                    {group.highlights.length === 1 ? "highlight" : "highlights"}
                  </p>
                </div>
              </Link>

              {/* Highlights list */}
              <div className="space-y-3 pl-4 border-l-2 border-border ml-6">
                {group.highlights.map((highlight) => (
                  <div
                    key={highlight.id}
                    className="bg-surface border border-border rounded-lg p-4 relative group/item"
                  >
                    <div className="flex gap-3">
                      {/* Color indicator */}
                      <div
                        className="w-1 rounded-full flex-shrink-0"
                        style={{ backgroundColor: highlight.color }}
                      />
                      <div className="flex-1 min-w-0">
                        {/* Highlighted text */}
                        <p className="text-foreground italic leading-relaxed">
                          &ldquo;{highlight.text}&rdquo;
                        </p>
                        {/* Note */}
                        <HighlightNote
                          highlightId={highlight.id}
                          note={highlight.note}
                        />
                        {/* Metadata */}
                        <div className="flex items-center gap-3 mt-2 text-sm text-foreground-muted">
                          <span>
                            {new Date(highlight.createdAt).toLocaleDateString(
                              undefined,
                              {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              },
                            )}
                          </span>
                        </div>
                      </div>
                      {/* Delete button */}
                      <form method="post" className="flex-shrink-0">
                        <input type="hidden" name="intent" value="delete" />
                        <input
                          type="hidden"
                          name="highlightId"
                          value={highlight.id}
                        />
                        <button
                          type="submit"
                          className="opacity-0 group-hover/item:opacity-100 transition-opacity p-1 rounded hover:bg-surface-elevated text-foreground-muted hover:text-red-500"
                          title="Delete highlight"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={1.5}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </form>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-16 bg-surface border border-border rounded-xl">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-elevated flex items-center justify-center">
            <svg
              className="w-8 h-8 text-foreground-muted"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
              />
            </svg>
          </div>
          <p className="text-foreground-muted mb-2">No highlights yet</p>
          <p className="text-foreground-muted/60 text-sm">
            Highlights you create while reading will appear here
          </p>
        </div>
      )}
    </main>
  );
}
