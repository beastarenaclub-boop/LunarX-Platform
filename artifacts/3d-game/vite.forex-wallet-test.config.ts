import { defineConfig, mergeConfig } from "vite";
import appConfig from "./vite.config";

export default defineConfig(async env => mergeConfig(await appConfig(env), {
  server: { proxy: Object.fromEntries(["/api", "/ws"].map(path => [path, {
    target: process.env.FOREX_TEST_API || "http://127.0.0.1:5199", changeOrigin: true, ws: true,
  }])) },
}));
