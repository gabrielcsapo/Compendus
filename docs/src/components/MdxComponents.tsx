import type { ComponentPropsWithoutRef } from "react";
import { Link } from "react-router";
import { CodeBlock } from "@app/components/docs";

/**
 * Custom component overrides for MDX rendering.
 * Maps standard HTML elements to styled versions that match the docs theme.
 */
export const mdxComponents = {
  h1: (props: ComponentPropsWithoutRef<"h1">) => (
    <h1
      className="reading-title mb-4 scroll-mt-24 text-4xl leading-tight text-foreground sm:text-5xl"
      {...props}
    />
  ),
  h2: (props: ComponentPropsWithoutRef<"h2">) => (
    <h2
      className="reading-title mb-4 mt-14 scroll-mt-24 border-t border-border pt-8 text-2xl text-foreground sm:text-3xl"
      {...props}
    />
  ),
  h3: (props: ComponentPropsWithoutRef<"h3">) => (
    <h3 className="mb-3 mt-8 scroll-mt-24 text-lg font-bold text-foreground" {...props} />
  ),
  p: (props: ComponentPropsWithoutRef<"p">) => (
    <p className="mb-4 max-w-[46rem] text-[1.02rem] leading-8 text-foreground-muted" {...props} />
  ),
  a: ({ href, ...props }: ComponentPropsWithoutRef<"a">) => {
    if (href?.startsWith("/")) {
      return <Link to={href} className="text-primary hover:underline" {...props} />;
    }
    return (
      <a
        href={href}
        className="text-primary hover:underline"
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      />
    );
  },
  ul: (props: ComponentPropsWithoutRef<"ul">) => (
    <ul
      className="mb-5 ml-5 list-disc space-y-2.5 text-foreground-muted marker:text-primary"
      {...props}
    />
  ),
  ol: (props: ComponentPropsWithoutRef<"ol">) => (
    <ol
      className="mb-5 ml-5 list-decimal space-y-2.5 text-foreground-muted marker:font-bold marker:text-primary"
      {...props}
    />
  ),
  li: (props: ComponentPropsWithoutRef<"li">) => <li className="pl-1 leading-7" {...props} />,
  strong: (props: ComponentPropsWithoutRef<"strong">) => (
    <strong className="font-semibold text-foreground" {...props} />
  ),
  code: (props: ComponentPropsWithoutRef<"code">) => (
    <code
      className="rounded border border-border bg-surface-elevated px-1.5 py-0.5 font-mono text-sm text-foreground"
      {...props}
    />
  ),
  pre: ({ children }: ComponentPropsWithoutRef<"pre">) => {
    // Extract language and code text from the <code> child
    const codeElement = children as React.ReactElement<{
      className?: string;
      children?: string;
    }>;
    const className = codeElement?.props?.className ?? "";
    const lang = className.replace("language-", "");
    const code = codeElement?.props?.children ?? "";

    return <CodeBlock language={lang || undefined}>{code}</CodeBlock>;
  },
  table: (props: ComponentPropsWithoutRef<"table">) => (
    <div className="quiet-panel mb-6 overflow-x-auto">
      <table className="min-w-full text-sm" {...props} />
    </div>
  ),
  thead: (props: ComponentPropsWithoutRef<"thead">) => <thead {...props} />,
  th: (props: ComponentPropsWithoutRef<"th">) => (
    <th
      className="border-b border-border bg-surface-elevated px-4 py-3 text-left text-foreground-muted"
      {...props}
    />
  ),
  tbody: (props: ComponentPropsWithoutRef<"tbody">) => (
    <tbody className="text-foreground" {...props} />
  ),
  td: (props: ComponentPropsWithoutRef<"td">) => (
    <td className="border-b border-border/50 px-4 py-3" {...props} />
  ),
  hr: (props: ComponentPropsWithoutRef<"hr">) => <hr className="border-border my-8" {...props} />,
  blockquote: (props: ComponentPropsWithoutRef<"blockquote">) => (
    <blockquote
      className="my-6 border-l-2 border-accent bg-accent-light/45 py-4 pl-5 pr-4 text-foreground-muted"
      {...props}
    />
  ),
};
