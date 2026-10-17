"""Remove the remaining rear-felt shadow band from the stabilized studio.

Input: /tmp/fixed-input.mp4 (prepare-lucky7-fixed.py output).
Output: /tmp/clean-table.mp4 and its poster. --preview exports only the review.
The repair is limited to the empty felt below the rear rail. Hands and cuffs
are segmented within that strip, excluding the vest/rail that previously
kept a brown reflection attached to the foreground matte.
"""
import cv2
import json
import numpy as np
import subprocess
import sys

cv2.setNumThreads(2)
cap = cv2.VideoCapture('/tmp/fixed-input.mp4')
frames = []
while True:
    ok, frame = cap.read()
    if not ok:
        break
    frames.append(frame)
cap.release()
assert len(frames) == 252 and frames[0].shape[:2] == (720,1280)

baseline = frames[156]
plate = baseline.copy()
# Re-use the same photographed cloth from further forward on this fixed
# table. Neither the dealer, the tray, nor any part of the rail is cloned.
plate[512:592, 310:947] = baseline[592:672, 310:947]
repair = np.zeros((720,1280),np.float32)
repair[516:550, 335:920] = 1
repair[550:580, 335:920] = np.linspace(1,0,30)[:,None]
for x in range(310,335):
    repair[:,x] = repair[:,335] * ((x-310)/25)
for x in range(920,945):
    repair[:,x] = repair[:,919] * ((945-x)/25)

def foreground(frame):
    # Start BELOW the rail: its warm metal and the burgundy vest are not skin.
    roi = frame[516:584,310:947]
    b,g,r = cv2.split(roi.astype(np.float32))
    maximum, minimum = roi.max(axis=2), roi.min(axis=2)
    seeds = (((r > g*1.08) & (r > b*1.17) & (r > 135))
             | ((minimum > maximum*.75) & (maximum > 155)))
    if np.count_nonzero(seeds) < 30:
        return np.zeros((720,1280),np.float32)
    labels = np.full(roi.shape[:2], cv2.GC_PR_BGD, np.uint8)
    labels[(r > g*.95) & (maximum > 90)] = cv2.GC_PR_FGD
    labels[(g > r*1.1) | (maximum < 65)] = cv2.GC_BGD
    labels[seeds] = cv2.GC_FGD
    bg, fg = np.zeros((1,65),np.float64), np.zeros((1,65),np.float64)
    cv2.grabCut(roi, labels, None, bg, fg, 2, cv2.GC_INIT_WITH_MASK)
    mask = ((labels == cv2.GC_FGD) | (labels == cv2.GC_PR_FGD)).astype(np.uint8)
    # Keep the shaded skin between a bright cuff and the palm. Its dark
    # colour can resemble the old shadow, but it is warm and close to the
    # photographed hand. Green felt is never included in this protection.
    near_hand = cv2.dilate(seeds.astype(np.uint8),cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(41,41)))
    mask |= ((r > g*.92) & (near_hand > 0)).astype(np.uint8)
    count, components, stats, _ = cv2.connectedComponentsWithStats(mask)
    seed_counts = np.bincount(components[seeds].ravel(),minlength=count)
    keep = ((seed_counts >= 30) & (stats[:,cv2.CC_STAT_AREA] >= 70)).astype(np.uint8)
    keep[0] = 0
    mask = keep[components]
    contours, _ = cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(mask,contours,-1,1,-1)
    mask = cv2.dilate(mask,np.ones((3,3),np.uint8)).astype(np.float32)
    matte = np.zeros((720,1280),np.float32)
    matte[516:584,310:947] = cv2.GaussianBlur(mask,(3,3),.6)
    return matte

def clean(frame):
    alpha = (repair * (1-foreground(frame)))[:,:,None]
    return np.clip(frame*(1-alpha)+plate*alpha,0,255).astype(np.uint8)

indices = [2,72,156,175,202,211]
review = []
for i in indices:
    before, after = frames[i], clean(frames[i])
    pair = np.hstack([before[485:610,300:960],after[485:610,300:960]])
    cv2.putText(pair,f'{i/24:.2f}s BEFORE / AFTER',(8,118),cv2.FONT_HERSHEY_SIMPLEX,.5,(255,255,255),1)
    review.append(pair)
cv2.imwrite('/tmp/rear-felt-review.jpg',np.vstack(review),[cv2.IMWRITE_JPEG_QUALITY,95])
if '--preview' in sys.argv:
    sys.exit(0)

encoder = subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','bgr24',
    '-s','1280x720','-r','24','-i','pipe:0','-an','-c:v','libx264','-crf','17',
    '-preset','fast','-g','24','-keyint_min','24','-pix_fmt','yuv420p',
    '-movflags','+faststart','/tmp/clean-table.mp4'],stdin=subprocess.PIPE)
for i, frame in enumerate(frames):
    output = clean(frame)
    if i == 0:
        cv2.imwrite('/tmp/clean-table-poster.jpg',output,[cv2.IMWRITE_JPEG_QUALITY,96])
    # This pass changes only the rear felt. Face pixels and held-dice timing
    # are untouched before video encoding.
    assert np.array_equal(output[:516],frame[:516])
    assert np.array_equal(output[584:],frame[584:])
    encoder.stdin.write(output.tobytes())
encoder.stdin.close()
assert encoder.wait() == 0
print(json.dumps({'frames':len(frames),'duration':10.5,'fps':24,
    'repairBounds':{'x':310,'y':516,'width':635,'height':64},
    'unchangedFaceAndTiming':True}),flush=True)
