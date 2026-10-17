import { test, expect } from '@playwright/test';
import { RaceEngine, DEFAULT_SETTINGS, loadSettings, formatTime } from '../src/engine';
import { sampleTrack, TRACK_LENGTH } from '../src/track';

function run(engine:RaceEngine,seconds:number) {for(let i=0;i<seconds*60;i++)engine.update(1/60);}
function launched(mode:'time'|'race'|'free'='time') {const engine=new RaceEngine({...DEFAULT_SETTINGS,mode,laps:1});engine.start();run(engine,3.7);return engine;}
function ride(engine:RaceEngine,seconds:number) {
  for(let i=0;i<seconds*60;i++) {
    if(engine.state.phase==='finished')break;
    const turn=Math.max(...[0,15,35,55].map(d=>Math.abs(sampleTrack(engine.state.distance+d).curvature)));
    const target=Math.min(62,Math.sqrt(19/Math.max(.001,turn)));
    engine.input.throttle=engine.state.speed<target;engine.input.brake=engine.state.speed>target+1;
    engine.update(1/60);
  }
}
test('closed circuit has continuous position and direction at the finish line',()=>{
  const a=sampleTrack(-.001),b=sampleTrack(.001);
  expect(Math.hypot(a.x-b.x,a.z-b.z)).toBeLessThan(.003);
  expect(Math.abs(a.tx-b.tx)+Math.abs(a.tz-b.tz)).toBeLessThan(.001);
  expect(TRACK_LENGTH).toBeGreaterThan(1400);
});
test('countdown gates movement, throttle accelerates and braking slows the rider',()=>{
  const e=new RaceEngine();e.start();e.input.throttle=true;run(e,2);
  expect(e.state.phase).toBe('countdown');expect(e.state.distance).toBe(0);
  run(e,5);expect(e.state.speed).toBeGreaterThan(15);expect(e.state.distance).toBeGreaterThan(20);
  const speed=e.state.speed;e.input.throttle=false;e.input.brake=true;run(e,1);
  expect(e.state.speed).toBeLessThan(speed-10);
});
test('steering, run-off resistance, barrier contact and track recovery work',()=>{
  const e=launched();e.input.throttle=true;run(e,7);const onRoadSpeed=e.state.speed;
  e.input.right=true;run(e,2);expect(e.state.offset).toBeGreaterThan(6.5);expect(e.state.offTrack).toBe(true);expect(e.state.speed).toBeLessThan(onRoadSpeed);
  run(e,8);expect(Math.abs(e.state.offset)).toBeLessThanOrEqual(11.5);
  e.recover();expect(e.state.offset).toBe(0);expect(e.state.speed).toBeLessThanOrEqual(12);
});
test('pause freezes the clock and movement and clears all input',()=>{
  const e=launched();e.input.throttle=true;run(e,4);e.pause();const old={...e.state};run(e,10);
  expect(e.state.distance).toBe(old.distance);expect(e.state.elapsed).toBe(old.elapsed);expect(e.input.throttle).toBe(false);
  e.resume();expect(e.state.phase).toBe('racing');e.input.throttle=true;run(e,1);expect(e.state.distance).toBeGreaterThan(old.distance);
});
test('a complete timed lap produces results; restart fully resets the session',()=>{
  const e=launched();ride(e,120);
  expect(e.state.phase).toBe('finished');expect(e.state.lapTimes).toHaveLength(1);expect(e.state.bestLap).toBeGreaterThan(20);
  expect(e.state.finishedTime).toBe(e.state.bestLap);expect(e.input.throttle).toBe(false);
  e.start();expect(e.state.phase).toBe('countdown');expect(e.state.distance).toBe(0);expect(e.state.lapTimes).toEqual([]);expect(e.state.finishedTime).toBeNull();
});
test('free ride remains open after a lap and race opponents independently finish',()=>{
  const free=launched('free');ride(free,120);expect(free.state.phase).toBe('racing');expect(free.state.lap).toBeGreaterThan(1);
  const race=launched('race');run(race,150);expect(race.state.riders).toHaveLength(5);expect(race.state.riders.every(r=>r.finishTime!==null)).toBe(true);expect(race.state.position).toBe(6);expect(race.state.phase).toBe('racing');
});
test('three-lap timing records distinct laps and stops exactly at the requested total',()=>{
  const e=new RaceEngine({...DEFAULT_SETTINGS,mode:'time',laps:3});e.start();run(e,3.7);ride(e,240);
  expect(e.state.phase).toBe('finished');expect(e.state.lapTimes).toHaveLength(3);expect(e.state.lap).toBe(3);
  expect(e.state.lapTimes.reduce((a,b)=>a+b,0)).toBeCloseTo(e.state.finishedTime!,5);
});
test('manual mode needs cornering input and time formatting carries correctly',()=>{
  const e=launched();e.settings.assist=false;e.input.throttle=true;run(e,20);expect(Math.abs(e.state.offset)).toBeGreaterThan(1);
  expect(formatTime(61.234)).toBe('1:01.234');expect(formatTime(null)).toBe('—:——.———');expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
});
