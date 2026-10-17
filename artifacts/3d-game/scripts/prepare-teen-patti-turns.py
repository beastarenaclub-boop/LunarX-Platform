"""Re-edit the photographed six-card take into alternating, quicker turns.

Run with an input master (six seconds of eye-only waiting + nine seconds of
opening), an output directory, the original ungraded opening, and FFmpeg on
PATH. All motion is sampled
forwards from the existing take. No mirrored hands or reversed card flips.
The per-arm time maps also drive the game's paper tracking and sound cues.
"""
import json
import os
import runpy
import sys
import subprocess
from pathlib import Path
import cv2
import numpy as np

cv2.setNumThreads(2)
source = Path(sys.argv[1])
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)

# [edited seconds, original opening seconds]. Holds let one hand wait while
# the other finishes its turn. Approach/retraction can overlap; turns cannot.
LEFT = [[0, 0], [.375, .375], [.85, 1.65], [1.95, 3.60],
        [2.45, 4.50], [3.02, 4.50], [3.90, 6.0],
        [4.72, 6.0], [5.88, 7.50], [6.45, 7.90], [8.5, 8.5], [9, 9]]
RIGHT = [[0, 0], [.375, .375], [.85, 1.65], [1.98, 1.65],
         [3.08, 3.65], [3.50, 4.50], [3.94, 4.50], [4.82, 6.0],
         [5.91, 6.0], [7.07, 7.55], [7.65, 8.10], [8.5, 8.5], [9, 9]]

cap = cv2.VideoCapture(str(source))
frames = []
while True:
    ok, frame = cap.read()
    if not ok:
        break
    assert frame.shape[:2] == (496, 864)
    frames.append(frame)
cap.release()
assert len(frames) >= 348
opening = frames[144:]

# The old rectangular vest grade accidentally desaturated wrists when they
# crossed its bounds. Recover warm skin from the same ungraded source frame,
# preserving the accepted charcoal vest, navy felt and clean card surfaces.
ungraded = cv2.VideoCapture(sys.argv[3])
skin_region = np.zeros((496, 864), np.float32)
skin_region[270:354, 220:420] = 1
skin_region[270:354, 445:660] = 1
skin_region = cv2.GaussianBlur(skin_region, (9, 9), 2)
for i, graded in enumerate(opening):
    ok, original = ungraded.read()
    assert ok and original.shape == graded.shape
    hsv = cv2.cvtColor(original, cv2.COLOR_BGR2HSV)
    b, g, r = cv2.split(original.astype(np.float32))
    skin = ((hsv[:,:,0] < 35) & (hsv[:,:,1] > 20) & (hsv[:,:,2] > 55)
            & (r > g+8) & (g > b)).astype(np.float32) * skin_region
    skin = cv2.GaussianBlur(skin, (5, 5), .8)[:,:,None]
    opening[i] = np.clip(original*skin + graded*(1-skin), 0, 255).astype(np.uint8)
ungraded.release()
# Release the superseded graded action frames before caching optical flow.
frames = frames[:144]

# Correct the source's duplicate middle papers and sideways landing before
# sampling the two arms. Fingers, paper and sleeve follow the same warp.
repair_middle = runpy.run_path(str(Path(__file__).with_name('repair-teen-patti-middle.py')))['repair_middle_frames']
opening = repair_middle(opening)

def at(t, track):
    return float(np.interp(t, *np.array(track).T))

# Interpolation is confined to the head/body. Optical flow cannot reliably
# separate fingers, cuffs and turning paper: blending those predictions left
# translucent fingers and smeared highlights in the shipped hands.
flow_engine = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
flow_cache = {}
grid_y, grid_x = np.mgrid[:496, :864].astype(np.float32)

def sample(t):
    pos = np.clip(t * 24, 0, len(opening)-1)
    i = int(pos)
    a = float(pos-i)
    if a < .001 or i >= len(opening)-1:
        return opening[i]
    if i not in flow_cache:
        gray0 = cv2.cvtColor(opening[i], cv2.COLOR_BGR2GRAY)
        gray1 = cv2.cvtColor(opening[i+1], cv2.COLOR_BGR2GRAY)
        forward = flow_engine.calc(gray0, gray1, None)
        backward = flow_engine.calc(gray1, gray0, None)
        flow_cache[i] = (forward, backward)
        if len(flow_cache) > 24:
            del flow_cache[next(iter(flow_cache))]
    forward, backward = flow_cache[i]
    f0 = cv2.remap(opening[i], grid_x-a*forward[:,:,0],
                   grid_y-a*forward[:,:,1], cv2.INTER_LINEAR,
                   borderMode=cv2.BORDER_REPLICATE)
    f1 = cv2.remap(opening[i+1], grid_x-(1-a)*backward[:,:,0],
                   grid_y-(1-a)*backward[:,:,1], cv2.INTER_LINEAR,
                   borderMode=cv2.BORDER_REPLICATE)
    return cv2.addWeighted(f0, 1-a, f1, a, 0)

def sample_hand(t):
    # One complete photographed exposure, never a blend of adjacent grips.
    # Round down so the paper cannot land before the measured source cue.
    index = int(np.clip(np.floor(t * 24 + 1e-6), 0, len(opening)-1))
    return opening[index]

# Only the arm/table regions have independent time. The head/face stays one
# complete source image. Seams are in the dark central vest and empty felt.
x = np.arange(864, dtype=np.float32)[None,:,None]
y = np.arange(496, dtype=np.float32)[:,None,None]
left_weight = np.clip((450-x)/36, 0, 1)
arm_weight = np.clip((y-190)/40, 0, 1)

encoder = subprocess.Popen([os.environ.get('FFMPEG', 'ffmpeg'), '-v', 'error', '-y', '-f', 'rawvideo',
    '-pix_fmt', 'bgr24', '-s', '864x496', '-r', '24', '-i', 'pipe:0', '-an',
    '-c:v', 'libx264', '-crf', os.environ.get('TP_AUTHOR_CRF', '17'), '-preset', 'fast', '-g', '24',
    '-keyint_min', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    str(out / 'maya-alternating-turns.mp4')], stdin=subprocess.PIPE)
for frame in frames[:144]:
    encoder.stdin.write(frame.tobytes())
review = []
for i in range(217):
    t = i/24
    lt, rt = at(t, LEFT), at(t, RIGHT)
    left, right = sample_hand(lt), sample_hand(rt)
    body = sample((lt+rt)/2)
    arms = left*left_weight + right*(1-left_weight)
    result = np.clip(body*(1-arm_weight)+arms*arm_weight, 0, 255).astype(np.uint8)
    encoder.stdin.write(result.tobytes())
    if i in [24, 32, 40, 48, 54, 62, 70, 78, 84, 92, 102, 112, 126, 136, 150, 164]:
        crop = result[230:422, 190:674].copy()
        cv2.putText(crop, f'{t:.2f}s', (8, 19), cv2.FONT_HERSHEY_SIMPLEX,
                    .55, (255,255,255), 1)
        review.append(crop)
    if i == 204:
        cv2.imwrite(str(out/'maya-alternating-result.jpg'), result,
                    [cv2.IMWRITE_JPEG_QUALITY, 96])
encoder.stdin.close()
assert encoder.wait() == 0
cv2.imwrite(str(out/'turns-review.jpg'), np.vstack([
    np.hstack(review[i:i+4]) for i in range(0, len(review), 4)]))
(out/'turn-time-maps.json').write_text(json.dumps({'left':LEFT,'right':RIGHT}))
print(json.dumps({'frames':361,'waitingFrames':144,'left':LEFT,'right':RIGHT}), flush=True)
