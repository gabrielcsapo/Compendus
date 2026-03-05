import { Suspense } from "react";
import { getRequest } from "react-flight-router/server";
import { getTagsWithCounts, getBooksWithTag } from "../actions/tags";
import TagsClient from "./tags.client";

export default function Tags() {
  return (
    <Suspense fallback={<TagsSkeleton />}>
      <TagsData />
    </Suspense>
  );
}

async function TagsData() {
  const request = getRequest()!;
  const url = new URL(request.url);
  const selectedTagId = url.searchParams.get("tag");

  const tags = await getTagsWithCounts();

  let books: Awaited<ReturnType<typeof getBooksWithTag>> = [];
  if (selectedTagId) {
    books = await getBooksWithTag(selectedTagId);
  }

  return (
    <TagsClient initialTags={tags} initialBooks={books} initialSelectedTagId={selectedTagId} />
  );
}

function TagsSkeleton() {
  return (
    <main className="container my-8 px-6 mx-auto">
      <div className="animate-pulse">
        <div className="h-8 bg-surface-elevated rounded w-24 mb-2" />
        <div className="h-4 bg-surface-elevated rounded w-16 mb-8" />
        <div className="bg-surface border border-border rounded-xl p-6 mb-8">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-8 bg-surface-elevated rounded-full w-20" />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
