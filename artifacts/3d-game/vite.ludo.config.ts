import { defineConfig, mergeConfig } from "vite";
import sharedConfig from "./vite.config";
export default defineConfig(async (env) => {
  process.env.PORT = "5398";
  process.env.API_PROXY_TARGET = "http://127.0.0.1:5214";
  return mergeConfig(
    await (typeof sharedConfig === "function"
      ? sharedConfig(env)
      : sharedConfig),
    { define: { "import.meta.env.VITE_LOBBY_VARIANT": JSON.stringify("b2c") } },
  );
});
