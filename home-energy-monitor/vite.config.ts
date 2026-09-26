import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  // Relative asset URLs, so the bundle works underneath an arbitrary
  // Home Assistant Ingress path.
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
    // Keep the Pi's browser-facing payload small. ECharts is loaded as its
    // own lazy chunk from the chart component rather than the app shell.
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        // /api/events is an SSE stream and must not be buffered.
        ws: false,
      },
    },
  },
});
