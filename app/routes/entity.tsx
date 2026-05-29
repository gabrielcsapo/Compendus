import { Link } from "react-flight-router/client";
import { getEntityDetail } from "../lib/knowledge/graph";
import { EntityDetailView } from "../components/EntityDetailView";

/**
 * Entity detail — the "learn more" page for a single node in the Living Library.
 * Reached from Wander ("go deeper") and, soon, the Appendix index. Renders the
 * full source-grounded picture: connections + every passage across your books.
 */
export default async function EntityPage({ params }: { params?: Record<string, string> }) {
  const id = params?.id as string;
  const entity = getEntityDetail(id);

  if (!entity) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <p className="font-serif text-2xl text-foreground">That idea isn't in the library yet.</p>
        <Link
          to="/library"
          className="mt-4 inline-block text-amber-600 dark:text-amber-400 hover:underline text-sm"
        >
          Back to your library →
        </Link>
      </div>
    );
  }

  return <EntityDetailView entity={entity} />;
}
