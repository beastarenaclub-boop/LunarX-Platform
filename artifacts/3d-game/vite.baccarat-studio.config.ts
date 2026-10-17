import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
export default defineConfig({
  root: path.resolve(import.meta.dirname, "tests/fixtures/baccarat-studio"),
  publicDir: path.resolve(import.meta.dirname, "public"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
    dedupe: ["react", "react-dom"],
  },
  cacheDir: path.resolve(
    import.meta.dirname,
    "node_modules/.vite-baccarat-studio",
  ),
  build: {
    outDir: path.resolve(
      import.meta.dirname,
      "../../tmp/baccarat-reference/build",
    ),
    emptyOutDir: true,
    copyPublicDir: false,
  },
  server: {
    host: "127.0.0.1",
    port: 5386,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:5200",
      "/ws": { target: "ws://127.0.0.1:5200", ws: true },
    },
  },
});
