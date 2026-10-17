import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  root: path.resolve(import.meta.dirname, "tests/fixtures/pirate-audio"),
  publicDir: path.resolve(import.meta.dirname, "public"),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") }, dedupe: ["react", "react-dom"] },
  cacheDir: path.resolve(import.meta.dirname, "node_modules/.vite-pirate-audio"),
  build: { outDir: path.resolve(import.meta.dirname, "../../tmp/pirate-audio-preview"), copyPublicDir: false },
  server: { host: "127.0.0.1", port: 5369, strictPort: true },
});
