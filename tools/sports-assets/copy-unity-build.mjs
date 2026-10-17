import { cp, access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = resolve(root, "artifacts/3d-game/public/unity-sports");
try {
  await access(resolve(source, "ready.json"));
} catch {
  console.log(
    "Unity WebGL build is not available yet; existing sports renderer retained.",
  );
  process.exit(0);
}
const manifest = JSON.parse(
  await readFile(resolve(source, "ready.json"), "utf8"),
);
if (manifest.engine !== "unity" || manifest.sports?.length !== 5)
  throw new Error("Incomplete Unity build manifest");
for (const destination of [
  "artifacts/3d-game/dist/virtual-sports/unity-sports",
  "artifacts/3d-game/dist/public/unity-sports",
])
  await cp(source, resolve(root, destination), { recursive: true });
for (const destination of ['artifacts/3d-game/dist/virtual-sports/virtual-sports/audio','artifacts/3d-game/dist/public/virtual-sports/audio'])
  await cp(resolve(root,'artifacts/3d-game/public/virtual-sports/audio'),resolve(root,destination),{recursive:true});
console.log(
  "Unity WebGL copied to the main website and standalone sports build.",
);
