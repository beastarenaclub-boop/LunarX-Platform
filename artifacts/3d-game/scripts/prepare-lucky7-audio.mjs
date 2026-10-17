// Usage: node artifacts/3d-game/scripts/prepare-lucky7-audio.mjs <2 dice roll pack folder> <ffmpeg>
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [pack, ffmpeg = "ffmpeg"] = process.argv.slice(2);
if (!pack) throw new Error("Supply the extracted '2 dice roll (29 throws)' pack by RPG (CC0).");
const output = fileURLToPath(new URL("../src/assets/audio/lucky7/", import.meta.url));
mkdirSync(output, { recursive: true });
const rate = 48000;
// From the first table contact to rest in tableDiceMotion.ts (56 frames at 24 fps).
const duration = 56 / 24 * (1 - .23);
function clip(source, name, start, end) {
  // Keep the ENTIRE uneven two-dice tumble. Remove low table resonance and
  // fit the take using pitch-preserving tempo, never loop isolated impacts.
  const tempo = (end - start) / duration;
  const decoded = spawnSync(ffmpeg, ["-v", "error", "-i", path.join(pack, `${source}.wav`),
    "-af", `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,highpass=f=280,highpass=f=280,lowpass=f=10000,atempo=${tempo},apad,atrim=duration=${duration}`,
    "-ac", "1", "-ar", String(rate), "-f", "f32le", "-"], { windowsHide: true });
  if (decoded.status !== 0) throw new Error(decoded.stderr.toString());
  const samples = new Float32Array(decoded.stdout.buffer, decoded.stdout.byteOffset, decoded.stdout.length / 4);
  if (!samples.some(sample => Math.abs(sample) > .01)) throw new Error(`Silent recording: ${source}`);
  const length = Math.round(duration * rate);
  const pcm = new Float32Array(length);
  let peak = 0;
  for (let i = 0; i < length; i++) {
    const fade = Math.min(1, i / (rate * .001), (length - 1 - i) / (rate * .04));
    pcm[i] = (samples[i] ?? 0) * fade;
    peak = Math.max(peak, Math.abs(pcm[i]));
  }
  const wav = Buffer.alloc(44 + length * 2);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
  wav.writeUInt32LE(length * 2, 40);
  pcm.forEach((sample, i) => wav.writeInt16LE(Math.round(sample / peak * .68 * 32767), 44 + i * 2));
  writeFileSync(path.join(output, `${name}.wav`), wav);
}
clip("dice-16", "roll-1", .056, 1.48);
clip("dice-27", "roll-2", .049, 1.50);
clip("dice-29", "roll-3", .047, 2.36);
writeFileSync(path.join(output, "LICENSE.txt"),
  "Lucky 7: complete recordings of two dice rolling\n" +
  "Original: 2 dice roll (29 throws), by RPG, 2013-08-30\n" +
  "Source: https://opengameart.org/content/2-dice-roll-29-throws\n" +
  "Download: https://opengameart.org/sites/default/files/Dice%20sound.7z\n" +
  "License: CC0 1.0 Universal (public domain)\nhttps://creativecommons.org/publicdomain/zero/1.0/\n" +
  "roll-1 = dice-16.wav; roll-2 = dice-27.wav; roll-3 = dice-29.wav.\n" +
  "Edits: trim silence, remove low table resonance, pitch-preserving tempo fit, fades, peak level .68.\n" +
  "Complete irregular rolling tails retained. Mono PCM WAV, 48 kHz, 16-bit.\n");
console.log(`Prepared three complete dice rolls in ${output}`);
