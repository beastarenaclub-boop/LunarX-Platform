"""Restore the original moving dealer, burgundy vest and green table.

Run from the repository root with OpenCV, NumPy and FFmpeg (or imageio-ffmpeg).
Source motion, six card planes and deadlines are unchanged. All color and
detail processing is offline; production plays one ordinary local MP4.
"""
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import cv2
import numpy as np

cv2.setNumThreads(2)
HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent / 'src/assets/teenpatti'
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else '.cache/tp-natural-studio')
OUT.mkdir(parents=True, exist_ok=True)
FFMPEG = os.environ.get('FFMPEG') or shutil.which('ffmpeg')
if not FFMPEG:
    import imageio_ffmpeg
    FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
os.environ['FFMPEG'] = FFMPEG
# Lossless authoring intermediates avoid another lossy grade/face-composite
# chain. Only the final distributed file is compressed with CRF 16.
os.environ['TP_AUTHOR_CRF'] = '0'

def encode(path, crf='0'):
    return subprocess.Popen([FFMPEG, '-v', 'error', '-y', '-f', 'rawvideo',
        '-pix_fmt', 'bgr24', '-s', '864x496', '-r', '24', '-i', 'pipe:0',
        '-an', '-c:v', 'libx264', '-crf', crf, '-preset', 'fast', '-g', '24',
        '-keyint_min', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        str(path)], stdin=subprocess.PIPE)

def finish(encoder):
    encoder.stdin.close()
    assert encoder.wait() == 0

def read(path):
    cap = cv2.VideoCapture(str(path))
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        yield frame
    cap.release()

# The original waiting source is 1280x720. The canonical card/eye world
# remains 864x496, as in the existing game, including the camera geometry.
encoder = encode(OUT / 'idle.mp4')
for i, frame in enumerate(read(ASSETS / 'maya-cards.mp4')):
    if i < 174:
        continue
    if i >= 236:
        break
    frame = cv2.resize(frame, (864, 496), interpolation=cv2.INTER_AREA)
    # Remove the old take's prop cards with actual adjacent felt texture.
    # Only these fixed felt patches change; hands, sleeves and rail stay put.
    for x0, x1 in [(218, 405), (502, 632)]:
        y0, y1 = 359, 404
        clean = frame[y0+62:y1+62, x0:x1].astype(np.float32)
        target = frame[y0:y1, x0:x1].astype(np.float32)
        # Match nearby untouched felt lighting rather than leaving a flat box.
        delta = np.median(target[:5], axis=(0,1)) - np.median(clean[:5], axis=(0,1))
        clean = np.clip(clean + delta, 0, 255)
        yy, xx = np.mgrid[:y1-y0, :x1-x0].astype(np.float32)
        weight = np.minimum.reduce([xx/5, (x1-x0-1-xx)/5, yy/5, (y1-y0-1-yy)/5])
        weight = np.clip(weight, 0, 1)[:, :, None]
        frame[y0:y1,x0:x1] = np.clip(clean*weight+target*(1-weight), 0,255).astype(np.uint8)
    encoder.stdin.write(frame.tobytes())
finish(encoder)
shutil.copyfile(ASSETS / 'maya-six-cards.mp4', OUT / 'opening.mp4')
print('Original wardrobe, felt and waiting pose prepared', flush=True)
sys.argv = [str(HERE/'prepare-teen-patti-eyes.py'), str(OUT)]
runpy.run_path(sys.argv[0], run_name='__main__')
sys.argv = [str(HERE/'prepare-teen-patti-turns.py'), str(OUT/'eyes-table.mp4'), str(OUT), str(OUT/'opening.mp4')]
runpy.run_path(sys.argv[0], run_name='__main__')

# A fixed, restrained display grade: raise midtones, keep true black and
# highlights, restore color separation and protect skin from oversaturation.
# Spatial detail is bounded by existing local extrema: no bright edge halos,
# invented texture or temporal blending of fingers.
curve_x = np.array([0, 24, 64, 128, 192, 232, 255], np.float32)
curve_y = np.array([0, 25, 73, 145, 208, 241, 255], np.float32)
lut = np.interp(np.arange(256), curve_x, curve_y).astype(np.uint8)
def grade(frame):
    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
    lum = cv2.LUT(lab[:,:,0], lut).astype(np.float32)
    detail = np.clip(lum-cv2.GaussianBlur(lum,(0,0),.85), -7, 7)*.6
    lo = cv2.erode(lum, np.ones((3,3),np.uint8))
    hi = cv2.dilate(lum, np.ones((3,3),np.uint8))
    lab[:,:,0] = np.clip(lum+detail, lo, hi).astype(np.uint8)
    result = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
    hsv = cv2.cvtColor(result, cv2.COLOR_BGR2HSV)
    saturation = hsv[:,:,1].astype(np.float32)
    # Only garment/felt colors get the modest extra saturation; skin stays natural.
    colored = (hsv[:,:,0] > 35) & (saturation > 45)
    hsv[:,:,1] = np.clip(saturation*np.where(colored,1.08,1.0),0,255).astype(np.uint8)
    return cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)

encoder = encode(OUT/'maya-natural-studio.mp4', '16')
count = 0
for i, frame in enumerate(read(OUT/'maya-alternating-turns.mp4')):
    result = grade(frame)
    encoder.stdin.write(result.tobytes())
    if i in [0,144,348]:
        name = {0:'betting',144:'opening',348:'result'}[i]
        cv2.imwrite(str(OUT/f'maya-natural-{name}.jpg'), result, [cv2.IMWRITE_JPEG_QUALITY,97])
    count += 1
finish(encoder)
assert count == 361, count
print(json.dumps({'frames':count,'width':864,'height':496,'fps':24,'dealer':'Maya','faceComposite':False,'wardrobe':'original burgundy','felt':'original green'}), flush=True)
