import { defineConfig, mergeConfig } from "vite";
import mainConfig from "./vite.config";

process.env.PORT ??= "5290";
export default defineConfig(async (env) => {
  const base =
    typeof mainConfig === "function" ? await mainConfig(env) : mainConfig;
  const api = process.env.CRAZY_TIME_API_URL ?? "http://127.0.0.1:5291";
  return mergeConfig(base, {
    server: {
      host: "127.0.0.1",
      proxy: { "/api": api, "/ws": { target: api, ws: true } },
    },
  });
});
