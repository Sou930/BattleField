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
    // Allow the sandbox proxy host to reach the dev server.
    allowedHosts: true,
    hmr: {
      overlay: false,
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 8080,
    // Allow the sandbox proxy host to reach the preview server.
    allowedHosts: true,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  build: {
    // Bump the warning threshold: three.js is intentionally a single large
    // vendor chunk, which is fine because it is long-term cacheable.
    chunkSizeWarningLimit: 900,
    // Drop dead code / debugging statements from the production bundle to
    // shave a little more off the shipped JS without touching behaviour.
    target: "es2020",
    // Use terser for the final minify pass. It compresses noticeably better
    // than the default esbuild minifier on large code bases like this one and
    // lets us strip dev-only `console.*` / `debugger` statements. Output is
    // behaviourally identical — only dead/diagnostic code is removed.
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        passes: 2,
      },
      format: {
        comments: false,
      },
    },
    rollupOptions: {
      output: {
        // Split only the heavy, self-contained three.js engine into its own
        // long-term-cacheable chunk. React and its ecosystem are intentionally
        // left in the main bundle: separating React internals across chunks can
        // break module init order (e.g. `useLayoutEffect` of undefined), so we
        // keep them together for correctness while still caching three.js apart.
        manualChunks(id) {
          if (id.includes("node_modules") && id.includes("/three/")) {
            return "three";
          }
        },
      },
    },
  },
});
