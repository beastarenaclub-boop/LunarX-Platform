import {test} from 'node:test';
import assert from 'node:assert/strict';
import {footballPlayerPosition,footballPlay,footballGoalReplay} from '../../artifacts/3d-game/src/components/virtual-sports/FootballMotion.ts';
test('all players and ball remain inside the regulation pitch throughout live play',()=>{
 for(let t=0;t<=45;t+=.025){
  for(let i=0;i<22;i++){const p=footballPlayerPosition(i,t,true);assert.ok(Math.abs(p.x)<52.5&&Math.abs(p.z)<34);}
  const {ball,carrier,receiver}=footballPlay(t,true);assert.ok(Math.abs(ball.x)<52.5&&Math.abs(ball.z)<34);assert.ok(ball.y>=.111);assert.ok(carrier>=0&&carrier<22&&receiver>=0&&receiver<22);
 }
});
test('pass handoffs do not jump to an unrelated player',()=>{
 for(let n=1;n<17;n++){
  const a=footballPlay(n*2.7-.0001,true),b=footballPlay(n*2.7+.0001,true);
  assert.equal(a.receiver,b.carrier);assert.ok(Math.hypot(a.ball.x-b.ball.x,a.ball.z-b.ball.z)<.6);
 }
});
test('warmup stays at kickoff and revealed goal replays enter the correct goal mouth',()=>{
 assert.deepEqual(footballPlay(20,false).ball,{x:0,z:0,y:.112});
 for(const team of [0,1]){const p=footballGoalReplay(team,1.1);assert.equal(p.x,team===0?53:-53);assert.ok(Math.abs(p.z)<3.66&&p.y<2.44);}
});
