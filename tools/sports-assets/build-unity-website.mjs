import { build } from "../../artifacts/3d-game/node_modules/vite/dist/node/index.js";
import { resolve } from "node:path";

// Preserve unrelated public game/media assets already present in dist/public.
// The Unity player is copied separately after a successful application build.
const root = resolve(import.meta.dirname, "../..");
await build({
  configFile: resolve(root, "artifacts/3d-game/vite.config.ts"),
  build: { copyPublicDir: false, emptyOutDir: false },
});
await import("./copy-unity-build.mjs");
