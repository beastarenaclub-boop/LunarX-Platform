import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderPirateSound } from "../src/game/pirateSounds.ts";

// Node 22.18+ strips the renderer's TypeScript types. No audio tooling is needed.
const output = resolve(process.argv[2] ?? fileURLToPath(new URL("../../../exports/chicken-road-pirate-audio", import.meta.url)));
const rate = 48000;
const cues = ["idle", "select", "bet", "reveal", "crash", "win", "clear", "music"];
mkdirSync(output, { recursive: true });
function wav(samples) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, i) => bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + i * 2));
  return bytes;
}
const manifest = {
  name: "Chicken Road Pirate Edition — original sound pack",
  origin: "Original synthesized audio; no recordings extracted from the reference website.",
  sampleRate: rate,
  files: {},
};
const segments = [];
for (const cue of cues) {
  const samples = renderPirateSound(cue, rate);
  writeFileSync(resolve(output, `${cue}.wav`), wav(samples));
  manifest.files[cue] = { file: `${cue}.wav`, seconds: samples.length / rate, loop: cue === "music" };
  segments.push(samples, new Float32Array(rate * .4));
}
const preview = new Float32Array(segments.reduce((count, samples) => count + samples.length, 0));
let offset = 0;
for (const samples of segments) { preview.set(samples, offset); offset += samples.length; }
writeFileSync(resolve(output, "preview.wav"), wav(preview));
writeFileSync(resolve(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ output, clips: cues.length, previewSeconds: preview.length / rate }));
