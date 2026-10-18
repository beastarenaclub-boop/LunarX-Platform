// DB-IP Lite, CC BY 4.0. Keep the attribution link beside displayed locations.
// Downloaded at image build time: customer IPs never leave the application.
import { createHash } from "node:crypto";
import { createGunzip } from "node:zlib";
import { createWriteStream } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
const source = "https://download.db-ip.com/free/dbip-city-lite-2026-10.mmdb.gz";
const expected = "df17bd24390108ed1d24dcb7718dc60f6b9abd4f";
const directory = process.argv[2] ?? "/app/geo";
await mkdir(directory, { recursive: true });
const response = await fetch(source, { signal: AbortSignal.timeout(180_000) });
if (!response.ok || !response.body) throw Error("Geo database download failed");
const compressedHash = createHash("sha1"),
  plainHash = createHash("sha1");
const tap = (hash) =>
  new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
await pipeline(
  Readable.fromWeb(response.body),
  tap(compressedHash),
  createGunzip(),
  tap(plainHash),
  createWriteStream(directory + "/city.tmp"),
);
// The publisher's checksum may describe either the download or its MMDB payload.
if (![compressedHash.digest("hex"), plainHash.digest("hex")].includes(expected))
  throw Error("Geo database checksum mismatch");
await rename(directory + "/city.tmp", directory + "/dbip-city-lite.mmdb");
console.log("Installed DB-IP Lite city database, October 2026");
