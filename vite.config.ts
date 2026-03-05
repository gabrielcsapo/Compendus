import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { flightRouter } from "react-flight-router/dev";
import { defineConfig } from "vite";
import { resolve } from "path";
import { apiPlugin } from "./vite-plugins/api.js";

export default defineConfig({
  clearScreen: false,
  build: {},
  plugins: [
    tailwindcss(),
    react(),
    apiPlugin(),
    flightRouter({ routesFile: "./app/routes.ts" }),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./app"),
    },
  },
  optimizeDeps: {
    exclude: ["better-sqlite3"],
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
  },
  // Public directory for static assets
  publicDir: "public",
}) as any;
