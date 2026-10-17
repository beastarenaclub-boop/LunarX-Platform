import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.resolve(import.meta.dirname, "lottery"),
  plugins: [react()],
  build: { outDir: "../dist/lottery", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 5191,
    strictPort: true,
    proxy: { "/api/lottery": "http://127.0.0.1:5190" },
  },
});
