import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig(async ({ command }) => {
  // `base` controls the public path that built assets are served from. It is
  // needed for BOTH the dev server and the production `vite build`. In dev the
  // artifact injects BASE_PATH; the production build step does not receive it,
  // so fall back to this artifact's served path.
  const basePath = process.env.BASE_PATH ?? "/";

  // PORT is only needed when Vite actually runs a server (dev or `preview`).
  // `vite build` does not start a server, so PORT must NOT be required there —
  // requiring it at module load broke the production build.
  let port: number | undefined;
  if (command === "serve") {
    const rawPort = process.env.PORT;
    if (!rawPort) {
      throw new Error(
        "PORT environment variable is required but was not provided.",
      );
    }
    port = Number(rawPort);
    if (Number.isNaN(port) || port <= 0) {
      throw new Error(`Invalid PORT value: "${rawPort}"`);
    }
  }

  return {
    base: basePath,
    // Vite's built-in asset list has no 3D formats, so the generated table
    // asset pack (tools/table-assets) would otherwise be parsed as JS.
    assetsInclude: ["**/*.glb"],
    plugins: [
      react(),
      tailwindcss(),
      runtimeErrorOverlay(),
      ...(process.env.NODE_ENV !== "production" &&
      process.env.REPL_ID !== undefined
        ? [
            await import("@replit/vite-plugin-cartographer").then((m) =>
              m.cartographer({
                root: path.resolve(import.meta.dirname, ".."),
              }),
            ),
            await import("@replit/vite-plugin-dev-banner").then((m) =>
              m.devBanner(),
            ),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      host: "0.0.0.0",
      allowedHosts: true,
      proxy: {
        "/api": { target: process.env.API_PROXY_TARGET ?? "http://127.0.0.1:5200" },
        "/ws": { target: process.env.API_PROXY_TARGET ?? "http://127.0.0.1:5200", ws: true },
      },
      // Playwright traces contain HTML snapshots; watching them reloads the
      // game repeatedly while a test is trying to observe dealer playback.
      watch: { ignored: ["**/test-results*/**", "**/playwright-report/**", "**/dist/**", "**/*_BurstDebugInformation_DoNotShip/**"] },
      fs: {
        strict: true,
      },
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
});
