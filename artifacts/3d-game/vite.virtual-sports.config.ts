import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
  root: path.resolve(import.meta.dirname, "virtual-sports"),
  publicDir: path.resolve(import.meta.dirname, "public"),
  plugins: [react()],
  build: {
    outDir: "../dist/virtual-sports",
    emptyOutDir: true,
    copyPublicDir: false,
    rollupOptions: { output: { manualChunks: { three: ["three"] } } },
  },
  server: {
    host: "127.0.0.1",
    fs: { allow: [path.resolve(import.meta.dirname, "../..")] },
  },
});
