import type { ComponentType } from "react";
import { mdxComponents } from "./MdxComponents";

interface MdxPageProps {
  Component: ComponentType<{ components: Record<string, unknown> }>;
}

export function MdxPage({ Component }: MdxPageProps) {
  return (
    <article className="docs-article">
      <Component components={mdxComponents} />
    </article>
  );
}
