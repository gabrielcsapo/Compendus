import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import mdx from "@mdx-js/rollup";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import rehypeSlug from "rehype-slug";
import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "path";

export default defineConfig({
  base: "/compendus/",
  plugins: [
    {
      name: "compendus-shared-brand-assets",
      buildStart() {
        for (const fileName of ["favicon.svg", "apple-touch-icon.png"]) {
          this.emitFile({
            type: "asset",
            fileName,
            source: readFileSync(resolve(__dirname, `../public/${fileName}`)),
          });
        }
      },
    },
    {
      enforce: "pre" as const,
      ...mdx({
        remarkPlugins: [remarkGfm, remarkFrontmatter],
        rehypePlugins: [rehypeSlug],
      }),
    },
    tailwindcss(),
    react(),
  ],
  resolve: {
    alias: {
      "@app": resolve(__dirname, "../app"),
      "@content": resolve(__dirname, "content"),
    },
  },
  build: {
    outDir: "dist",
  },
});
