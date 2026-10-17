"""Build one 24 fps master; input files are downloaded by the media pipeline.

Keep source frame 111 as the handoff. Restore empty felt under the released
props, including their baked shadows, while protecting the real fingers.
"""
import cv2
import numpy as np

def frames(path):
    cap = cv2.VideoCapture(path)
    result = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        result.append(cv2.resize(frame, (960, 540), interpolation=cv2.INTER_AREA))
    cap.release()
    return result

cup = frames('/tmp/cup.mp4')
master = frames('/tmp/master.mp4')[:342]
idle = frames('/tmp/idle.mp4')[:144]
plate = cup[0].astype(np.float32)
patch = np.zeros((540, 960), np.float32)
cv2.rectangle(patch, (345, 402), (615, 491), 1, -1)
patch = cv2.GaussianBlur(patch, (25, 25), 0)
for i in range(111, len(cup)):
    frame = cup[i]
    b, g, r = cv2.split(frame.astype(np.float32))
    # Warm skin remains untouched. Sleeves are above this felt-only patch.
    skin = ((r > b * 1.18) & (r > g * 1.055) & (r > 55)).astype(np.uint8)
    # Ivory props have warm edges too. Only retain large connected skin
    # regions; isolated pip/cube edges must not survive as floating specks.
    count, labels, stats, _ = cv2.connectedComponentsWithStats(skin)
    keep = np.zeros(count, np.uint8)
    keep[1:] = (stats[1:, cv2.CC_STAT_AREA] > 650).astype(np.uint8)
    skin = keep[labels]
    # Retain the white cuffs at the sides of the felt, too.
    neutral = ((frame.min(axis=2) > frame.max(axis=2) * .7)
               & (frame.max(axis=2) > 112)).astype(np.uint8)
    neutral[:, 446:514] = 0
    skin = np.maximum(skin, neutral)
    skin = cv2.dilate(skin, np.ones((5, 5), np.uint8)).astype(np.float32)
    skin = cv2.GaussianBlur(skin, (5, 5), 0)
    # At the first release frame a cube edge can still touch a fingertip.
    # Explicitly remove the neutral bright props in the measured handoff box.
    roi = frame[410:489, 446:514].astype(np.float32)
    lo, hi = roi.min(axis=2), roi.max(axis=2)
    props = ((hi > 112) & (lo > .7 * hi)).astype(np.uint8) * 255
    contours, _ = cv2.findContours(props, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for contour in contours:
        if cv2.contourArea(contour) > 8:
            cv2.drawContours(props, [cv2.convexHull(contour)], -1, 255, -1)
    props = cv2.dilate(props, np.ones((7, 7), np.uint8))
    skin[410:489, 446:514][props > 0] = 0
    alpha = (patch * (1 - skin))[:, :, None]
    cup[i] = np.clip(frame * (1 - alpha) + plate * alpha, 0, 255).astype(np.uint8)

master[84:228] = cup[:144]
# Blend the matching seated tail into waiting footage without a hard cut
# inside the throw. No blending touches the closed cup or release frame.
for j in range(6):
    weight = (j + 1) / 7
    master[222 + j] = cv2.addWeighted(master[222 + j], 1 - weight, idle[0], weight, 0)
# Forward-only waiting loop, with a short seam blend at its end.
for j in range(6):
    weight = (j + 1) / 7
    idle[-6 + j] = cv2.addWeighted(idle[-6 + j], 1 - weight, idle[0], weight, 0)
master.extend(idle)
out = cv2.VideoWriter('/tmp/continuous.avi', cv2.VideoWriter_fourcc(*'MJPG'), 24, (960, 540))
for frame in master:
    out.write(frame)
out.release()
print('master_frames', len(master), 'duration', len(master) / 24, 'release_ms', 8125)
