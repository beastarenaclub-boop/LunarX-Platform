import { defineConfig, mergeConfig } from "vite";
import path from "node:path";
import sharedConfig from "./vite.config";

/** Separate storefront build, with the same game routes, assets and API client. */
export default defineConfig(async (env) => {
  if (env.command === "serve") process.env.PORT ??= "5180";
  const config =
    typeof sharedConfig === "function" ? await sharedConfig(env) : sharedConfig;
  return mergeConfig(config, {
    define: { "import.meta.env.VITE_LOBBY_VARIANT": JSON.stringify("b2c") },
    build: { outDir: path.resolve(import.meta.dirname, "dist/b2c") },
  });
});
