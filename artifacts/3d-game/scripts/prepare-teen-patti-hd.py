"""Package a native 1080p dealer take without retiming or blending hands.

Usage: python prepare-teen-patti-hd.py SOURCE OUTDIR CLEAN_UNTIL RESULT_TIME [TAIL TAIL_START]
Only the six prop backs in the waiting segment are removed, using nearby
photographed felt. The game deals its six authoritative backs onto that plate.
Every opening frame, face and hand follows the original whole performance.
Requires OpenCV/NumPy and FFmpeg (or imageio-ffmpeg). Run from repository root.
"""
import cv2
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
import numpy as np

cv2.setNumThreads(2)
source, out = Path(sys.argv[1]), Path(sys.argv[2])
clean_until = float(sys.argv[3])
result_time = float(sys.argv[4])
tail_path = Path(sys.argv[5]) if len(sys.argv)>5 else None
tail_start = float(sys.argv[6]) if tail_path else None
out.mkdir(parents=True, exist_ok=True)
ffmpeg = os.environ.get('FFMPEG') or shutil.which('ffmpeg')
if not ffmpeg:
    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
cap = cv2.VideoCapture(str(source))
fps = cap.get(cv2.CAP_PROP_FPS)
width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
assert (width, height, fps) == (1920, 1080, 24), (width,height,fps)
ok, first = cap.read()
assert ok

def card_quads(frame):
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    white = cv2.inRange(hsv, (0,0,130), (179,80,255))
    white[:int(height*.7)] = 0
    contours, _ = cv2.findContours(white, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    quads = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if not 3000 < area < 16000:
            continue
        polygon = cv2.approxPolyDP(contour, .025*cv2.arcLength(contour,True),True)[:,0]
        if len(polygon) != 4:
            continue
        # Sort top-left, top-right, bottom-right, bottom-left in image space.
        top = sorted(sorted(polygon.tolist(),key=lambda p:p[1])[:2])
        bottom = sorted(sorted(polygon.tolist(),key=lambda p:p[1])[2:])
        quads.append([top[0],top[1],bottom[1],bottom[0]])
    quads.sort(key=lambda q:sum(p[0] for p in q))
    assert len(quads) == 6, quads
    return quads

backs = card_quads(first)
tail_map = None
registration = None
if tail_path:
    tail_cap = cv2.VideoCapture(str(tail_path))
    ok, tail_first = tail_cap.read()
    tail_cap.release()
    assert ok
    cap.set(cv2.CAP_PROP_POS_FRAMES, round(tail_start*fps))
    ok, join = cap.read()
    assert ok
    # Register the generated continuation once. Its room and table are a few
    # pixels offset from the reference. No temporal interpolation/hand patches.
    room_mask = np.full((height,width),255,np.uint8)
    room_mask[:900,500:1350] = 0
    room_mask[900:] = 0
    orb = cv2.ORB_create(5000)
    k1,d1 = orb.detectAndCompute(cv2.cvtColor(tail_first,cv2.COLOR_BGR2GRAY),room_mask)
    k2,d2 = orb.detectAndCompute(cv2.cvtColor(join,cv2.COLOR_BGR2GRAY),room_mask)
    matches = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(d1,d2,k=2)
    good = [a for a,b in matches if a.distance < b.distance*.7]
    room, inliers = cv2.estimateAffinePartial2D(
        np.float32([k1[m.queryIdx].pt for m in good]),
        np.float32([k2[m.trainIdx].pt for m in good]),
        method=cv2.RANSAC,ransacReprojThreshold=2)
    assert inliers.sum() > 80
    table,_ = cv2.estimateAffine2D(np.float32(card_quads(tail_first)).reshape(-1,2),
        np.float32(backs).reshape(-1,2),method=cv2.RANSAC,ransacReprojThreshold=3)
    yy,xx = np.mgrid[0:height,0:width].astype(np.float32)
    mix = np.clip((yy-500)/400,0,1)
    mix = mix*mix*(3-2*mix)
    maps = []
    for matrix in [room,table]:
        inv = cv2.invertAffineTransform(matrix)
        maps.append([inv[r,0]*xx+inv[r,1]*yy+inv[r,2] for r in range(2)])
    tail_map = tuple((maps[0][r]*(1-mix)+maps[1][r]*mix).astype(np.float32) for r in range(2))
    registration = {'room':room.tolist(),'table':table.tolist(),'blendRows':[500,900]}
mask = np.zeros((height,width), np.uint8)
for quad in backs:
    cv2.fillConvexPoly(mask, np.array(quad,np.int32), 255)
mask = cv2.dilate(mask,np.ones((13,13),np.uint8))
alpha = (cv2.GaussianBlur(mask,(9,9),2).astype(np.float32)/255)[:,:,None]
ring = cv2.dilate(mask,np.ones((31,31),np.uint8)) - cv2.dilate(mask,np.ones((11,11),np.uint8))
offset = 80
assert np.where(mask)[0].max()+offset < height

encoder = subprocess.Popen([ffmpeg,'-hide_banner','-loglevel','error','-y',
    '-f','rawvideo','-pix_fmt','bgr24','-s',f'{width}x{height}','-r',str(fps),'-i','pipe:0',
    '-an','-c:v','libx264','-crf','18','-preset','medium','-g','24','-keyint_min','24',
    '-pix_fmt','yuv420p','-movflags','+faststart',str(out/'riya-hd-studio.mp4')],stdin=subprocess.PIPE)
cap.set(cv2.CAP_PROP_POS_FRAMES,0)
count = 0
posters = {24:'betting',round(clean_until*fps):'opening',round(result_time*fps):'result'}
while True:
    if tail_path and count == round(tail_start*fps):
        cap.release()
        cap = cv2.VideoCapture(str(tail_path))
        assert (int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),cap.get(cv2.CAP_PROP_FPS)) == (width,height,fps)
    ok, frame = cap.read()
    if not ok:
        break
    if tail_map is not None and count >= round(tail_start*fps):
        frame = cv2.remap(frame,*tail_map,cv2.INTER_LANCZOS4,borderMode=cv2.BORDER_REFLECT_101)
    original = frame
    if count/fps < clean_until:
        felt = np.roll(frame,-offset,axis=0).astype(np.float32)
        hsv = cv2.cvtColor(frame,cv2.COLOR_BGR2HSV)
        sample = (ring>0)&(hsv[:,:,0]>35)&(hsv[:,:,0]<95)&(hsv[:,:,1]>60)
        assert sample.sum()>100
        delta = np.median(frame[sample].astype(np.float32)-felt[sample],axis=0)
        felt = np.clip(felt+delta,0,255)
        frame = np.clip(frame.astype(np.float32)*(1-alpha)+felt*alpha,0,255).astype(np.uint8)
        # Never change a face, hand, arm or a pixel outside the felt patches.
        assert np.array_equal(frame[alpha[:,:,0]==0],original[alpha[:,:,0]==0])
    if count in posters:
        cv2.imwrite(str(out/f'riya-hd-{posters[count]}.jpg'),frame,[cv2.IMWRITE_JPEG_QUALITY,96])
    if count == round(result_time*fps):
        faces = card_quads(frame)
    encoder.stdin.write(frame.tobytes())
    count += 1
cap.release()
encoder.stdin.close()
assert encoder.wait()==0
record = {'width':width,'height':height,'fps':fps,'frames':count,
    'source':str(source),'tail':str(tail_path) if tail_path else None,'tailStart':tail_start,
    'cleanUntil':clean_until,'resultTime':result_time,'handRetiming':False,'frameBlending':False,
    'tailRegistration':registration,
    'backQuads':backs,'faceQuads':faces,
    'worldBackQuads':np.round(np.array(backs)*.45,2).tolist(),
    'worldFaceQuads':np.round(np.array(faces)*.45,2).tolist()}
(out/'riya-hd-media.json').write_text(json.dumps(record,indent=2))
print(json.dumps(record),flush=True)
