// Original 8-bar studio lounge composition; no samples or third-party music.
// Run from repository root. FFMPEG may point to an installed binary.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rate = 44100, bpm = 84, beat = 60 / bpm, duration = beat * 32;
const length = Math.round(rate * duration);
const left = new Float64Array(length), right = new Float64Array(length);
let randomSeed = 1075;
const random = () => ((randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0) / 2147483648 - 1);
const midi = note => 440 * 2 ** ((note - 69) / 12);
function mix(at, sample, pan = 0, echo = false) {
  const index = ((Math.round(at) % length) + length) % length;
  left[index] += sample * Math.sqrt((1 - pan) / 2);
  right[index] += sample * Math.sqrt((1 + pan) / 2);
  if (!echo) for (const [delay, gain] of [[.173, .13], [.307, .085], [.439, .05]])
    mix(index + delay * rate, sample * gain, -pan, true);
}
function rhodes(start, note, seconds, level, pan) {
  const frequency = midi(note);
  for (let i = 0; i < seconds * rate; i++) {
    const t = i / rate, phase = 2 * Math.PI * frequency * t;
    const envelope = Math.min(1, t / .012) * Math.exp(-t * 1.45) * Math.min(1, (seconds - t) / .1);
    const bell = Math.sin(phase + .7 * Math.exp(-t * 6) * Math.sin(phase * 2));
    mix(start * rate + i, (bell + .12 * Math.sin(phase * 2)) * envelope * level, pan);
  }
}
// D minor 9, G13, C major 9, A minor 9; each harmony lasts two bars.
const chords = [[50, 57, 60, 64, 69], [43, 53, 59, 64, 69], [48, 55, 59, 62, 67], [45, 55, 59, 60, 64]];
chords.forEach((notes, c) => {
  const bar = c * 8 * beat;
  for (const offset of [0, 3.5, 6]) notes.slice(1).forEach((note, voice) => rhodes(bar + offset * beat + voice * .008, note, 3.7, .047, (voice - 1.5) * .3));
  for (const offset of [0, 2, 4, 6.5]) rhodes(bar + offset * beat, notes[0] - 12, 1.4, .12, 0);
});
for (let b = 0; b < 32; b++) {
  const start = b * beat;
  // Gentle kick and brushed rim; quieter than the piano.
  if (b % 2 === 0) for (let i = 0; i < rate * .24; i++) {
    const t = i / rate;
    mix(start * rate + i, Math.sin(2 * Math.PI * (45 * t + 2.8 * (1 - Math.exp(-t * 32)))) * Math.exp(-t * 24) * Math.min(1, t / .003) * .12, 0);
  }
  if (b % 4 === 1 || b % 4 === 3) for (let i = 0; i < rate * .12; i++) {
    const t = i / rate;
    mix(start * rate + i, (random() * .03 + Math.sin(2 * Math.PI * 810 * t) * .01) * Math.exp(-t * 50), -.15);
  }
  for (const sub of [0, .53]) for (let i = 0; i < rate * .07; i++) {
    const t = i / rate;
    mix((start + sub * beat) * rate + i, random() * .009 * Math.exp(-t * 70) * Math.min(1, t / .003), .35);
  }
}
// A sparse answering melody avoids a relentless repeated announcement jingle.
[[1.5, 76], [4.5, 72], [7, 69], [10.5, 71], [14, 69], [17.5, 74], [20.5, 71], [23, 67], [26.5, 72], [30, 71]]
  .forEach(([at, note]) => rhodes(at * beat, note, 2.3, .035, .2));

let peak = 0;
for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
const wav = Buffer.alloc(44 + length * 4);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
wav.write("data", 36); wav.writeUInt32LE(length * 4, 40);
for (let i = 0; i < length; i++) {
  wav.writeInt16LE(Math.round(left[i] / peak * .72 * 32767), 44 + i * 4);
  wav.writeInt16LE(Math.round(right[i] / peak * .72 * 32767), 46 + i * 4);
}
const temporary = path.resolve("tmp/one-day-studio-lounge.wav");
const destination = path.resolve("artifacts/3d-game/public/media/dragon-tiger-one-day/studio-lounge.mp3");
fs.mkdirSync(path.dirname(temporary), { recursive: true });
fs.writeFileSync(temporary, wav);
const ffmpeg = process.env.FFMPEG ?? "tmp/dt-ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe";
const result = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", temporary, "-codec:a", "libmp3lame", "-b:a", "192k", destination], { encoding: "utf8", windowsHide: true });
if (result.status !== 0) throw new Error(result.stderr);
console.log(JSON.stringify({ file: destination, duration, sampleRate: rate, bpm, channels: 2 }));
