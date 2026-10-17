import { defineConfig, mergeConfig } from "vite";
import appConfig from "./vite.config";
export default defineConfig(async env => mergeConfig(await appConfig(env), {
  server: { proxy: { "/api": { target: "http://127.0.0.1:5216", changeOrigin: true } } },
}));
