"use client";

import { Link } from "react-flight-router/client";
import type { Book } from "../../lib/db/schema";
import { BookCover } from "../BookCover";

export function RecentlyAddedRow({ books }: { books: Book[] }) {
  if (books.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">Recently Added</h2>
        <Link
          to="/library"
          className="text-sm text-primary hover:text-primary-hover font-medium transition-colors"
        >
          View all
        </Link>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-3 scrollbar-none -mx-1 px-1">
        {books.map((book) => (
          <Link
            key={book.id}
            to={`/book/${book.id}`}
            className="group flex-shrink-0 w-24 transition-transform duration-200 hover:-translate-y-1"
          >
            <div
              className="aspect-[2/3] w-full rounded-lg overflow-hidden shadow-md group-hover:shadow-xl transition-shadow duration-200"
              style={{ backgroundColor: book.coverColor || undefined }}
            >
              <BookCover
                book={book}
                imgClassName="group-hover:scale-105 transition-transform duration-300"
                fallback={
                  <div className="w-full h-full flex items-center justify-center p-2 bg-gradient-to-br from-primary-light to-accent-light">
                    <span className="text-center text-foreground-muted text-xs font-medium line-clamp-3">
                      {book.title}
                    </span>
                  </div>
                }
              />
            </div>
            <h3 className="mt-1.5 text-xs font-medium text-foreground line-clamp-2 leading-tight px-0.5">
              {book.title}
            </h3>
          </Link>
        ))}
      </div>
    </section>
  );
}
