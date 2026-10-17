// Package completed Higgsfield renders as browser-compatible 1080p H.264/AAC.
// Usage: node artifacts/3d-game/scripts/prepare-one-day-commentary.mjs <production.json>
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const production = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const destination = path.resolve("artifacts/3d-game/public/media/dragon-tiger-one-day/commentary");
const voiceDestination = path.resolve("artifacts/3d-game/src/assets/dragon-tiger-one-day/voice");
const temporary = path.resolve("tmp/one-day-commentary-sources");
fs.mkdirSync(destination, { recursive: true });
fs.mkdirSync(voiceDestination, { recursive: true });
fs.mkdirSync(temporary, { recursive: true });
const ffmpeg = process.env.FFMPEG ?? "tmp/dt-ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe";
const ffprobe = process.env.FFPROBE ?? "tmp/dt-ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe";
function run(program, args) {
  const result = spawnSync(program, args, { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
}
const clips = {};
const records = [];
for (const take of production.takes) {
  if (!/^[a-z-]+$/.test(take.key) || !take.url?.startsWith("https://")) throw new Error("Invalid generated take");
  const original = path.join(temporary, `${take.key}.mp4`);
  if (!fs.existsSync(original)) {
    const response = await fetch(take.url);
    if (!response.ok) throw new Error(`Download failed for ${take.key}: ${response.status}`);
    fs.writeFileSync(original, Buffer.from(await response.arrayBuffer()));
  }
  const target = path.join(destination, `${take.key}-loud.mp4`);
  // Native renders may use 10-bit HEVC, which can fail without a device decoder.
  // Keep speech in the same file while providing a widely supported video track.
  run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", original, "-map", "0:v:0", "-map", "0:a:0", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-tag:v", "avc1", "-threads", "2", "-af", "loudnorm=I=-12:TP=-1:LRA=5", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", target]);
  const info = JSON.parse(run(ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,pix_fmt,width,height,sample_rate", "-of", "json", target]));
  const video = info.streams.find(stream => stream.codec_type === "video");
  if (video?.width !== 1920 || video?.height !== 1080 || video.codec_name !== "h264" || video.pix_fmt !== "yuv420p" || !info.streams.some(stream => stream.codec_type === "audio" && stream.codec_name === "aac")) throw new Error(`Unexpected media streams for ${take.key}`);
  const duration = Number(info.format.duration);
  run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", target, "-vn", "-c:a", "libmp3lame", "-q:a", "2", "-ar", "48000", "-ac", "1", path.join(voiceDestination, `${take.key}.mp3`)]);
  if (duration > (take.key.endsWith("wins") || take.key === "tie" ? 6 : 14)) throw new Error(`Take too long: ${take.key}`);
  clips[take.key] = { file: `${take.key}-loud.mp4`, duration, transcript: take.transcript };
  records.push({ ...take, duration, width: video.width, height: video.height, sha256: crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex") });
  console.log(`${take.key}: 1080p H.264 video + 48kHz AAC speech, ${duration}s`);
}
if (Object.keys(clips).length !== 9) throw new Error("All nine commentary takes must be present before publishing the manifest");
fs.writeFileSync(path.join(destination, "manifest.json"), JSON.stringify({ version: 2, language: "hi-IN", clips }, null, 2) + "\n");
fs.writeFileSync(path.join(destination, "provenance.json"), JSON.stringify({ generatedOn: "2026-10-05", provider: "Higgsfield", model: production.model, reference: production.reference, voiceReference: production.voiceReference, usage: "AI-generated Hindi studio commentary. Only the server's revealed Dragon card and confirmed winner select speech. Video/audio retain lip synchronization; video is encoded as 8-bit H.264 at original 1080p resolution, AAC speech normalized to -12 LUFS.", takes: records }, null, 2) + "\n");
