import type { CSSProperties, ReactNode } from "react";
import type { BookType } from "../lib/book-types";

export function BookObject({
  children,
  type,
  className = "",
  surfaceClassName = "",
  style,
}: {
  children: ReactNode;
  type: BookType;
  className?: string;
  surfaceClassName?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`book-object ${className}`} data-book-type={type}>
      <div className={`book-object-surface ${surfaceClassName}`} style={style}>
        {children}
      </div>
    </div>
  );
}
