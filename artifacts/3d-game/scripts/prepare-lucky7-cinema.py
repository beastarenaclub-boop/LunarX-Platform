"""Prepare the reviewed continuous cinema take. All hands, felt and physical
dice/shadows stay in the source. Only stationary dice ink is retouched.
Requires FFmpeg, opencv-python-headless, numpy and Pillow.
"""
import argparse, json, subprocess
from pathlib import Path
import cv2, numpy as np
from PIL import Image, ImageDraw
p=argparse.ArgumentParser()
p.add_argument('source')
p.add_argument('output')
args=p.parse_args()
out=Path(args.output); out.mkdir(parents=True,exist_ok=True)
quads=[
 [[[1264,808.5],[1287.5,810.5],[1280.5,818],[1258.5,814.5]],
  [[1259,815],[1280,818],[1279,839],[1259.5,835.5]],
  [[1280,818],[1288.5,813.5],[1288,834],[1279,839]]],
 [[[1311,810],[1333,812],[1328,819],[1306,815]],
  [[1306,816],[1328,819],[1327,841],[1306.5,838]],
  [[1328,819],[1336.5,815],[1336,837],[1327,841]]]
]
base=['ffmpeg','-hide_banner','-loglevel','error','-y']
raw=out/'clean-source.mp4'
pipe=subprocess.Popen(base+['-f','rawvideo','-pix_fmt','bgr24','-s','1920x1080','-r','24','-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','16','-pix_fmt','yuv420p',str(raw)],stdin=subprocess.PIPE)
cap=cv2.VideoCapture(args.source)
assert int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))==1920
mask_shape=np.zeros((54,94),np.uint8)
for die in quads:
 for quad in die:
  poly=np.round(np.array(quad)-[1250,797]).astype(np.int32)
  cv2.fillConvexPoly(mask_shape,poly,255)
dots={1:[(.5,.5)],2:[(.25,.25),(.75,.75)],3:[(.25,.25),(.5,.5),(.75,.75)],4:[(.25,.25),(.75,.25),(.25,.75),(.75,.75)],5:[(.25,.25),(.75,.25),(.5,.5),(.25,.75),(.75,.75)],6:[(.25,.25),(.75,.25),(.25,.5),(.75,.5),(.25,.75),(.75,.75)]}
review=Image.new('RGB',(1800,1120),'#101010')
idx=0; max_changes=0
while True:
 ok,frame=cap.read()
 if not ok: break
 clean=frame.copy()
 if idx<=16 or idx>=98:
  roi=frame[797:851,1250:1344]
  b,g,r=cv2.split(roi.astype(np.float32))
  close=cv2.morphologyEx(roi,cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(9,9)))
  contrast=cv2.cvtColor(close,cv2.COLOR_BGR2GRAY).astype(float)-cv2.cvtColor(roi,cv2.COLOR_BGR2GRAY)
  ink=((contrast>5)|((r<180)&(g<160)&(b<140))).astype(np.uint8)*255
  ink=cv2.dilate(ink,np.ones((3,3),np.uint8))
  repaired=roi.copy()
  for die in quads:
   for quad in die:
    q=np.array(quad)-[1250,797]
    mask=np.zeros(roi.shape[:2],np.uint8)
    cv2.fillConvexPoly(mask,np.round(q*16).astype(np.int32),255,lineType=cv2.LINE_AA,shift=4)
    yy,xx=np.where(mask>200)
    colors=roi[yy,xx].astype(float)
    selected=colors.mean(axis=1)>=np.percentile(colors.mean(axis=1),60)
    design=np.stack([xx/94,yy/54,np.ones(len(xx))],axis=1)
    coeff=np.linalg.lstsq(design[selected],colors[selected],rcond=None)[0]
    yy2,xx2=np.indices(mask.shape)
    fill=np.stack([xx2/94,yy2/54,np.ones(mask.shape)],axis=-1)@coeff
    fill=np.clip(fill,np.percentile(colors[selected],10,axis=0)-8,np.percentile(colors[selected],90,axis=0)+8)
    alpha=(mask/255.*cv2.GaussianBlur(ink,(3,3),.4)/255.)[:,:,None]
    repaired=np.uint8(np.clip(repaired*(1-alpha)+fill*alpha,0,255))
  clean[797:851,1250:1344]=repaired
  changed=np.any(clean!=frame,axis=2)
  max_changes=max(max_changes,int(changed.sum()))
  changed[797:851,1250:1344]=False
  assert not changed.any()
 if idx in [0,98,120,144]:
  preview=clean.copy()
  for die,values in zip(quads,[[3,2,6],[4,2,1]]):
   for quad,value in zip(die,values):
    q=np.array(quad)
    for u,v in dots[value]:
     ring=[]
     for angle in np.linspace(0,2*np.pi,24,endpoint=False):
      a=u+np.cos(angle)*.083; b=v+np.sin(angle)*.083
      point=(1-a)*(1-b)*q[0]+a*(1-b)*q[1]+a*b*q[2]+(1-a)*b*q[3]
      ring.append(np.round(point*16).astype(np.int32))
     cv2.fillPoly(preview,[np.array(ring)],(24,34,43),lineType=cv2.LINE_AA,shift=4)
  row=[0,98,120,144].index(idx)
  for col,img in enumerate([frame,clean,preview]):
   shot=Image.fromarray(cv2.cvtColor(img[785:855,1200:1350],cv2.COLOR_BGR2RGB)).resize((600,280))
   ImageDraw.Draw(shot).text((5,5),str(idx)+' '+['Original','Only ink removed','Server result 3 + 4'][col],fill='white',stroke_width=2,stroke_fill='black')
   review.paste(shot,(col*600,row*280))
 pipe.stdin.write(clean.tobytes())
 idx+=1
pipe.stdin.close()
if pipe.wait()!=0: raise RuntimeError('source encode failed')
cap.release()
review.save(str(out/'asha-cinema-pip-cleanup-review.jpg'),quality=95)
encode=['-an','-c:v','libx264','-profile:v','baseline','-preset','fast','-tune','fastdecode','-crf','20','-pix_fmt','yuv420p','-g','24','-movflags','+faststart']
subprocess.run(base+['-i',str(raw),'-vf','setpts=PTS/1.1,fps=24,setsar=1']+encode+[str(out/'asha-cinema-action-1080p.mp4')],check=True)
# Waiting footage comes from the SAME shot, where her eyes and hands are still.
# Forward interpolation, never ping-pong or reverse playback.
subprocess.run(base+['-i',str(raw),'-vf','trim=start_frame=120:end_frame=145,setpts=2.5*(PTS-STARTPTS),minterpolate=fps=24:mi_mode=blend,setsar=1']+encode+[str(out/'asha-cinema-idle-1080p.mp4')],check=True)
for kind in ['idle','action']:
 hd=out/('asha-cinema-'+kind+'-1080p.mp4')
 mobile=out/('asha-cinema-'+kind+'-720p.mp4')
 subprocess.run(base+['-i',str(hd),'-vf','scale=1280:720']+encode+[str(mobile)],check=True)
 subprocess.run(base+['-i',str(mobile),'-an','-c:v','libvpx','-b:v','0','-crf','20','-deadline','realtime','-cpu-used','6',str(out/('asha-cinema-'+kind+'-720p.webm'))],check=True)
subprocess.run(base+['-i',str(out/'asha-cinema-idle-1080p.mp4'),'-frames:v','1','-q:v','2',str(out/'asha-cinema-poster.jpg')],check=True)
track={'idle':[{'ms':0,'quads':quads}],'action':[{'ms':0,'quads':quads,'previous':True},{'ms':625},{'ms':3750,'quads':quads}]}
(out/'asha-cinema-tracks.json').write_text(json.dumps(track))
print(json.dumps({'frames':idx,'speed':1.1,'releaseMs':3542,'landMs':3750,'pickupMs':625,'maxChangedPixels':max_changes,'protected':'Every pixel outside stationary dice ink; frames 17 through 97 wholly untouched'}))
