import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
//
// Base path handling for GitHub Pages:
// - When a custom domain (CNAME) is used, the site is served from the root
//   path, so `base` must be "/".
// - When served from a project page (https://<user>.github.io/<repo>/), the
//   `base` must be "/<repo>/" or the built asset URLs (/assets/...) will 404.
//
// Set the VITE_BASE environment variable (e.g. "/BattleField/") to override.
// Defaults to "/" which matches the custom-domain (CNAME) setup.
const base = process.env.VITE_BASE ?? "/";

export default defineConfig({
  base,
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
});
