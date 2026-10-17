import { ROAD_WIDTH, TRACK_LENGTH, sampleTrack } from './track';

export const BIKES = [
  {id:'rr',name:'RR 1000',edition:'Competition',color:'#197bee',accent:'#f14751',power:212,weight:192,maxSpeed:83,accel:10.8,handling:1,description:'Precision at every apex. A balanced, race-bred inline-four.'},
  {id:'v4',name:'V4 CORSA',edition:'Factory',color:'#e93435',accent:'#f5ded7',power:221,weight:198,maxSpeed:87,accel:11.2,handling:.91,description:'Relentless V4 power. Built to own the straights.'},
  {id:'rs',name:'RS 765',edition:'Track edition',color:'#c9ef48',accent:'#232b29',power:153,weight:179,maxSpeed:74,accel:10.1,handling:1.17,description:'Light, agile and planted. Find your rhythm through the bends.'},
] as const;
export type BikeId = typeof BIKES[number]['id'];
export type Mode = 'race' | 'time' | 'free';
export type Phase = 'menu' | 'countdown' | 'racing' | 'paused' | 'finished';
export type Settings = {bike:BikeId;mode:Mode;laps:number;difficulty:'rookie'|'sport'|'pro';assist:boolean;sound:boolean;quality:'high'|'performance';camera:0|1|2};
export const DEFAULT_SETTINGS:Settings={bike:'rr',mode:'race',laps:3,difficulty:'sport',assist:true,sound:true,quality:'high',camera:0};
export type Input = {throttle:boolean;brake:boolean;left:boolean;right:boolean};
export type Rider = {id:number;name:string;distance:number;offset:number;speed:number;lean:number;color:string;accent:string;finishTime:number|null};
export type RaceSnapshot = {
  phase:Phase;speed:number;rpm:number;gear:number;distance:number;offset:number;lean:number;lap:number;position:number;countdown:number;
  elapsed:number;lapTime:number;bestLap:number|null;lastLap:number|null;lapTimes:number[];offTrack:boolean;collision:number;message:string;
  riders:Rider[];standings:{id:number;name:string;distance:number;finishTime:number|null}[];finishedTime:number|null;
};
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const names=['M. ROSSI','K. MILLER','A. MARTIN','L. BINDER','J. REYES'];
const colors=['#ef423b','#ffb632','#8acb32','#e7e8e9','#a76ced'];
export class RaceEngine {
  settings:Settings;
  input:Input={throttle:false,brake:false,left:false,right:false};
  state:RaceSnapshot;
  private lapStart=0;
  private heading=0;
  private collisionCooldown=0;
  private previousPhase:Phase='racing';
  constructor(settings:Settings=DEFAULT_SETTINGS) { this.settings={...settings}; this.state=this.initial(); }
  private initial():RaceSnapshot {
    return {phase:'menu',speed:0,rpm:1500,gear:1,distance:0,offset:0,lean:0,lap:1,position:6,countdown:3,elapsed:0,lapTime:0,bestLap:null,lastLap:null,lapTimes:[],offTrack:false,collision:0,message:'',finishedTime:null,riders:[],standings:[]};
  }
  configure(settings:Settings) {this.settings={...settings};}
  clearInput() {this.input={throttle:false,brake:false,left:false,right:false};}
  start() {
    this.state=this.initial();this.state.phase='countdown';this.state.countdown=3.6;this.lapStart=0;this.heading=0;this.collisionCooldown=0;this.clearInput();
    this.state.riders=this.settings.mode==='race'?names.map((name,id)=>({id:id+1,name,distance:9+(4-id)*7,offset:id%2===0?-2.3:2.3,speed:0,lean:0,color:colors[id],accent:'#eeeeee',finishTime:null})):[];
    this.updateStandings();
  }
  menu() {this.state=this.initial();this.clearInput();}
  pause() {if(this.state.phase==='racing'||this.state.phase==='countdown') {this.previousPhase=this.state.phase;this.state.phase='paused';this.clearInput();}}
  resume() {if(this.state.phase==='paused')this.state.phase=this.previousPhase;}
  togglePause() {if(this.state.phase==='paused')this.resume();else this.pause();}
  recover() {if(this.state.phase==='racing') {this.state.offset=0;this.state.speed=Math.min(12,this.state.speed);this.heading=0;this.state.lean=0;this.state.message='BACK ON TRACK';}}
  private updateStandings() {
    const s=this.state;
    s.standings=[{id:0,name:'YOU',distance:s.distance,finishTime:s.finishedTime},...s.riders.map(r=>({id:r.id,name:r.name,distance:r.distance,finishTime:r.finishTime}))].sort((a,b)=>{
      if(a.finishTime!==null&&b.finishTime!==null)return a.finishTime-b.finishTime;
      if(a.finishTime!==null)return -1;if(b.finishTime!==null)return 1;return b.distance-a.distance;
    });
    s.position=s.standings.findIndex(r=>r.id===0)+1;
  }
  update(delta:number) {
    const dt=clamp(delta,0,.05),s=this.state;
    if(s.phase==='countdown') {s.countdown-=dt;s.rpm=this.input.throttle?7500:1800;if(s.countdown<=0){s.phase='racing';s.countdown=0;}return;}
    if(s.phase!=='racing') return;
    s.elapsed+=dt;s.lapTime=s.elapsed-this.lapStart;
    s.collision=Math.max(0,s.collision-dt);this.collisionCooldown=Math.max(0,this.collisionCooldown-dt);
    const bike=BIKES.find(b=>b.id===this.settings.bike)!;
    const steering=Number(this.input.right)-Number(this.input.left);
    const curve=sampleTrack(s.distance).curvature;
    s.offTrack=Math.abs(s.offset)>ROAD_WIDTH/2;
    const drag=.3+.00105*s.speed*s.speed;
    const engine=this.input.throttle?bike.accel*Math.max(.2,1-s.speed/bike.maxSpeed*.68):-.65;
    const braking=this.input.brake?17.5:0;
    const gripLoss=s.offTrack?4.5+s.speed*.22:0;
    s.speed=clamp(s.speed+(engine-drag-braking-gripLoss)*dt,0,bike.maxSpeed);
    const steeringAuthority=(.27+(.48/(1+s.speed*.025)))*bike.handling;
    const targetHeading=steering*steeringAuthority;
    this.heading+=(targetHeading-this.heading)*(this.settings.assist?3.7:2.2)*dt;
    if(!this.settings.assist)this.heading-=curve*s.speed*dt*.65;
    this.heading=clamp(this.heading,-.7,.7);
    s.offset+=Math.sin(this.heading)*s.speed*dt;
    const lateralLimit=(this.settings.assist?23:17)*bike.handling;
    const excessGrip=Math.max(0,Math.abs(curve)*s.speed*s.speed-lateralLimit);
    // Entering a corner too fast pushes the motorcycle towards the outside edge.
    s.offset-=Math.sign(curve)*excessGrip*dt*.1;
    s.speed=Math.max(0,s.speed-excessGrip*dt*.13);
    // Track-following assistance stabilizes heading; the player still controls speed and line.
    const oldDistance=s.distance;
    s.distance+=s.speed*Math.cos(this.heading)*dt/Math.max(.65,1-curve*s.offset);
    const targetLean=clamp(-Math.atan((curve*s.speed*s.speed+steering*s.speed*1.4)/9.81),-.86,.86);
    s.lean+=(targetLean-s.lean)*Math.min(1,dt*7);
    if(Math.abs(s.offset)>ROAD_WIDTH/2+5) {s.offset=Math.sign(s.offset)*(ROAD_WIDTH/2+4.9);s.speed*=.45;this.heading=0;s.collision=1;s.message='BARRIER CONTACT';}
    s.gear=clamp(Math.floor(s.speed/13)+1,1,6);
    s.rpm=clamp(2200+(s.speed%13)/13*9700+(this.input.throttle?900:0),1500,13000);
    for(const r of s.riders) {
      if(r.finishTime!==null)continue;
      const ahead=Math.abs(sampleTrack(r.distance+28).curvature);
      const factor=this.settings.difficulty==='rookie'?.70:this.settings.difficulty==='sport'?.88:1.04;
      const target=Math.min(73,Math.sqrt(13/Math.max(.002,ahead)))*factor*(.97+r.id*.011);
      r.speed+=(target-r.speed)*Math.min(1,dt*(target<r.speed?1.7:.24));
      r.distance+=r.speed*dt;
      const line=Math.sin(r.distance/120+r.id*1.8)*2.7;
      r.offset+=(line-r.offset)*dt*.8;
      r.lean+=(-Math.atan(sampleTrack(r.distance).curvature*r.speed*r.speed/9.81)-r.lean)*Math.min(1,dt*5);
      const gap=((r.distance-s.distance+TRACK_LENGTH*1.5)%TRACK_LENGTH)-TRACK_LENGTH/2;
      if(Math.abs(gap)<2.05&&Math.abs(r.offset-s.offset)<.85&&this.collisionCooldown<=0) {
        s.speed*=.72;s.offset+=s.offset>=r.offset?.9:-.9;s.collision=.7;this.collisionCooldown=1.1;s.message='RIDER CONTACT';
      }
      if(r.distance>=TRACK_LENGTH*this.settings.laps)r.finishTime=s.elapsed;
    }
    const oldLap=Math.floor(oldDistance/TRACK_LENGTH), newLap=Math.floor(s.distance/TRACK_LENGTH);
    if(newLap>oldLap) {
      const crossing=s.elapsed-dt+(TRACK_LENGTH*newLap-oldDistance)/Math.max(.0001,s.distance-oldDistance)*dt;
      const lap=crossing-this.lapStart;
      s.lapTimes.push(lap);s.lastLap=lap;s.bestLap=Math.min(s.bestLap??Infinity,lap);this.lapStart=crossing;
      s.lapTime=s.elapsed-crossing;s.message='LAP COMPLETE';
      if(this.settings.mode!=='free'&&newLap>=this.settings.laps) {s.phase='finished';s.finishedTime=crossing;this.clearInput();}
    }
    s.lap=this.settings.mode==='free'?newLap+1:Math.min(this.settings.laps,newLap+1);
    if(s.offTrack)s.message='OFF TRACK · GRIP REDUCED';
    else if(s.collision<=0) {
      const nextCurve=sampleTrack(s.distance+Math.max(20,s.speed*.75)).curvature;
      if(s.speed>Math.sqrt(lateralLimit/Math.max(.001,Math.abs(nextCurve)))*1.03)s.message=`BRAKE · ${nextCurve>0?'RIGHT':'LEFT'} TURN`;
      else s.message=s.lapTime<2&&s.lastLap!==null?'LAP COMPLETE':'';
    }
    this.updateStandings();
  }
}
export function formatTime(seconds:number|null) {
  if(seconds===null)return '—:——.———';
  const ms=Math.max(0,Math.floor(seconds*1000));return `${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;
}
export function loadSettings():Settings {
  try {const value=JSON.parse(localStorage.getItem('apex.settings.v1')||'null');if(!value||typeof value!=='object')return {...DEFAULT_SETTINGS};return {
    bike:BIKES.some(b=>b.id===value.bike)?value.bike:DEFAULT_SETTINGS.bike,
    mode:['race','time','free'].includes(value.mode)?value.mode:'race',laps:[1,3,5].includes(value.laps)?value.laps:3,
    difficulty:['rookie','sport','pro'].includes(value.difficulty)?value.difficulty:'sport',
    assist:typeof value.assist==='boolean'?value.assist:true,sound:typeof value.sound==='boolean'?value.sound:true,
    quality:value.quality==='performance'?'performance':'high',camera:[0,1,2].includes(value.camera)?value.camera:0,
  };}catch{return {...DEFAULT_SETTINGS};}
}
