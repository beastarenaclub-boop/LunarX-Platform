"""Repair the two source middle-card landings before alternating the arms.

The generated source carried each middle card onto its already-open outside
card, while inventing a face in the vacant middle slot. This pass redirects
the filmed forearm/hand/card together, restores the two stationary cards,
and removes that invented middle face until the actual paper returns.
Input/output geometry remains 864 x 496, 24fps. No outcome is baked in.
"""
import cv2
import numpy as np

PAPER = np.array([
    [[249,367],[295,369],[279,390],[227,388]],
    [[303,368],[351,370],[338,392],[285,389]],
    [[358,369],[405,371],[399,393],[345,391]],
    [[451,372],[499,371],[510,394],[457,394]],
    [[507,371],[556,371],[568,392],[515,392]],
    [[563,370],[608,370],[628,391],[575,391]],
], dtype=np.float32)

# Source paper outlines, measured on the native frames. A small margin keeps
# the photographed paper edges and their contact shadow with the hand.
TIMES = [6.0, 146/24, 150/24, 154/24, 160/24, 166/24, 171/24, 7.5]
LEFT_PAPER = np.array([
    PAPER[1], PAPER[1],
    [[279,322],[313,345],[344,396],[293,378]],
    [[252,324],[302,352],[287,392],[230,363]],
    [[253,339],[301,364],[280,396],[229,370]],
    [[255,353],[299,373],[280,394],[228,382]],
    PAPER[0], PAPER[0],
], dtype=np.float32)
RIGHT_PAPER = np.array([
    PAPER[4], [[550,350],[572,342],[572,393],[508,393]],
    [[561,312],[608,320],[608,397],[550,393]],
    [[565,319],[614,327],[632,398],[573,399]],
    [[560,343],[612,335],[633,397],[573,400]],
    [[561,357],[612,350],[631,395],[573,399]],
    PAPER[5], PAPER[5],
], dtype=np.float32)
SHIFT_TIMES = [6.0, 146/24, 6.25, 154/24, 6.65, 7.5, 7.75, 8.5]
SHIFT_LEFT = [0, 0, 14, 55, 55, 55, 42, 0]
SHIFT_RIGHT = [0, -7, -39, -55, -55, -55, -42, 0]

def smooth(value):
    p = np.clip(value, 0, 1)
    return p*p*(3-2*p)

def polygon_mask(points, margin=0):
    mask = np.zeros((496,864), np.uint8)
    cv2.fillConvexPoly(mask, np.round(points).astype(np.int32), 255)
    if margin:
        mask = cv2.dilate(mask, np.ones((margin*2+1, margin*2+1), np.uint8))
    return mask

def outline_at(t, points):
    return np.array([np.interp(t, TIMES, points[:,j,k])
                     for j in range(4) for k in range(2)]).reshape(4,2)

def repair_middle_frames(frames):
    h, w = frames[0].shape[:2]
    assert (h,w) == (496,864) and len(frames) >= 205
    cv2.setNumThreads(2)
    grid_y, grid_x = np.mgrid[:h,:w].astype(np.float32)
    xx = np.arange(w, dtype=np.float32)
    yy = np.arange(h, dtype=np.float32)
    # Anchor the shoulder and sleeve top; move the entire grip and paper
    # together at table height. A wide horizontal feather avoids folds.
    y_weight = smooth((yy-190)/120)
    x_weights = [smooth((xx-165)/65)*smooth((445-xx)/90),
                 smooth((xx-420)/90)*smooth((710-xx)/75)]
    # Reconstruct the fixed rail from uncovered, darker source observations.
    # Stop at the rail: selecting dark samples on the felt would retain
    # fleeting hand shadows as persistent marks.
    rail_samples = np.stack([f[300:344] for f in frames[:205:6]])
    rail_luma = rail_samples.astype(np.float32).mean(axis=3)
    rail_index = np.argsort(rail_luma,axis=0)[len(rail_samples)//4]
    rail_y,rail_x = np.mgrid[:44,:w]
    clear_rail = rail_samples[rail_index,rail_y,rail_x]
    bases = []
    patches = []
    for side, middle in [(0,1),(1,4)]:
        base = frames[204].copy()
        # At 4.5s both hands are on the inside cards, exposing the rail
        # where the final frame has resting fingers. Use those real pixels.
        if side == 0:
            base[:,:278] = frames[108][:,:278]
            x0,x1 = 188,448
        else:
            base[:,590:] = frames[108][:,590:]
            x0,x1 = 416,671
        base[300:344] = clear_rail
        hole = polygon_mask(PAPER[middle], 4)
        empty = cv2.inpaint(base, hole, 5, cv2.INPAINT_TELEA)
        fill = cv2.GaussianBlur(hole.astype(np.float32)/255,(5,5),.8)[:,:,None]
        bases.append((empty, base, fill))
        patch = (smooth((xx-x0)/9)*smooth((x1-xx)/9))[None,:]
        patch = patch * (smooth((yy-309)/9)*smooth((414-yy)/9))[:,None]
        patches.append(patch[:,:,None])
    output = list(frames)
    for i in range(142, min(len(frames),205)):
        t = i/24
        original = frames[i]
        ramp = smooth((t-5.9)/.10) * (1-smooth((t-8.2)/.3))
        result = original.copy()
        for side, middle in [(0,1),(1,4)]:
            dx = float(np.interp(t, SHIFT_TIMES, SHIFT_LEFT if side == 0 else SHIFT_RIGHT))
            # Invert the monotonic forward displacement to resample once.
            map_x = np.empty((h,w),np.float32)
            for row in range(h):
                forward = xx + dx*y_weight[row]*x_weights[side]
                assert np.min(np.diff(forward)) > .02
                map_x[row] = np.interp(xx, forward, xx)
            warped = cv2.remap(original,map_x,grid_y,cv2.INTER_CUBIC,
                               borderMode=cv2.BORDER_REPLICATE)
            hsv = cv2.cvtColor(original,cv2.COLOR_BGR2HSV)
            b,g,r = cv2.split(original.astype(np.float32))
            paper = outline_at(t,LEFT_PAPER if side==0 else RIGHT_PAPER)
            grip = paper[0 if side==0 else 1].copy()
            retract = smooth((t-7.5)/1.0)
            grip = grip*(1-retract)+np.array([205 if side==0 else 656,350])*retract
            hand_roi = ((grid_x>grip[0]-(40 if side==0 else 80)) &
                        (grid_x<grip[0]+(80 if side==0 else 40)) &
                        (grid_y>grip[1]-110) & (grid_y<grip[1]+25))
            skin = (r>g+12)&(g>b+3)&(hsv[:,:,0]<35)&(hsv[:,:,1]>50)&(hsv[:,:,2]>45)
            cuff = (hsv[:,:,1]<38)&(hsv[:,:,2]>125)&(grid_y<351)
            hand = np.uint8((skin|cuff)&hand_roi)
            hand = cv2.morphologyEx(hand,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
            count,labels,stats,_ = cv2.connectedComponentsWithStats(hand)
            nearby = ((grid_x-grip[0])**2+(grid_y-grip[1])**2)<22**2
            choices = [label for label in np.unique(labels[nearby]) if label and stats[label,cv2.CC_STAT_AREA]>20]
            chosen = max(choices,key=lambda label:stats[label,cv2.CC_STAT_AREA]) if choices else 0
            foreground = np.float32(labels==chosen) if chosen else np.zeros((h,w),np.float32)
            paper_shape = np.zeros((h,w),np.float32)
            if t <= 7.5:
                paper_shape = polygon_mask(paper,2)/255
                paper_pixels = (smooth((hsv[:,:,2].astype(np.float32)-85)/35) *
                                smooth((95-hsv[:,:,1].astype(np.float32))/25) *
                                smooth((r-g+5)/7))
                paper_pixels = cv2.morphologyEx(paper_pixels,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
                paper_opacity = 1-smooth((t-6.12)/.15)
                paper_mask = paper_shape*(paper_opacity+(1-paper_opacity)*paper_pixels)
                foreground = np.maximum(foreground,paper_mask)
            # Refine one connected photographed hand/card silhouette. Color
            # thresholds seed the matte; graph cut recovers anti-aliased
            # fingers and white paper edges without copying stationary cards.
            roi_x0,roi_x1 = (185,426) if side==0 else (440,674)
            roi_y0,roi_y1 = 225,411
            seeds = np.uint8(foreground>.65)
            possible = hand_roi | (polygon_mask(paper,6)>0 if t<=7.5 else False)
            matte = np.zeros((h,w),np.uint8)
            matte[possible] = cv2.GC_PR_BGD
            matte[(cv2.dilate(seeds,np.ones((7,7),np.uint8))>0)&possible] = cv2.GC_PR_FGD
            for stationary in ([0,1,2] if side==0 else [3,4,5]):
                fixed = polygon_mask(PAPER[stationary],2)>0
                matte[fixed&(paper_shape==0)&(foreground<.5)] = cv2.GC_BGD
            matte[cv2.erode(seeds,np.ones((3,3),np.uint8))>0] = cv2.GC_FGD
            crop = original[roi_y0:roi_y1,roi_x0:roi_x1].copy()
            crop_mask = matte[roi_y0:roi_y1,roi_x0:roi_x1].copy()
            if np.any(crop_mask==cv2.GC_FGD):
                cv2.grabCut(crop,crop_mask,None,np.zeros((1,65)),np.zeros((1,65)),2,cv2.GC_INIT_WITH_MASK)
                foreground = np.zeros((h,w),np.float32)
                foreground[roi_y0:roi_y1,roi_x0:roi_x1] = np.float32((crop_mask==cv2.GC_FGD)|(crop_mask==cv2.GC_PR_FGD))
            foreground = cv2.GaussianBlur(foreground.astype(np.float32),(3,3),.5)
            foreground = cv2.remap(foreground,map_x,grid_y,cv2.INTER_LINEAR)[:,:,None]
            empty, flat, fill = bases[side]
            landed = smooth((t-7.25)/.20)
            base = empty*(1-fill*landed) + flat*fill*landed
            table = base*(1-foreground) + warped*foreground
            corrected = warped*(1-patches[side]*ramp)+table*patches[side]*ramp
            # Only this arm half is affected. Both halves join in the empty
            # center felt; the same correction is later sampled independently.
            half = (smooth((440-xx)/16) if side==0 else smooth((xx-424)/16))[None,:,None]
            result = np.clip(result*(1-half)+corrected*half,0,255).astype(np.uint8)
        output[i] = result
    return output

if __name__ == '__main__':
    import sys,subprocess
    from pathlib import Path
    root = Path(sys.argv[2]); root.mkdir(parents=True,exist_ok=True)
    cap=cv2.VideoCapture(sys.argv[1]); frames=[]
    while True:
        ok,frame=cap.read()
        if not ok:break
        frames.append(frame)
    cap.release()
    if len(frames)>300:frames=frames[144:]
    corrected=repair_middle_frames(frames)
    encoder=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','bgr24',
        '-s','864x496','-r','24','-i','pipe:0','-an','-c:v','libx264','-crf','17',
        '-pix_fmt','yuv420p','-movflags','+faststart',str(root/'middle-preview.mp4')],stdin=subprocess.PIPE)
    for frame in corrected[138:193]:encoder.stdin.write(frame.tobytes())
    encoder.stdin.close();assert encoder.wait()==0
    review=[]
    for i in [146,150,154,158,162,166,170,174,178,182,186,192]:
        f=corrected[i][270:415,200:680].copy()
        cv2.putText(f,f'{i}/24 = {i/24:.2f}s',(8,16),cv2.FONT_HERSHEY_SIMPLEX,.45,(255,255,255),1)
        review.append(f)
    cv2.imwrite(str(root/'middle-review.jpg'),np.vstack([np.hstack(review[i:i+3]) for i in range(0,12,3)]))
    print('Middle-card repair preview complete',flush=True)
