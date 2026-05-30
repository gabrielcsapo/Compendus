"use client";

import { useState, useRef, useLayoutEffect } from "react";

interface CollapsibleDescriptionProps {
  text: string;
  /** Collapsed height in number of lines (line-clamp). */
  collapsedLines?: number;
}

export function CollapsibleDescription({ text, collapsedLines = 6 }: CollapsibleDescriptionProps) {
  const [expanded, setExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  // Only show the toggle when the text actually overflows the collapsed height.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setIsClamped(el.scrollHeight > el.clientHeight + 1);
  }, [text]);

  return (
    <div className="max-w-prose">
      <p
        ref={ref}
        className="text-foreground whitespace-pre-line leading-relaxed break-words"
        style={
          expanded
            ? undefined
            : {
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: collapsedLines,
                overflow: "hidden",
              }
        }
      >
        {text}
      </p>
      {(isClamped || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-sm font-medium text-primary hover:text-primary-hover transition-colors cursor-pointer"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
