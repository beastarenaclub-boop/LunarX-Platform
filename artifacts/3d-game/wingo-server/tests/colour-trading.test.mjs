import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../store.mjs';
import { DURATIONS, PAYOUT_VERSION, multiplierFor } from '../rules.mjs';

test('all ten winning number picks pay 198 paise per rupee, with no changes to old rates', () => {
  assert.deepEqual(DURATIONS, [30]);
  for(let result=0; result<10; result++) {
    let time=1801000;
    const store=createStore(':memory:', {now:()=>time,draw:()=>result});
    try {
      const token=store.session().token, initial=store.state(token);
      assert.equal(initial.round.payoutVersion,PAYOUT_VERSION);
      for(let pick=0; pick<10; pick++) {
        assert.equal(multiplierFor(String(pick),result,3),pick===result?1.98:0);
        assert.equal(multiplierFor(String(pick),result,2),pick===result?8.5:0);
        assert.equal(multiplierFor(String(pick),result,1),pick===result?9:0);
        store.placeBet(token,{duration:30,period:initial.round.period,pick:String(pick),stake:100,request:randomUUID()});
      }
      for(const duration of [60,180,300]) {
        assert.throws(()=>store.state(token,duration),/supported/);
        assert.throws(()=>store.placeBet(token,{duration,period:initial.round.period,pick:'0',stake:100,request:randomUUID()}),/supported/);
      }
      time=initial.round.ends;
      store.tick(); store.tick();
      const settled=store.state(token);
      assert.equal(settled.player.balance,999198);
      assert.equal(settled.bets.filter(b=>b.payout===198).length,1);
      assert.equal(settled.bets.filter(b=>b.payout===0).length,9);
    } finally {store.close();}
  }
});

test('old SQLite rounds without a payout version retain old odds after upgrade',()=>{
  const file=join(mkdtempSync(join(tmpdir(),'colour-upgrade-')),'test.sqlite');
  let time=1801000;
  let store=createStore(file,{now:()=>time,draw:()=>5});
  const token=store.session().token, state=store.state(token);
  store.placeBet(token,{duration:30,period:state.round.period,pick:'5',stake:100,request:randomUUID()});
  store.close();
  const legacy=new DatabaseSync(file);
  legacy.exec('ALTER TABLE rounds DROP COLUMN payoutVersion');
  legacy.close();
  time=state.round.ends;
  store=createStore(file,{now:()=>time,draw:()=>0});
  try {
    assert.equal(store.state(token).bets[0].payout,900);
    assert.equal(store.state(token).round.payoutVersion,3);
    store.tick();
    assert.equal(store.state(token).player.balance,1000800);
  } finally {store.close();}
});
