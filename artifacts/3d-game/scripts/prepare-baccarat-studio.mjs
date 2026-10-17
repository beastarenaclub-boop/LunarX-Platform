import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { softHandMask } from './andar-bahar-matte.mjs';

// Reproducible extraction of the user's reference performance. The extra
// grayscale band travels in the same decoded frame as the dealer's hands.
const source = process.argv[2];
if (!source) throw Error('Supply the reference screen recording path');
const ffmpeg = process.env.FFMPEG ?? path.resolve('tmp/dt-ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe');
const out = path.resolve('artifacts/3d-game/public/media/baccarat');
mkdirSync(out, { recursive: true });
const W = 1200, H = 480, X = 390, Y = 350, MW = 410, MH = 130, FPS = 30;
const args = ['-hide_banner', '-loglevel', 'error'];
const plate = spawnSync(ffmpeg, [...args, '-y', '-ss', '29', '-i', source,
  '-vf', 'crop=1200:480:12:30,drawbox=x=0:y=0:w=1200:h=32:color=black:t=fill',
  '-frames:v', '1', path.join(out, 'clean-table.png')], { windowsHide: true, encoding: 'utf8' });
if (plate.status !== 0) throw Error(plate.stderr);
const decoder = spawn(ffmpeg, [...args, '-ss', '13', '-i', source, '-t', '25.6',
  '-vf', 'crop=1200:480:12:30,drawbox=x=0:y=0:w=1200:h=32:color=black:t=fill',
  '-an', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] });
const encoder = spawn(ffmpeg, [...args, '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
  '-s', `${W}x${H + MH}`, '-r', String(FPS), '-i', 'pipe:0', '-an', '-c:v', 'libx264',
  '-preset', 'fast', '-crf', '16', '-pix_fmt', 'yuv420p', '-g', '12', '-keyint_min', '12',
  '-sc_threshold', '0', '-movflags', '+faststart', path.join(out, 'dealer-studio.mp4')],
  { windowsHide: true, stdio: ['pipe', 'ignore', 'inherit'] });
const decoded = once(decoder, 'close'), encoded = once(encoder, 'close');
const frame = Buffer.alloc(W * H * 3), rgba = new Uint8ClampedArray(MW * MH * 4);
let fill = 0, frames = 0;
for await (const chunk of decoder.stdout) {
  let offset = 0;
  while (offset < chunk.length) {
    const length = Math.min(chunk.length - offset, frame.length - fill);
    chunk.copy(frame, fill, offset, offset + length); fill += length; offset += length;
    if (fill < frame.length) continue;
    fill = 0;
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const p = (y * MW + x) * 4, s = ((y + Y) * W + X + x) * 3;
      rgba[p] = frame[s]; rgba[p + 1] = frame[s + 1]; rgba[p + 2] = frame[s + 2]; rgba[p + 3] = 255;
    }
    const matte = softHandMask(rgba, MW, MH), packed = Buffer.alloc(W * (H + MH) * 3);
    frame.copy(packed);
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const p = (y * MW + x) * 4, r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
      // Preserve the actual blue backs during the approach; white faces are
      // always replaced with the server's card, never the recording's result.
      const back = b > r * 1.15 && b > g * 1.1 && b > 65;
      const skin = Math.max(0, Math.min(1, (r - g - 7) / 9, (g - b - 5) / 8,
        (r - 50) / 50, (b - 25) / 15, (100 - (r - g)) / 20, (80 - (g - b)) / 15));
      const a = back ? 255 : Math.max(matte[y * MW + x], Math.round(skin * 255)), d = ((H + y) * W + x) * 3;
      packed[d] = packed[d + 1] = packed[d + 2] = a;
    }
    if (!encoder.stdin.write(packed)) await once(encoder.stdin, 'drain');
    if (++frames % 180 === 0) console.log(`${frames / FPS}s prepared`);
  }
}
encoder.stdin.end();
const [dc] = await decoded, [ec] = await encoded;
if (dc || ec || frames !== 768) throw Error(`Incomplete media: ${dc}/${ec}, ${frames} frames`);
writeFileSync(path.join(out, 'provenance.json'), JSON.stringify({
  source: path.basename(source), sourceStartSeconds: 13, frames, fps: FPS,
  studio: [12, 30, W, H], packedSize: [W, H + MH], matteTarget: [X, Y, MW, MH],
  description: 'Original recorded performance, cropped at native resolution; UI removed at render time; silent, no generated or upscaled detail. Card faces are composited from the server outcome.'
}, null, 2));
