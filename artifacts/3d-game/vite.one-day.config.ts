import { defineConfig } from "vite";
import base from "./vite.config";

// Keep timing tests stable while other games or generated bundles are edited.
export default defineConfig(async (env) => {
  const config = await (typeof base === "function" ? base(env) : base);
  return {
    ...config,
    server: {
      ...config.server,
      hmr: false,
      watch: {
        ignored: [
          "**/dist/**",
          "**/test-results*/**",
          "**/playwright-report/**",
        ],
      },
    },
  };
});
