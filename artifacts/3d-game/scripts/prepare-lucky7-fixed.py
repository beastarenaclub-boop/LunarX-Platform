"""Restore source detail and lock the felt without freezing the dealer's hands.

Inputs: /tmp/idle.mp4 (native waiting take), /tmp/cup.mp4 (native throw).
Outputs: /tmp/fixed-studio.mp4, /tmp/fixed-poster.jpg, /tmp/fixed-review.jpg.
No temporal blends, face replacement, generated shadows, or timing changes.
"""
import cv2
import json
import numpy as np
import subprocess

cv2.setNumThreads(2)

def frames(path):
    cap = cv2.VideoCapture(path)
    result = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        assert frame.shape[:2] == (720, 1280), 'Native 720p input required'
        result.append(frame)
    cap.release()
    return result[:144]

idle, cup = frames('/tmp/idle.mp4'), frames('/tmp/cup.mp4')
reference = idle[0]
feature_mask = np.full((720, 1280), 255, np.uint8)
feature_mask[:, 373:887] = 0
feature_mask[480:, :] = 0
sift = cv2.SIFT_create(nfeatures=1200)
ref_keys, ref_desc = sift.detectAndCompute(cv2.cvtColor(reference, cv2.COLOR_BGR2GRAY), feature_mask)
matcher = cv2.BFMatcher()

def stabilize(source):
    matrices = []
    for frame in source:
        keys, desc = sift.detectAndCompute(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), feature_mask)
        matches = [a for a, b in matcher.knnMatch(desc, ref_desc, k=2) if a.distance < .7 * b.distance]
        matrix = None
        if len(matches) >= 12:
            matrix, _ = cv2.estimateAffinePartial2D(
                np.float32([keys[m.queryIdx].pt for m in matches]),
                np.float32([ref_keys[m.trainIdx].pt for m in matches]),
                method=cv2.RANSAC, ransacReprojThreshold=3.3)
        if matrix is None or not .9 < np.linalg.norm(matrix[0, :2]) < 1.1 or np.max(np.abs(matrix[:, 2])) > 94:
            matrix = matrices[-1] if matrices else np.array([[1., 0, 0], [0, 1., 0]])
        matrices.append(matrix)
    matrices = np.array(matrices)
    smooth = [np.median(matrices[max(0, i-2):i+3], axis=0) for i in range(len(matrices))]
    return [cv2.warpAffine(f, m, (1280, 720), flags=cv2.INTER_LANCZOS4,
                          borderMode=cv2.BORDER_REFLECT_101) for f, m in zip(source, smooth)], smooth

throw, transforms = stabilize(cup)
idle, _ = stabilize(idle)

# Frame 60 has raised hands and an unobstructed felt surface. Retouch its
# vertical generated reflection using adjacent photographed felt, once.
# Every output frame receives exactly this same surface, behind real fingers.
plate = throw[60].copy()
replacement = np.roll(plate, 140, axis=1)
stripe = np.zeros((720, 1280), np.float32)
stripe[507:, 605:697] = 1
stripe = cv2.GaussianBlur(stripe, (25, 25), 0)[:, :, None]
plate = np.clip(plate * (1-stripe) + replacement * stripe, 0, 255).astype(np.uint8)
plane = np.zeros((720, 1280), np.float32)
plane[518:] = 1
plane[510:518] = np.linspace(0, 1, 8)[:, None]

# Protect only photographed skin and cuffs over the table, not their dark
# generated shadows. Props stay in the closed hands up to the exact release.
def foreground(frame, released):
    b, g, r = cv2.split(frame.astype(np.float32))
    # Key out green felt instead of accepting only bright skin: the latter
    # clips shaded wrists and the grey folds at the bottoms of white cuffs.
    skin = ((r > g * .96) & (g > 70)).astype(np.uint8)
    neutral = ((frame.min(axis=2) > frame.max(axis=2) * .78)
               & (frame.max(axis=2) > 145)).astype(np.uint8)
    region = np.zeros_like(skin)
    region[480:668, 335:924] = 1
    # Neutral isolated dice at release must give way to server-driven 3D dice.
    mask = (skin | neutral) * region
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5,5), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    keep = np.zeros(count, np.uint8)
    # Real fingers remain connected to the wrists above the felt. Detached
    # dice edges and warm reflected streaks must not become foreground.
    keep[1:] = ((stats[1:, cv2.CC_STAT_AREA] > 320)
                & (stats[1:, cv2.CC_STAT_TOP] < 535)).astype(np.uint8)
    mask = keep[labels]
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3,3), np.uint8))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(mask, contours, -1, 1, -1)
    # The source reflection forms a thin vertical tail attached to the resting
    # fingers. Remove that narrow centre run while retaining the broad palms.
    for y in range(522, 570):
        edges = np.diff(np.r_[0, mask[y], 0].astype(np.int16))
        for left, right in zip(np.where(edges == 1)[0], np.where(edges == -1)[0]):
            if right > 630 and left < 655 and right-left < 24:
                mask[y, left:right] = 0
    mask = cv2.dilate(mask, np.ones((3,3), np.uint8))
    if released:
        props = ((frame.min(axis=2) > frame.max(axis=2) * .84)
                 & (frame.max(axis=2) > 145)).astype(np.uint8)
        props[:547] = 0
        props[655:] = 0
        props[:, :595] = 0
        props[:, 740:] = 0
        contours, _ = cv2.findContours(props, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            if cv2.contourArea(contour) > 8:
                cv2.drawContours(props, [cv2.convexHull(contour)], -1, 1, -1)
        props = cv2.dilate(props, np.ones((7,7), np.uint8))
        mask[props > 0] = 0
    return cv2.GaussianBlur(mask.astype(np.float32), (3,3), .6)

# Spatial deconvolution restores moderate source softness without mixing
# adjacent motion frames. Restrict it to the dealer, leaving the casino alone.
detail_mask = np.zeros((720,1280), np.float32)
cv2.ellipse(detail_mask, (644,285), (278,275), 0, 0, 360, 1, -1)
detail_mask = cv2.GaussianBlur(detail_mask, (41,41), 0)[20:565, 340:945, None]
def restore_detail(frame):
    result = frame.copy()
    source = frame[20:565,340:945].astype(np.float32) / 255
    estimate = source.copy()
    for _ in range(6):
        predicted = cv2.GaussianBlur(estimate, (5,5), .8)
        ratio = source / np.maximum(predicted, .008)
        estimate *= cv2.GaussianBlur(ratio, (5,5), .8)
        estimate = np.clip(estimate, 0, 1)
    # Bound correction to prevent bright ringing around shirt seams.
    correction = np.clip(estimate-source, -.065, .065)
    result[20:565,340:945] = np.clip((source + correction*detail_mask)*255, 0,255).astype(np.uint8)
    return result

def composite(frame, released=False):
    alpha = (plane * (1-foreground(frame, released)))[:, :, None]
    result = np.clip(frame*(1-alpha) + plate*alpha, 0,255).astype(np.uint8)
    return restore_detail(result)

clean_idle = [composite(f) for f in idle]
clean_throw = [composite(f, i >= 111) for i, f in enumerate(throw)]
master = clean_idle + clean_throw[48:144] + clean_idle[:12]
assert len(master) == 252
assert all(np.array_equal(f[668:], master[0][668:]) for f in master), 'Felt must remain fixed'
encoder = subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','bgr24',
    '-s','1280x720','-r','24','-i','pipe:0','-an','-c:v','libx264','-crf','17',
    '-preset','fast','-g','24','-keyint_min','24','-pix_fmt','yuv420p',
    '-movflags','+faststart','/tmp/fixed-studio.mp4'], stdin=subprocess.PIPE)
for frame in master:
    encoder.stdin.write(frame.tobytes())
encoder.stdin.close()
assert encoder.wait() == 0
cv2.imwrite('/tmp/fixed-poster.jpg', master[0], [cv2.IMWRITE_JPEG_QUALITY,96])
review = []
for raw, fixed, label in [(idle[0],clean_idle[0],'waiting'), (throw[60],clean_throw[60],'shake'),
                           (throw[104],clean_throw[104],'cupped'), (throw[116],clean_throw[116],'release')]:
    pairs = [raw[40:665,360:930].copy(),fixed[40:665,360:930].copy()]
    for image, suffix in zip(pairs,['before','after']):
        cv2.putText(image,label+' '+suffix,(12,25),cv2.FONT_HERSHEY_SIMPLEX,.7,(255,255,255),2)
    review.append(np.hstack(pairs))
cv2.imwrite('/tmp/fixed-review.jpg', np.vstack(review), [cv2.IMWRITE_JPEG_QUALITY,94])
release = transforms[111] @ np.array([.504*1280,.796*720,1])
def acutance(f):
    return float(cv2.Laplacian(cv2.cvtColor(f[70:220,575:705],cv2.COLOR_BGR2GRAY),cv2.CV_32F).var())
print(json.dumps({'frames':len(master),'duration':10.5,'width':1280,'height':720,
    'release':{'x':float(release[0]/1280),'y':float(release[1]/720)},
    'dieWidth':float(.023*np.linalg.norm(transforms[111][0,:2])),
    'faceEdgeBefore':acutance(throw[60]),'faceEdgeAfter':acutance(clean_throw[60]),
    'fixedFeltRawPixelVariance':0}),flush=True)
