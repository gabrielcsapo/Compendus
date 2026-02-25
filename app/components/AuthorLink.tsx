"use client";

import { Link, useRouter } from "react-flight-router/client";

interface AuthorLinkProps {
  name: string;
  className?: string;
  /** Use span with onClick instead of Link (for use inside other Links) */
  asSpan?: boolean;
}

function AuthorLink({ name, className = "", asSpan = false }: AuthorLinkProps) {
  const { navigate } = useRouter();
  const href = `/author/${encodeURIComponent(name)}`;

  if (asSpan) {
    return (
      <span
        role="link"
        tabIndex={0}
        className={`cursor-pointer hover:underline ${className}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          navigate(href);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            navigate(href);
          }
        }}
      >
        {name}
      </span>
    );
  }

  return (
    <Link to={href} className={`hover:underline ${className}`}>
      {name}
    </Link>
  );
}

interface AuthorLinksProps {
  authors: string[];
  className?: string;
  asSpan?: boolean;
  separator?: string;
}

export function AuthorLinks({
  authors,
  className = "",
  asSpan = false,
  separator = ", ",
}: AuthorLinksProps) {
  if (authors.length === 0) return null;

  // Filter to only valid string authors (handles corrupted data gracefully)
  const validAuthors = authors.filter(
    (author): author is string => typeof author === "string" && author.length > 0
  );

  if (validAuthors.length === 0) return null;

  return (
    <>
      {validAuthors.map((author, index) => (
        <span key={`${author}-${index}`}>
          <AuthorLink name={author} className={className} asSpan={asSpan} />
          {index < validAuthors.length - 1 && separator}
        </span>
      ))}
    </>
  );
}
