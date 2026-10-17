#!/usr/bin/env node
// Post-process orval-generated client to support raw binary upload bodies.
// orval emits `body: JSON.stringify(<body>)` for every operation, even when
// the spec declares `application/octet-stream`. For binary uploads we want
// to forward the Blob/ArrayBuffer/Buffer through as-is.
//
// Strategy: locate any function that sets
// `"Content-Type": "application/octet-stream"` and rewrite the immediately
// following `body: JSON.stringify(<expr>),` to `body: <expr>,`.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "..", "..", "api-client-react", "src", "generated", "api.ts");

const src = readFileSync(target, "utf8");

const patched = src.replace(
  /("Content-Type":\s*"application\/octet-stream",[\s\S]*?)body:\s*JSON\.stringify\(([^)]+)\),/g,
  (_match, header, expr) => `${header}body: ${expr.trim()},`,
);

if (patched === src) {
  console.warn("[post-codegen] No octet-stream upload bodies found to patch.");
} else {
  writeFileSync(target, patched);
  console.log("[post-codegen] Patched octet-stream upload body forwarding.");
}
