import { defineConfig, mergeConfig } from "vite";
import mainConfig from "./vite.config";

process.env.PORT ??= "5340";
export default defineConfig(async (env) => {
  const base =
    typeof mainConfig === "function" ? await mainConfig(env) : mainConfig;
  return mergeConfig(base, {
    // Large media exports can be locked by Windows while encoding. Restart Vite
    // after adding new public files so its static-file index includes them.
    server: { watch: { ignored: ["**/public/**"] } },
  });
});
