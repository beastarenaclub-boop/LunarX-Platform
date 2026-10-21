import { defineConfig } from "vite";
import base from "./vite.config";
export default defineConfig(async (env) => {
  process.env.PORT ??= "5298";
  const config = await (typeof base === "function" ? base(env) : base);
  return { ...config, server: { ...config.server, port: 5298, hmr: false } };
});
