import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // The engine stress tests step the full simulation for hundreds of frames.
    // With the enlarged battlefield these legitimately need more than vitest's
    // 5s default in the headless (CPU-only) test environment; the in-browser
    // real-time frame budget is unaffected (collision now uses a spatial grid).
    testTimeout: 30000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
