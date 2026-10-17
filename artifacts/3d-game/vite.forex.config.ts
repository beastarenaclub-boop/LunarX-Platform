import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
  root: path.resolve(import.meta.dirname, "forex"),
  plugins: [react()],
  build: { outDir: "../dist/forex", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 5197,
    strictPort: true,
    proxy: { "/api/forex": "http://127.0.0.1:5196" },
  },
});
