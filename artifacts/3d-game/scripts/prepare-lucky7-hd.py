"""Native 720p studio: immediate natural-speed shake, no blended video frames."""
import cv2
import numpy as np

def frames(path):
    cap = cv2.VideoCapture(path)
    result = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        result.append(frame if frame.shape[:2] == (720, 1280) else cv2.resize(frame, (1280, 720), interpolation=cv2.INTER_LANCZOS4))
    cap.release()
    return result

cup = frames('/tmp/cup.mp4')
idle = frames('/tmp/idle.mp4')[:144]
plate = cup[0].astype(np.float32)
patch = np.zeros((720, 1280), np.float32)
cv2.rectangle(patch, (460, 536), (820, 655), 1, -1)
patch = cv2.GaussianBlur(patch, (33, 33), 0)
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
    neutral[:, 595:685] = 0
    skin = np.maximum(skin, neutral)
    skin = cv2.dilate(skin, np.ones((7, 7), np.uint8)).astype(np.float32)
    skin = cv2.GaussianBlur(skin, (7, 7), 0)
    # At the first release frame a cube edge can still touch a fingertip.
    # Explicitly remove the neutral bright props in the measured handoff box.
    roi = frame[547:652, 595:685].astype(np.float32)
    lo, hi = roi.min(axis=2), roi.max(axis=2)
    props = ((hi > 112) & (lo > .7 * hi)).astype(np.uint8) * 255
    contours, _ = cv2.findContours(props, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for contour in contours:
        if cv2.contourArea(contour) > 8:
            cv2.drawContours(props, [cv2.convexHull(contour)], -1, 255, -1)
    props = cv2.dilate(props, np.ones((7, 7), np.uint8))
    skin[547:652, 595:685][props > 0] = 0
    alpha = (patch * (1 - skin))[:, :, None]
    cup[i] = np.clip(frame * (1 - alpha) + plate * alpha, 0, 255).astype(np.uint8)


# Match the stationary architecture to one studio view before joining poses.
# Background features exclude the dealer and her moving hands.
reference = idle[0]
feature_mask = np.full((720, 1280), 255, np.uint8)
feature_mask[:, 373:887] = 0
feature_mask[527:, :] = 0
sift = cv2.SIFT_create(nfeatures=1200)
ref_keys, ref_desc = sift.detectAndCompute(cv2.cvtColor(reference, cv2.COLOR_BGR2GRAY), feature_mask)
matcher = cv2.BFMatcher()
matrices, matches_used = [], []
for i, frame in enumerate(cup[:144]):
    keys, desc = sift.detectAndCompute(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), feature_mask)
    matches = [a for a, b in matcher.knnMatch(desc, ref_desc, k=2) if a.distance < .7 * b.distance]
    matrix = None
    if len(matches) >= 12:
        src = np.float32([keys[m.queryIdx].pt for m in matches])
        dst = np.float32([ref_keys[m.trainIdx].pt for m in matches])
        matrix, inliers = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=3.3)
    if matrix is None or not .9 < np.linalg.norm(matrix[0, :2]) < 1.1 or np.max(np.abs(matrix[:, 2])) > 94:
        matrix = matrices[-1] if matrices else np.array([[1., 0, 0], [0, 1., 0]])
    matrices.append(matrix)
    matches_used.append(len(matches))
# Smooth only the measured camera correction, never the dealer's motion.
matrices = np.array(matrices)
smoothed = np.empty_like(matrices)
for i in range(len(matrices)):
    smoothed[i] = np.median(matrices[max(0, i - 2):min(len(matrices), i + 3)], axis=0)
throw = [cv2.warpAffine(frame, matrix, (1280, 720), flags=cv2.INTER_LANCZOS4,
                       borderMode=cv2.BORDER_REFLECT_101) for frame, matrix in zip(cup, smoothed)]

# The first action frame is the closed-cup shake at source 2.000 seconds.
# No pickup, greeting, clap, or cross-dissolve frames are included.
throw = throw[48:144]
throw.extend(idle[:12])
import subprocess, json
encoder = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo',
    '-pix_fmt', 'bgr24', '-s', '1280x720', '-r', '24', '-i', 'pipe:0',
    '-an', '-vf', 'unsharp=5:5:0.3:3:3:0', '-c:v', 'libx264', '-crf', '18',
    '-preset', 'fast', '-g', '24', '-keyint_min', '24', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', '/tmp/studio-hd.mp4'], stdin=subprocess.PIPE)
for frame in idle + throw:
    encoder.stdin.write(frame.tobytes())
encoder.stdin.close()
assert encoder.wait() == 0, 'Encoder failed'
cv2.imwrite('/tmp/studio-hd-poster.jpg', idle[0], [cv2.IMWRITE_JPEG_QUALITY, 96])
release = smoothed[111] @ np.array([.504 * 1280, .796 * 720, 1])
print(json.dumps({'frames':len(idle + throw), 'duration':10.5, 'width':1280, 'height':720,
    'rollStartMs':6000,'rollEndMs':10500,'releaseMs':8625,
    'release':{'x':float(release[0]/1280),'y':float(release[1]/720)},
    'dieWidth':float(.023 * np.linalg.norm(smoothed[111][0, :2])),
    'medianMatches':float(np.median(matches_used))}))
