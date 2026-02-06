"use client";

import { Link, useNavigate } from "react-router";

interface AuthorLinkProps {
  name: string;
  className?: string;
  /** Use span with onClick instead of Link (for use inside other Links) */
  asSpan?: boolean;
}

export function AuthorLink({ name, className = "", asSpan = false }: AuthorLinkProps) {
  const navigate = useNavigate();
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

  return (
    <>
      {authors.map((author, index) => (
        <span key={author}>
          <AuthorLink name={author} className={className} asSpan={asSpan} />
          {index < authors.length - 1 && separator}
        </span>
      ))}
    </>
  );
}
