// Produce mobile delivery variants without changing the source films or timing.
// FFMPEG_PATH must point to an installed ffmpeg with the libx264 encoder.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const root = 'artifacts/3d-game';
const out = `${root}/public/media/performance`;
fs.mkdirSync(out, { recursive: true });
const sources = {
  teenPatti: ['src/assets/teenpatti/riya-hd-studio.mp4', '1280:720'],
  luckyIdle: ['src/assets/lucky7/cast/naina-bar-natural-idle-2k.mp4', '1280:720', '18'],
  luckyAction: ['src/assets/lucky7/cast/naina-bar-natural-action-2k.mp4', '1280:720', '18'],
  wheelWelcome: ['public/media/wheel20-live/studio-welcome-v3.mp4', '1280:900'],
  wheelLastCall: ['public/media/wheel20-live/studio-last-call-v3.mp4', '1280:900'],
  wheelSpin: ['public/media/wheel20-live/studio-spin-v3.mp4', '1280:900'],
  wheelResult: ['public/media/wheel20-live/studio-result-v3.mp4', '1280:900'],
  wheelIdle: ['public/media/wheel20-live/studio-loop-v1.mp4', '1280:900'],
};
const manifest = {};
for (const [key, [source, scale, quality = '24']] of Object.entries(sources)) {
  const input = `${root}/${source}`;
  const temporary = `${out}/${key}.tmp.mp4`;
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    '-vf', `scale=${scale}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', quality,
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', temporary]);
  const data = fs.readFileSync(temporary);
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 12);
  const name = `${key}.${hash}.mp4`;
  fs.renameSync(temporary, path.join(out, name));
  manifest[key] = { src: name, bytes: data.length, sourceBytes: fs.statSync(input).size };
  console.log(`${key}: ${manifest[key].sourceBytes} -> ${data.length} bytes`);
}
fs.writeFileSync(process.env.GAME_MEDIA_MANIFEST || `${root}/src/lib/mobile-game-media.json`, JSON.stringify(manifest, null, 2) + '\n');
