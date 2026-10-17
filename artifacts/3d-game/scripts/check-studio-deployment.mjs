import assert from "node:assert/strict";
import { stat } from "node:fs/promises";

// Check the deployed media, not just the app's HTML or its audio graph. A SPA
// fallback can return HTTP 200 while the actual dealer scene is missing.
const base = new URL(process.argv[2] || "http://localhost:5200");
const assets = [
  ["media/baccarat/clean-table.png", "image/png"],
  ["media/baccarat/dealer-studio.mp4", "video/mp4"],
  ["media/baccarat/audio/vip-lounge.mp3", "audio/mpeg"],
  ["unity-horse/index.html", "text/html"],
  ["unity-horse/Build/WebGL.wasm", "application/wasm"],
  ["unity-horse/Build/WebGL.data", "application/octet-stream"],
];
for (const [name, type] of assets) {
  const response = await fetch(new URL(name, base), { method: "HEAD", headers: { "Accept-Encoding": "identity" } });
  assert.equal(response.status, 200, `${name}: missing asset`);
  assert.ok(response.headers.get("content-type")?.startsWith(type), `${name}: wrong MIME type; possible HTML fallback`);
  const file = await stat(new URL(`../public/${name}`, import.meta.url));
  assert.equal(Number(response.headers.get("content-length")), file.size, `${name}: deployed file differs in size`);
  console.log(`PASS ${name}`);
}
const range = await fetch(new URL("media/baccarat/dealer-studio.mp4", base), { headers: { Range: "bytes=0-31" } });
assert.equal(range.status, 206, "Dealer video must support byte ranges");
assert.equal((await range.arrayBuffer()).byteLength, 32);
const missing = await fetch(new URL("media/baccarat/missing-deployment-check.mp4", base), { method: "HEAD" });
assert.equal(missing.status, 404, "Missing studio media must not return the app HTML");
console.log("PASS video byte ranges and missing-media handling");
