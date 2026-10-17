export const ROAD_WIDTH = 13;
const points = [[0,0],[0,155],[55,270],[180,305],[290,230],[280,110],[190,40],[215,-55],[290,-140],[230,-235],[90,-255],[-65,-205],[-100,-90]];
export type TrackPoint = { x:number; z:number; tx:number; tz:number; nx:number; nz:number; curvature:number; distance:number };
function position(t:number) {
  const v = ((t % 1 + 1) % 1) * points.length, i = Math.floor(v), f = v-i;
  const p = [-1,0,1,2].map(n => points[(i+n+points.length)%points.length]);
  return [0,1].map(c => .5*((2*p[1][c])+(-p[0][c]+p[2][c])*f+(2*p[0][c]-5*p[1][c]+4*p[2][c]-p[3][c])*f*f+(-p[0][c]+3*p[1][c]-3*p[2][c]+p[3][c])*f*f*f));
}
const resolution = 1800;
const raw = Array.from({length:resolution+1},(_,i)=>position(i/resolution));
let distance = 0;
export const TRACK: TrackPoint[] = raw.map(([x,z],i)=> {
  if(i) distance += Math.hypot(x-raw[i-1][0],z-raw[i-1][1]);
  const before = raw[(i-1+resolution)%resolution], after = raw[(i+1)%resolution];
  const norm = Math.hypot(after[0]-before[0],after[1]-before[1]);
  const tx = (after[0]-before[0])/norm, tz = (after[1]-before[1])/norm;
  return {x,z,tx,tz,nx:tz,nz:-tx,curvature:0,distance};
});
export const TRACK_LENGTH = distance;
for(let i=0;i<resolution;i++) {
  const a=TRACK[(i-2+resolution)%resolution], b=TRACK[(i+2)%resolution];
  TRACK[i].curvature = Math.atan2(a.tz*b.tx-a.tx*b.tz,a.tx*b.tx+a.tz*b.tz)/Math.max(.01,Math.hypot(b.x-a.x,b.z-a.z));
}
TRACK[resolution].curvature = TRACK[0].curvature;
export function sampleTrack(d:number):TrackPoint {
  d = (d%TRACK_LENGTH+TRACK_LENGTH)%TRACK_LENGTH;
  let lo=0,hi=resolution;
  while(hi-lo>1) { const mid=(lo+hi)>>1; if(TRACK[mid].distance>d) hi=mid; else lo=mid; }
  const a=TRACK[lo],b=TRACK[hi],t=(d-a.distance)/(b.distance-a.distance);
  const tx=a.tx+(b.tx-a.tx)*t,tz=a.tz+(b.tz-a.tz)*t,l=Math.hypot(tx,tz);
  return {x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,tx:tx/l,tz:tz/l,nx:tz/l,nz:-tx/l,curvature:a.curvature+(b.curvature-a.curvature)*t,distance:d};
}
export const MAP_PATH = TRACK.filter((_,i)=>i%12===0).map((p,i)=>`${i?'L':'M'}${((p.x+120)/440*180+10).toFixed(1)},${((p.z+280)/610*220+10).toFixed(1)}`).join(' ')+' Z';
export function mapPosition(d:number) { const p=sampleTrack(d);return {x:(p.x+120)/440*180+10,y:(p.z+280)/610*220+10}; }
export function nearestTrackDistance(x:number,z:number) {
  let min=Infinity;
  for(let i=0;i<TRACK.length;i+=12) min=Math.min(min,Math.hypot(x-TRACK[i].x,z-TRACK[i].z));
  return min;
}
