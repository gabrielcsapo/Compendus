import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import rsc from "@vitejs/plugin-rsc";
import { defineConfig } from "vite";
import { resolve } from "path";
import { reactRouter } from "./react-router-vite/plugin.js";

const API_SERVER = "http://localhost:3001";

const proxyConfig = {
  "/api": API_SERVER,
  "/books": API_SERVER,
  "/covers": API_SERVER,
  "/comic": API_SERVER,
  "/mobi-images": API_SERVER,
  // EPUB internal resources: /book/:id/<resource-path>
  // Must not intercept React Router routes: /book/:id and /book/:id/read
  "/book": {
    target: API_SERVER,
    bypass(req: { url?: string }) {
      const url = req.url || "";
      const match = url.match(/^\/book\/[a-f0-9-]+\/(.+)$/);
      const pathPart = match?.[1]?.split("?")[0];
      if (match && pathPart && !/^read(\..+)?$/.test(pathPart)) {
        return undefined; // proxy to Hono
      }
      return url; // bypass proxy, let Vite/React Router handle
    },
  },
};

export default defineConfig({
  clearScreen: false,
  build: {
    minify: false,
  },
  plugins: [
    tailwindcss(),
    react(),
    reactRouter(),
    rsc({
      entries: {
        client: "./react-router-vite/entry.browser.tsx",
        ssr: "./react-router-vite/entry.ssr.tsx",
        rsc: "./react-router-vite/entry.rsc.single.tsx",
      },
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./app"),
    },
  },
  optimizeDeps: {
    include: ["react-router", "react-router/internal/react-server-client"],
    exclude: ["better-sqlite3"],
  },
  preview: {
    // Allow connections from iOS simulator and local network devices
    host: true,
    port: 3000,
    // Allow requests from reverse proxy with different origin
    allowedHosts: ["*"],
    proxy: proxyConfig,
  },
  server: {
    // Allow connections from iOS simulator and local network devices
    host: true,
    port: 3000,
    // Serve static files from data directory
    fs: {
      allow: ["..", "./data"],
    },
    // Allow requests from reverse proxy with different origin
    allowedHosts: ["*"],
    proxy: proxyConfig,
  },
  // Public directory for static assets
  publicDir: "public",
}) as any;
