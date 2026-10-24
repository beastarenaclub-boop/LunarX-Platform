import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
export default defineConfig({
  root: path.resolve(import.meta.dirname, "tests/fixtures/teenpatti-joker"),
  publicDir: path.resolve(import.meta.dirname, "public"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
    dedupe: ["react", "react-dom"],
  },
  cacheDir: path.resolve(
    import.meta.dirname,
    "node_modules/.vite-teenpatti-joker",
  ),
  build: {
    outDir: path.resolve(
      import.meta.dirname,
      "../../tmp/teenpatti-joker/preview",
    ),
    emptyOutDir: true,
    copyPublicDir: false,
  },
  server: {
    host: "127.0.0.1",
    port: 5384,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:5200" },
  },
});
