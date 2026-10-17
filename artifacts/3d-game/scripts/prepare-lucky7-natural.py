"""Prepare this reviewed Lucky 7 take; measured bounds are specific to its source.
Only the dice already separated from her fingers are removed. Keep all hands intact.
Requires FFmpeg, opencv-python-headless, numpy and Pillow.
"""
import argparse
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument("source")
parser.add_argument("output", help="Output directory")
args=parser.parse_args()
out=Path(args.output)
out.mkdir(parents=True,exist_ok=True)
import cv2, numpy as np, subprocess
from PIL import Image, ImageDraw
cap=cv2.VideoCapture(args.source)
pipe=subprocess.Popen(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s','1920x1080','-r','24','-i','pipe:0','-an','-vf','setpts=PTS/1.25,fps=24,setsar=1','-c:v','libx264','-profile:v','baseline','-preset','fast','-tune','fastdecode','-crf','19','-pix_fmt','yuv420p','-g','24','-movflags','+faststart',str(out/'asha-natural-action-1080p.mp4')],stdin=subprocess.PIPE)
review=Image.new('RGB',(1500,1600),'#111')
reference=None
idx=0
while True:
 ok, frame=cap.read()
 if not ok: break
 if reference is None: reference=frame.copy()
 cleaned=frame.copy()
 mask=np.zeros(frame.shape[:2],np.uint8)
 if idx>=78:
  roi=frame[735:875,885:1150]
  b,g,r=cv2.split(roi.astype(np.float32))
  candidates=((r>120)&(g>90)&(r>g*1.07)&(g>b*1.04)).astype(np.uint8)*255
  contours,_=cv2.findContours(candidates,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
  local=np.zeros(candidates.shape,np.uint8)
  for contour in contours:
   if cv2.contourArea(contour)>=5: cv2.drawContours(local,[contour],-1,255,-1)
  local=cv2.dilate(local,np.ones((13,13),np.uint8))
  mask[735:875,885:1150]=local
  count, labels=cv2.connectedComponents(local)
  base=reference[735:875,885:1150].astype(np.float32)
  original=frame[735:875,885:1150].astype(np.float32)
  restored=original.copy()
  for component in range(1,count):
   area=(labels==component).astype(np.uint8)*255
   ring=(cv2.dilate(area,np.ones((17,17),np.uint8))>0)&(local==0)
   correction=np.median(original[ring]-base[ring],axis=0) if np.any(ring) else np.zeros(3)
   fill=np.clip(base+correction,0,255)
   alpha=cv2.GaussianBlur(area,(9,9),2).astype(np.float32)/255
   alpha=alpha[:,:,None]
   restored=restored*(1-alpha)+fill*alpha
  cleaned[735:875,885:1150]=np.clip(restored,0,255).astype(np.uint8)
  assert np.array_equal(frame[:735],cleaned[:735])
 if idx in [78,79,80,82,86,90,100,130]:
  row=[78,79,80,82,86,90,100,130].index(idx)
  marked=frame.copy()
  marked[mask>0]=(0,0,255)
  for col,picture in enumerate([frame,cleaned,marked]):
   shot=Image.fromarray(cv2.cvtColor(picture[640:880,760:1360],cv2.COLOR_BGR2RGB)).resize((500,200))
   ImageDraw.Draw(shot).text((5,5),f'{idx/24:.3f}s '+['Original','Clean felt','Changed pixels'][col],fill='white',stroke_width=1,stroke_fill='black')
   review.paste(shot,(col*500,row*200))
 pipe.stdin.write(cleaned.tobytes())
 idx+=1
pipe.stdin.close()
if pipe.wait()!=0: raise RuntimeError('encode failed')
cap.release()
review.save(str(out/'asha-natural-restoration-review.jpg'),quality=92)
print('Preserved all original pixels above y735 in',idx,'frames; edits only in felt ROI x885..1149/y735..874 after frame78')
