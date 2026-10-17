"""Prepare the generated 1080p dealer take for server-controlled dice playback.

Usage: python prepare-lucky7-glamour.py source.mp4 output.mp4 poster.jpg
Requires OpenCV, NumPy and ffmpeg. Keeps the generated face/outfit and timing,
locks the empty felt, and removes filmed dice once the game takes over.
"""
import json
import subprocess
import sys

import cv2
import numpy as np

cv2.setNumThreads(2)
source, destination, poster = sys.argv[1:]
capture = cv2.VideoCapture(source)
ok, plate = capture.read()
assert ok and plate.shape[:2] == (1080, 1920)
assert capture.get(cv2.CAP_PROP_FPS) == 24
capture.set(cv2.CAP_PROP_POS_FRAMES, 0)

# The first frame contains fingertips below the rail. Use the photographed
# cloth just in front of them to make this small part of the empty plate.
plate[768:846, 690:1260] = plate[846:924, 690:1260]
plane = np.zeros((1080, 1920), np.float32)
plane[780:] = 1
plane[768:780] = np.linspace(0, 1, 12)[:, None]

def foreground(frame, released):
    roi = frame[735:1010, 500:1400]
    b, g, r = cv2.split(roi.astype(np.float32))
    maximum, minimum = roi.max(axis=2), roi.min(axis=2)
    skin_and_dress = (r > g * 1.04) & (r > b * 1.10) & (r > 65)
    props = (minimum > maximum * .84) & (maximum > 145)
    mask = (skin_and_dress | props).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    keep = np.zeros(count, np.uint8)
    keep[1:] = ((stats[1:, cv2.CC_STAT_AREA] > 200)
                & (stats[1:, cv2.CC_STAT_TOP] < 75)).astype(np.uint8)
    mask = keep[labels]
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(mask, contours, -1, 1, -1)
    mask = cv2.dilate(mask, np.ones((3, 3), np.uint8))
    if not released:
        # Both photographed dice stay visible through the handoff frame even
        # when one has just separated from the palm before the other.
        held_props = props.astype(np.uint8)
        held_props[:85] = 0
        held_props[:, :350] = 0
        held_props[:, 650:] = 0
        # Include shaded die faces and black pips between the bright edges.
        # A colour key alone makes those darker parts transparent.
        points = cv2.findNonZero(held_props)
        if points is not None and len(points) > 12:
            cv2.drawContours(held_props, [cv2.convexHull(points)], -1, 1, -1)
        mask |= cv2.dilate(held_props, np.ones((3, 3), np.uint8))
    if released:
        # Neutral detached props must never bake a predetermined result into
        # the video. Warm skin remains photographed during the handoff.
        neutral = props.astype(np.uint8)
        neutral[:85] = 0
        neutral[:, :350] = 0
        neutral[:, 650:] = 0
        contours, _ = cv2.findContours(neutral, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            if cv2.contourArea(contour) > 12:
                cv2.drawContours(neutral, [cv2.convexHull(contour)], -1, 1, -1)
        neutral = cv2.dilate(neutral, np.ones((7, 7), np.uint8))
        mask[neutral > 0] = 0
    matte = np.zeros((1080, 1920), np.float32)
    matte[735:1010, 500:1400] = cv2.GaussianBlur(mask.astype(np.float32), (3, 3), .6)
    return matte

encoder = subprocess.Popen([
    "ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24",
    "-s", "1920x1080", "-r", "24", "-i", "pipe:0", "-an", "-c:v", "libx264",
    "-crf", "18", "-preset", "fast", "-g", "24", "-keyint_min", "24",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", destination,
], stdin=subprocess.PIPE)
index = 0
last = None
while True:
    ok, frame = capture.read()
    if not ok:
        break
    alpha = (plane * (1 - foreground(frame, index >= 207)))[:, :, None]
    output = np.clip(frame * (1 - alpha) + plate * alpha, 0, 255).astype(np.uint8)
    assert np.array_equal(output[:768], frame[:768]), "Dealer must remain unchanged"
    if index == 0:
        cv2.imwrite(poster, output, [cv2.IMWRITE_JPEG_QUALITY, 96])
    encoder.stdin.write(output.tobytes())
    last = output
    index += 1
capture.release()
assert index == 249, f"Expected the reviewed generated take; got {index} frames"
# The model omitted the final three frames. Hold its seated tail for 125ms
# to retain the existing 10.5s game segment without retiming any movement.
for _ in range(252 - index):
    encoder.stdin.write(last.tobytes())
encoder.stdin.close()
assert encoder.wait() == 0
print(json.dumps({"width": 1920, "height": 1080, "fps": 24, "frames": 252,
                  "durationSeconds": 10.5, "releaseMs": 8625,
                  "sourceFrames": index, "paddedTailMs": 125}))
