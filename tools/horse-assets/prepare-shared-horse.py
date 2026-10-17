"""Key the user's Higgsfield clip and build a deterministic racing atlas.

Requires NumPy and ffmpeg; no network or image generation. Run from repo root.
The original share is a side-profile video, not a rigged 3D model.
"""
import json, math, os, subprocess
from pathlib import Path
import numpy as np

ROOT = Path.cwd()
CACHE = ROOT / '.cache/horse-user-model'
OUT = ROOT / 'artifacts/3d-game/public/assets/horse-racing/realistic/shared-horse'
FFMPEG = ROOT / '.cache/teen-patti-media/package/ffmpeg.exe'
WIDTH, HEIGHT, FPS = 512, 384, 24
OUT.mkdir(parents=True, exist_ok=True)

def decode(path):
    raw = subprocess.check_output([str(FFMPEG), '-v', 'error', '-i', str(path),
        '-vf', f'scale={WIDTH}:{HEIGHT}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    return np.frombuffer(raw, np.uint8).reshape(-1, HEIGHT, WIDTH, 3)

def key(rgb):
    c = rgb.astype(np.float32) / 255
    red, green, blue = c[..., 0], c[..., 1], c[..., 2]
    excess = green - np.maximum(red, blue)
    t = np.clip((excess - .055) / .24, 0, 1)
    alpha = 1 - t*t*(3-2*t)
    # Neutralize green spill on hair and antialiased edges, preserving skin.
    c[..., 1] = np.minimum(green, np.maximum(red, blue) * 1.06 + .014)
    rgba = np.concatenate((c, alpha[..., None]), axis=-1)
    rgba[alpha < .005] = 0
    return np.clip(rgba*255, 0, 255).astype(np.uint8)

def encode(pixels, target):
    h, w = pixels.shape[:2]
    subprocess.run([str(FFMPEG), '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba',
        '-s', f'{w}x{h}', '-i', '-', '-frames:v', '1', '-c:v', 'libwebp',
        '-quality', '92', '-compression_level', '6', '-y', str(target)],
        input=pixels.tobytes(), check=True)

frames = key(decode(CACHE / 'source.mp4'))
# Find a complete stride with similar silhouette and velocity at the wrap.
# Avoid the opening camera adjustment and the late mane change.
small = frames[:, ::4, ::4, 3].astype(np.float32) / 255
weights = np.ones_like(small[0]); weights[45:] = 2.5
candidates = []
for first in range(12, min(100, len(frames)-38)):
    for count in range(18, 37):
        end = first + count
        delta = (small[first+1]-small[first])-(small[end+1]-small[end])
        score = np.mean((small[first]-small[end])**2*weights) + .3*np.mean(delta**2*weights)
        candidates.append((float(score), first, count))
score, first, count = min(candidates)
chosen = frames[first:first+count]
columns, rows = 8, math.ceil(count/8)
atlas = np.zeros((HEIGHT*rows, WIDTH*columns, 4), np.uint8)
noses, grounds = [], []
for i, frame in enumerate(chosen):
    atlas[(i//columns)*HEIGHT:(i//columns+1)*HEIGHT,
          (i%columns)*WIDTH:(i%columns+1)*WIDTH] = frame
    # Muzzle anchor excludes ears, loose mane and reins outside the face.
    ys, xs = np.where(frame[int(HEIGHT*.20):int(HEIGHT*.60), :, 3] > 220)
    noses.append(round(float(xs.max())/WIDTH, 6))
    ys, xs = np.where(frame[:, int(WIDTH*.2):int(WIDTH*.88), 3] > 220)
    grounds.append(float(ys.max())/HEIGHT)
idle = key(decode(CACHE / 'source-idle.png'))[0]
ys, xs = np.where(idle[int(HEIGHT*.2):int(HEIGHT*.6), :, 3] > 220)
idle_nose = float(xs.max())/WIDTH
ys, xs = np.where(idle[:, int(WIDTH*.2):int(WIDTH*.88), 3] > 220)
idle_ground = float(ys.max())/HEIGHT
encode(atlas, OUT / 'gallop-v1.webp')
encode(idle, OUT / 'idle-v1.webp')
# Keep uniform size/ground across the stride to preserve the source's lift.
manifest = dict(version='shared-horse-v1', width=WIDTH, height=HEIGHT,
    columns=columns, rows=rows, count=count, fps=FPS, sourceStartFrame=first,
    noseAnchors=noses, ground=max(grounds), idleNose=idle_nose, idleGround=idle_ground,
    sourceJob='9e64ca42-9b57-4df6-a2ff-a84dcab7438c',
    sourceShare='https://higgsfield.ai/s/aU-or7QgYp8',
    sourceType='Higgsfield Seedance video, 1664x1248, 24fps, 6.04 seconds',
    presentation='Side-profile keyed animation; not a 3D mesh or rig',
    loopScore=score)
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf8')
(CACHE / 'loop-candidates.json').write_text(json.dumps(sorted(candidates)[:12]), encoding='utf8')
print(json.dumps(manifest), flush=True)
