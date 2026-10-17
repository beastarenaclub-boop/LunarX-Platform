import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.resolve(import.meta.dirname, "wingo"),
  plugins: [react()],
  build: { outDir: "../dist/wingo", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 5193,
    strictPort: true,
    proxy: { "/api/wingo": "http://127.0.0.1:5192" },
  },
});
