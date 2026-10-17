# Offline media processing only. Requires opencv-python-headless and numpy.
# Inputs/outputs match the assembly recorded in cast/single-generation.json.
import cv2, numpy as np
cap=cv2.VideoCapture('/tmp/cup.mp4')
out=cv2.VideoWriter('/tmp/clean.avi',cv2.VideoWriter_fourcc(*'MJPG'),24,(960,540))
i=0; stats=[]
while True:
 ok, frame=cap.read()
 if not ok: break
 frame=cv2.resize(frame,(960,540),interpolation=cv2.INTER_AREA)
 if i>=111:
  mask=np.zeros((540,960),np.uint8)
  roi=frame[410:489,446:527]
  lo=roi.min(axis=2).astype(float); hi=roi.max(axis=2).astype(float)
  white=((hi>112)&(lo>.7*hi)).astype(np.uint8)*255
  contours,_=cv2.findContours(white,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
  for contour in contours:
   if cv2.contourArea(contour)>8: cv2.drawContours(white,[cv2.convexHull(contour)],-1,255,-1)
  white=cv2.dilate(white,np.ones((11,11),np.uint8))
  mask[410:489,446:527]=white
  frame=cv2.inpaint(frame,mask,7,cv2.INPAINT_TELEA)
  stats.append(int(np.count_nonzero(mask)))
 out.write(frame);i+=1
cap.release();out.release()
print('frames',i,'cleaned',len(stats),'mask_pixels',min(stats),max(stats))
