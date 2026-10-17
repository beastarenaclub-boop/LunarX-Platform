"""Create a six-second eye-only waiting segment and append the opening take.

Inputs in argv[1]: idle.mp4 (the old betting source), opening.mp4.
Outputs: eyes-table.mp4, eyes-poster.jpg, eyes-review.jpg.
Only photographed eyelids and gaze move. Head, mouth, body, hands and room
come from one fixed frame. Opening geometry and its timing are unchanged.
"""
import cv2
import os
import json
import numpy as np
import subprocess
import sys
from pathlib import Path

cv2.setNumThreads(2)
root = Path(sys.argv[1])

def read(name):
    cap = cv2.VideoCapture(str(root / name))
    frames = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        assert frame.shape[:2] == (496, 864)
        frames.append(frame)
    cap.release()
    return frames

source = read('idle.mp4')[:62]
opening = read('opening.mp4')
base = source[28].copy()
x, y, width, height = 390, 40, 100, 110
reference = cv2.cvtColor(base[y:y+height, x:x+width], cv2.COLOR_BGR2GRAY)
# Register the rigid part of the face, excluding moving eyes and mouth.
registration = np.zeros((height, width), np.uint8)
registration[17:91, 9:92] = 255
registration[43:65] = 0
registration[81:] = 0
alpha = np.zeros((height, width), np.float32)
cv2.ellipse(alpha, (35, 54), (13, 7), 0, 0, 360, 1, -1)
cv2.ellipse(alpha, (69, 54), (13, 7), 0, 0, 360, 1, -1)
alpha = cv2.GaussianBlur(alpha, (5, 5), .8)[:, :, None]
aligned = []
for frame in source:
    crop = frame[y:y+height, x:x+width]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    transform = np.eye(2, 3, dtype=np.float32)
    try:
        _, transform = cv2.findTransformECC(reference, gray, transform,
            cv2.MOTION_EUCLIDEAN,
            (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 100, 1e-5),
            registration, 5)
    except cv2.error:
        pass
    assert np.max(np.abs(transform[:, 2])) < 16, transform
    registered = cv2.warpAffine(crop, transform, (width, height),
        flags=cv2.INTER_CUBIC | cv2.WARP_INVERSE_MAP,
        borderMode=cv2.BORDER_REFLECT_101)
    result = base.copy()
    result[y:y+height, x:x+width] = np.clip(
        registered * alpha + base[y:y+height, x:x+width] * (1-alpha),
        0, 255).astype(np.uint8)
    aligned.append(result)

# Begin/end on the same open-eyed pose. Reorder one forward performance at
# its matching seam, with a quiet pause; never run gestures backwards.
waiting = [base] * 30 + aligned[28:] + aligned[:28] + [base] * 52
assert len(waiting) == 144
outside = np.ones((496, 864), bool)
outside[85:104, 409:442] = False
outside[85:104, 443:476] = False
assert max(int(np.abs(f.astype(np.int16) - base).max(axis=2)[outside].max()) for f in waiting) == 0
encoder = subprocess.Popen([os.environ.get('FFMPEG', 'ffmpeg'), '-v', 'error', '-y', '-f', 'rawvideo',
    '-pix_fmt', 'bgr24', '-s', '864x496', '-r', '24', '-i', 'pipe:0', '-an',
    '-c:v', 'libx264', '-crf', os.environ.get('TP_AUTHOR_CRF', '17'), '-preset', 'fast', '-g', '24',
    '-keyint_min', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    str(root / 'eyes-table.mp4')], stdin=subprocess.PIPE)
for frame in waiting + opening:
    encoder.stdin.write(frame.tobytes())
encoder.stdin.close()
assert encoder.wait() == 0
cv2.imwrite(str(root / 'eyes-poster.jpg'), base, [cv2.IMWRITE_JPEG_QUALITY, 96])
review = []
for i in [0, 30, 40, 50, 60, 65, 70, 75, 80, 85, 91, 110]:
    crop = cv2.resize(waiting[i][45:150, 390:490], (300, 315), interpolation=cv2.INTER_CUBIC)
    cv2.putText(crop, f'{i / 24:.2f}s', (8, 25), cv2.FONT_HERSHEY_SIMPLEX, .6, (255,255,255), 1)
    review.append(crop)
cv2.imwrite(str(root / 'eyes-review.jpg'), np.vstack([np.hstack(review[i:i+4]) for i in range(0, 12, 4)]))
eyes = np.stack([f[86:103, 409:476].astype(np.float32) for f in waiting])
print(json.dumps({'waitingFrames':len(waiting), 'openingFrames':len(opening),
    'sceneOffset':6, 'fixedBodyPixelDifference':0,
    'eyeTemporalVariance':float(eyes.var(axis=0).mean())}), flush=True)
