import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ArrowRight, ChevronLeft, ChevronRight, Flag, Gauge, Trophy, Timer, Volume2, VolumeX, Settings2, X, Pause, Play, RotateCcw, Maximize, Camera, Keyboard, Check, ChevronDown, Sun, MapPin, Zap } from 'lucide-react';
import { BIKES, DEFAULT_SETTINGS, RaceEngine, formatTime, loadSettings, type Settings, type RaceSnapshot, type Input } from './engine';
import { MAP_PATH, TRACK_LENGTH, mapPosition } from './track';
import type { GameScene } from './scene';

type RecordEntry={time:number;bike:string;assist:boolean;date:string};
function readRecords():RecordEntry[] {try{const v=JSON.parse(localStorage.getItem('apex.records.v1')||'[]');return Array.isArray(v)?v.filter(r=>r&&Number.isFinite(r.time)&&r.time>0&&typeof r.bike==='string').slice(0,10):[];}catch{return [];}}
const CAMERA_NAMES=['Chase','Cockpit','Trackside'];
function CircuitMap({state,small=false}:{state?:RaceSnapshot;small?:boolean}) {
  const pos=mapPosition(state?.distance??0);
  return <svg className={small?'circuit-map small':'circuit-map'} viewBox="0 0 205 250" aria-label="Riviera circuit map" role="img">
    <path d={MAP_PATH} fill="none" stroke="currentColor" strokeWidth={small?3:4} strokeLinecap="round" />
    {state?.riders.map(r=>{const p=mapPosition(r.distance);return <circle key={r.id} cx={p.x} cy={p.y} r="3.4" fill={r.color}/>;})}
    <circle cx={pos.x} cy={pos.y} r="6" fill="#dcff51" stroke="#172021" strokeWidth="2"/>
  </svg>;
}
function Toggle({checked,onChange,label}:{checked:boolean;onChange:()=>void;label:string}) {return <button className={`toggle ${checked?'on':''}`} role="switch" aria-checked={checked} aria-label={label} onClick={onChange}><span/></button>;}
export default function App() {
  const canvas=useRef<HTMLCanvasElement>(null),game=useRef<GameScene|null>(null);
  const [settings,setSettings]=useState<Settings>(loadSettings);
  const [state,setState]=useState<RaceSnapshot>(()=>new RaceEngine().state);
  const [ready,setReady]=useState(false),[error,setError]=useState(''),[dialog,setDialog]=useState<'settings'|'controls'|'records'|null>(null);
  const [records,setRecords]=useState<RecordEntry[]>(readRecords);
  const [tab,setTab]=useState<'ride'|'garage'>('ride');
  const [hint,setHint]=useState(''),[touch,setTouch]=useState<Record<string,boolean>>({});
  const settingsRef=useRef(settings);settingsRef.current=settings;
  const savedResult=useRef<string|null>(null);
  const bike=BIKES.find(b=>b.id===settings.bike)!;
  const menu=state.phase==='menu',active=state.phase==='racing'||state.phase==='countdown';
  const setOption=<K extends keyof Settings>(key:K,value:Settings[K])=>setSettings(s=>({...s,[key]:value}));
  useEffect(()=> {
    let dead=false;
    import('./scene').then(async({GameScene})=>{
      await GameScene.prepare();
      if(dead||!canvas.current)return;
      try {game.current=new GameScene(canvas.current,settingsRef.current,s=>setState(s),setError);setReady(true);}catch(err){setError(err instanceof Error?err.message:'WebGL is unavailable on this device.');}
    }).catch(()=>setError('Game files could not load. Please reload the page.'));
    return()=>{dead=true;game.current?.dispose();game.current=null;};
  },[]);
  useEffect(()=>{game.current?.configure(settings);try{localStorage.setItem('apex.settings.v1',JSON.stringify(settings));}catch{/* Storage is optional. */}},[settings]);
  useEffect(()=>{
    if(!dialog&&state.phase!=='paused'&&state.phase!=='finished')return;
    const panel=document.querySelector<HTMLElement>(dialog?'.settings-backdrop .dialog':'.modal-backdrop .dialog');
    if(!panel)return;
    const previous=document.activeElement as HTMLElement;
    const controls=()=>Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),a[href]'));
    controls()[0]?.focus();
    const trap=(event:KeyboardEvent)=>{if(event.code!=='Tab')return;const items=controls(),first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}};
    panel.addEventListener('keydown',trap);return()=>{panel.removeEventListener('keydown',trap);if(previous?.isConnected)previous.focus();};
  },[dialog,state.phase]);
  useEffect(()=>{
    if(state.phase!=='finished'){savedResult.current=null;return;}
    const key=`${state.finishedTime}:${state.bestLap}`;
    if(savedResult.current===key||state.bestLap===null)return;savedResult.current=key;
    const entry={time:state.bestLap,bike:bike.name,assist:settings.assist,date:new Date().toISOString()};
    setRecords(old=>{const next=[...old,entry].sort((a,b)=>a.time-b.time).slice(0,10);try{localStorage.setItem('apex.records.v1',JSON.stringify(next));}catch{}return next;});
  },[state.phase,state.finishedTime,state.bestLap,bike.name,settings.assist]);
  useEffect(()=>{
    const keys:Record<string,keyof Input>={KeyW:'throttle',ArrowUp:'throttle',KeyS:'brake',ArrowDown:'brake',Space:'brake',KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right'};
    const pressed=new Set<string>();
    const sync=()=>{if(!game.current)return;for(const action of ['throttle','brake','left','right'] as const)game.current.engine.input[action]=[...pressed].some(k=>keys[k]===action);};
    const keydown=(e:KeyboardEvent)=> {
      if((e.target as HTMLElement).matches('input,select,textarea'))return;
      const g=game.current;if(!g)return;
      if(keys[e.code]&&['racing','countdown'].includes(g.engine.state.phase)){e.preventDefault();pressed.add(e.code);sync();}
      if(e.repeat)return;
      if(e.code==='Escape'||e.code==='KeyP'){e.preventDefault();pressed.clear();setTouch({});if(dialog)setDialog(null);else g.pause();}
      if(e.code==='KeyC'&&!dialog)setSettings(s=>({...s,camera:((s.camera+1)%3) as 0|1|2}));
      if(e.code==='KeyR'&&!dialog)g.recover();
      if(e.code==='KeyM')setSettings(s=>({...s,sound:!s.sound}));
    };
    const keyup=(e:KeyboardEvent)=>{pressed.delete(e.code);sync();};
    const blur=()=>{pressed.clear();game.current?.engine.clearInput();game.current?.engine.pause();setTouch({});};
    const visibility=()=>{if(document.hidden)blur();};
    window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',blur);document.addEventListener('visibilitychange',visibility);
    return()=>{window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',visibility);};
  },[dialog]);
  const start=()=>{setDialog(null);setTouch({});game.current?.start();};
  const pause=()=>{setTouch({});game.current?.pause();};
  const garageChange=(direction:number)=>{const index=BIKES.findIndex(b=>b.id===settings.bike);setOption('bike',BIKES[(index+direction+BIKES.length)%BIKES.length].id);};
  const fullscreen=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{setHint('Fullscreen is unavailable in this browser.');window.setTimeout(()=>setHint(''),3000);}};
  const touchButton=(action:keyof Input,label:string,className='')=><button className={`touch-button ${className} ${touch[action]?'held':''}`} aria-label={label}
    onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);if(game.current)game.current.engine.input[action]=true;setTouch(s=>({...s,[action]:true}));}}
    onPointerUp={e=>{e.preventDefault();if(game.current)game.current.engine.input[action]=false;setTouch(s=>({...s,[action]:false}));}}
    onPointerCancel={()=>{if(game.current)game.current.engine.input[action]=false;setTouch(s=>({...s,[action]:false}));}}
    onLostPointerCapture={()=>{if(game.current)game.current.engine.input[action]=false;setTouch(s=>({...s,[action]:false}));}}
  >{action==='left'?<ChevronLeft/>:action==='right'?<ChevronRight/>:label}</button>;
  return <main className={`apex-app ${menu?'is-menu':'in-race'}`} data-phase={state.phase}>
    <div className="scene-container"><canvas ref={canvas} aria-label="3D motorcycle racing circuit"/></div>
    <div className="screen-shade"/>
    <header className="topbar">
      <button className="brand" aria-label="APEX home" onClick={()=>{if(menu)setTab('ride');else{game.current?.engine.pause();setState(s=>({...s,phase:'paused'}));}}}><span className="brand-mark">Λ</span><span>APEX<small>MOTORSPORT</small></span></button>
      {menu?<nav className="main-nav" aria-label="Main menu"><button className={tab==='ride'?'selected':''} onClick={()=>setTab('ride')}>RIDE</button><button className={tab==='garage'?'selected':''} onClick={()=>setTab('garage')}>GARAGE</button><button onClick={()=>setDialog('records')}>LAP RECORDS <ArrowUpRight size={13}/></button></nav>:<div className="race-title"><span className="live-dot"/>{settings.mode==='race'?'CIRCUIT RACE':settings.mode==='time'?'TIME ATTACK':'FREE RIDE'}<small>RIVIERA CIRCUIT</small></div>}
      <div className="header-actions"><button className="icon-button sound-button" title={settings.sound?'Mute sound (M)':'Enable sound (M)'} aria-label={settings.sound?'Mute sound':'Enable sound'} onClick={()=>{setOption('sound',!settings.sound);void game.current?.audio.start();}}>{settings.sound?<Volume2 size={18}/>:<VolumeX size={18}/>}</button><button className="icon-button fullscreen-button" title="Fullscreen" aria-label="Fullscreen" onClick={fullscreen}><Maximize size={17}/></button>{menu?<button className="icon-button" title="Settings" aria-label="Settings" onClick={()=>setDialog('settings')}><Settings2 size={19}/></button>:<button className="icon-button" title="Pause (Esc)" aria-label="Pause race" onClick={pause}><Pause size={19}/></button>}</div>
    </header>
    {!ready&&!error&&<div className="loading"><span className="loader"/><span>PREPARING YOUR RIDE<small>Building Riviera Circuit…</small></span></div>}
    {error&&<div className="modal-backdrop"><section className="dialog error-dialog" role="alert"><h2>Let's get you back on track.</h2><p>{error}</p><p>Use a browser with WebGL 2 and hardware acceleration enabled.</p><button className="primary-button" onClick={()=>window.location.reload()}>RELOAD GAME <RotateCcw size={17}/></button></section></div>}
    {ready&&menu&&<>
      <section className="menu-intro">
        <div className="eyebrow"><span/>THE CIRCUIT IS YOURS</div>
        <h1>{tab==='ride'?<>CHASE<br/>THE <em>LIMIT.</em></>:<>BUILT<br/>FOR <em>SPEED.</em></>}</h1>
        <p>{tab==='ride'?'One rider. One machine. Every corner counts.':bike.description}<br/>{tab==='ride'?'Find your line and leave everything behind.':'Choose your machine in the garage below.'}</p>
        <button className="text-button controls-link" onClick={()=>setDialog('controls')}><Keyboard size={16}/> RIDING CONTROLS <ArrowUpRight size={14}/></button>
      </section>
      <div className="bike-callout"><span className="tiny-label">{bike.edition.toUpperCase()} SERIES</span><div><span className="callout-line"/>{bike.name}<span className="bike-number">0{BIKES.findIndex(b=>b.id===bike.id)+1} / 03</span></div></div>
      <section className="setup-dock" aria-label="Race setup">
        <div className="bike-card"><div className="section-label">01 <span>YOUR MACHINE</span></div><div className="bike-choice"><div><span className="tiny-label">{bike.edition}</span><h2>{bike.name}</h2></div><div className="choice-arrows"><button aria-label="Previous motorcycle" onClick={()=>garageChange(-1)}><ChevronLeft size={18}/></button><button aria-label="Next motorcycle" onClick={()=>garageChange(1)}><ChevronRight size={18}/></button></div></div><div className="bike-stats"><div><b>{bike.power}</b><span>HP</span></div><div><b>{bike.weight}</b><span>KG</span></div><div><b>{Math.round(bike.maxSpeed*3.6)}</b><span>KM/H</span></div></div><div className="paint-options">{BIKES.map(b=><button key={b.id} aria-label={`Select ${b.name}`} aria-pressed={b.id===bike.id} style={{'--paint':b.color} as React.CSSProperties} onClick={()=>setOption('bike',b.id)}>{b.id===bike.id&&<Check size={11}/>}</button>)}<span>RACE LIVERY</span></div></div>
        <div className="track-card"><div className="section-label">02 <span>THE DESTINATION</span></div><div className="track-details"><div><div className="tiny-label location"><MapPin size={11}/> FRENCH RIVIERA</div><h2>Riviera Circuit</h2><p>{(TRACK_LENGTH/1000).toFixed(2)} KM <i/> 13 CORNERS <i/> TARMAC</p><span className="weather"><Sun size={15}/> CLEAR SKY <b>24°C</b></span></div><CircuitMap small/></div><div className="track-footer"><span className="live-dot"/> TRACK OPEN <span>DRY CONDITIONS</span></div></div>
        <div className="race-card"><div className="section-label">03 <span>MAKE IT YOURS</span></div><div className="mode-picker" role="group" aria-label="Game mode"><button className={settings.mode==='race'?'selected':''} onClick={()=>setOption('mode','race')}><Flag size={14}/>RACE</button><button className={settings.mode==='time'?'selected':''} onClick={()=>setOption('mode','time')}><Timer size={14}/>TIME ATTACK</button><button className={settings.mode==='free'?'selected':''} onClick={()=>setOption('mode','free')}><Gauge size={14}/>FREE RIDE</button></div><div className="race-options"><label>{settings.mode==='free'?'SESSION':'LAPS'}<span className="select-wrap"><select aria-label="Number of laps" disabled={settings.mode==='free'} value={settings.laps} onChange={e=>setOption('laps',Number(e.target.value))}>{settings.mode==='free'?<option value={settings.laps}>Unlimited</option>:[1,3,5].map(n=><option key={n} value={n}>{n} {n===1?'lap':'laps'}</option>)}</select><ChevronDown size={12}/></span></label><label>{settings.mode==='race'?'OPPONENTS':'RIDING ASSIST'}<span className="select-wrap">{settings.mode==='race'?<select aria-label="Opponent difficulty" value={settings.difficulty} onChange={e=>setOption('difficulty',e.target.value as Settings['difficulty'])}><option value="rookie">Rookie</option><option value="sport">Sport</option><option value="pro">Pro</option></select>:<select aria-label="Riding assistance" value={settings.assist?'on':'off'} onChange={e=>setOption('assist',e.target.value==='on')}><option value="on">Assisted</option><option value="off">Manual</option></select>}<ChevronDown size={12}/></span></label></div><button className="primary-button start-button" onClick={start}>LET'S RIDE <ArrowRight size={20}/></button></div>
      </section>
      <footer className="menu-footer"><span><span className="status-dot"/> REAL-TIME 3D RACING</span><span>NO LIMITS. JUST THE NEXT APEX.</span><button onClick={()=>setDialog('controls')}>KEYBOARD & TOUCH <ArrowUpRight size={11}/></button></footer>
    </>}
    {ready&&!menu&&<>
      <div className="race-hud">
        <section className="race-position"><span className="tiny-label">{settings.mode==='race'?'POSITION':'SESSION'}</span>{settings.mode==='race'?<div><b>{state.position.toString().padStart(2,'0')}</b><span>/ 06</span></div>:<div className="session-icon">{settings.mode==='time'?<Timer size={37}/>:<Gauge size={37}/>}</div>}<div className="lap-label">LAP <b>{state.lap.toString().padStart(2,'0')}</b><span>/ {settings.mode==='free'?'∞':String(settings.laps).padStart(2,'0')}</span></div></section>
        <section className="timing"><div><span>RACE TIME</span><b data-testid="race-time">{formatTime(state.elapsed)}</b></div><div><span>CURRENT LAP</span><b>{formatTime(state.lapTime)}</b></div><div className="best"><span>BEST LAP</span><b>{formatTime(state.bestLap)}</b></div></section>
      </div>
      {settings.mode==='race'&&<aside className="leaderboard">{state.standings.map((r,i)=><div key={r.id} className={r.id===0?'you':''}><span>{i+1}</span><i style={{background:r.id===0?bike.color:state.riders.find(o=>o.id===r.id)?.color}}/><b>{r.name}</b><small>{r.id===0?'RIDER':`${Math.max(0,(state.standings[0].distance-r.distance)/Math.max(state.speed,20)).toFixed(1)}s`}</small></div>)}</aside>}
      <div className="mini-map"><CircuitMap state={state}/><span>RIVIERA CIRCUIT</span></div>
      <div className="speedometer"><div className="rpm-bars">{Array.from({length:20},(_,i)=><i key={i} className={(i<state.rpm/13000*20?'lit ':'')+(i>15?'redline':'')}/>)}</div><div className="speed-main"><div className="gear"><span>GEAR</span><b>{state.speed<.1?'N':state.gear}</b></div><div className="speed"><b data-testid="speed">{Math.round(state.speed*3.6).toString().padStart(3,'0')}</b><span>KM/H</span></div></div><div className="speed-footer"><span>{bike.name}</span><span>{settings.assist?'ASSIST ON':'MANUAL'}</span></div></div>
      <div className="race-bottom-bar"><span><kbd>W</kbd> THROTTLE <kbd>S</kbd> BRAKE <kbd>A</kbd><kbd>D</kbd> STEER</span><div><button onClick={()=>setOption('camera',((settings.camera+1)%3) as 0|1|2)}><Camera size={15}/><span>{CAMERA_NAMES[settings.camera]}</span><kbd>C</kbd></button><button title="Recover to track (R)" aria-label="Recover to track" onClick={()=>game.current?.recover()}><RotateCcw size={15}/><kbd>R</kbd></button></div></div>
      {active&&<div className="touch-controls"><div>{touchButton('left','Steer left')}{touchButton('right','Steer right')}</div><div>{touchButton('brake','BRAKE','brake')}{touchButton('throttle','GAS','gas')}</div></div>}
      {state.phase==='countdown'&&<div className="countdown" aria-live="assertive"><span>GET READY</span><b>{Math.min(3,Math.ceil(state.countdown))}</b><p>HOLD <kbd>W</kbd> OR GAS TO LAUNCH</p></div>}
      {state.phase==='racing'&&state.elapsed<1.1&&<div className="countdown go"><b>GO.</b></div>}
      {state.phase==='racing'&&state.message&&<div className={`track-message ${state.offTrack||state.collision>0?'warning':''}`}>{state.message}</div>}
      {state.phase==='paused'&&<div className="modal-backdrop"><section className="dialog pause-dialog" role="dialog" aria-modal="true" aria-labelledby="pause-title"><div className="eyebrow">TAKE A BREATHER</div><h2 id="pause-title">RIDE PAUSED.</h2><p>Your next apex can wait.</p><button className="primary-button" onClick={pause}>BACK TO THE TRACK <Play size={17}/></button><button className="secondary-button" onClick={start}>RESTART SESSION <RotateCcw size={16}/></button><button className="secondary-button" onClick={()=>setDialog('settings')}>RIDE SETTINGS <Settings2 size={16}/></button><button className="text-button" onClick={()=>{setDialog(null);game.current?.menu();}}>RETURN TO PADDOCK <ArrowRight size={15}/></button></section></div>}
      {state.phase==='finished'&&<div className="modal-backdrop result-backdrop"><section className="dialog results-dialog" role="dialog" aria-modal="true" aria-labelledby="results-title"><div className="eyebrow"><Flag size={16}/> CHEQUERED FLAG</div><h2 id="results-title">{settings.mode==='race'?(state.position===1?'FIRST. CLASS.':'RACE COMPLETE.'):'SESSION COMPLETE.'}</h2><p>{settings.mode==='race'?`P${state.position} of 6 · ${settings.laps} ${settings.laps===1?'lap':'laps'} · ${settings.difficulty.toUpperCase()}`:`${settings.laps} ${settings.laps===1?'lap':'laps'} complete · ${bike.name}`}</p><div className="result-stats"><div><span>TOTAL TIME</span><b>{formatTime(state.finishedTime)}</b></div><div><span>BEST LAP</span><b>{formatTime(state.bestLap)}</b></div></div><div className="lap-results">{state.lapTimes.map((t,i)=><div key={i}><span>LAP {String(i+1).padStart(2,'0')}</span><b>{formatTime(t)}</b>{t===state.bestLap&&<span className="best-tag">BEST</span>}</div>)}</div><button className="primary-button" onClick={start}>RIDE AGAIN <RotateCcw size={17}/></button><button className="text-button" onClick={()=>game.current?.menu()}>RETURN TO PADDOCK <ArrowRight size={15}/></button><small className="save-note">Your fastest lap is saved on this device.</small></section></div>}
    </>}
    {dialog&&<div className="modal-backdrop settings-backdrop" onClick={e=>{if(e.target===e.currentTarget)setDialog(null);}}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button className="close-dialog icon-button" aria-label="Close dialog" autoFocus onClick={()=>setDialog(null)}><X size={20}/></button><div className="eyebrow">APEX / PADDOCK</div><h2 id="dialog-title">{dialog==='settings'?'YOUR RIDE. YOUR RULES.':dialog==='controls'?'FIND YOUR LINE.':'PERSONAL BESTS.'}</h2>
      {dialog==='settings'?<div className="settings-list"><div><span><b>Cornering assistance</b><small>Follows the road direction. You control your racing line.</small></span><Toggle label="Cornering assistance" checked={settings.assist} onChange={()=>setOption('assist',!settings.assist)}/></div><div><span><b>Engine & race audio</b><small>Engine revs, wind and starting lights.</small></span><Toggle label="Engine and race audio" checked={settings.sound} onChange={()=>{setOption('sound',!settings.sound);void game.current?.audio.start();}}/></div><div><span><b>Graphics quality</b><small>Choose Performance for smoother riding on mobile.</small></span><select aria-label="Graphics quality" value={settings.quality} onChange={e=>setOption('quality',e.target.value as Settings['quality'])}><option value="high">High</option><option value="performance">Performance</option></select></div><div><span><b>Camera</b><small>Switch views while riding with C.</small></span><select aria-label="Camera view" value={settings.camera} onChange={e=>setOption('camera',Number(e.target.value) as 0|1|2)}>{CAMERA_NAMES.map((s,i)=><option key={s} value={i}>{s}</option>)}</select></div></div>:dialog==='controls'?<><p>Brake before the corner. Lean into the turn. Accelerate on the exit.</p><div className="controls-list">{[['W / ↑','Throttle'],['S / ↓ / SPACE','Brake'],['A D / ← →','Steer & lean'],['C','Change camera'],['R','Recover to track'],['ESC / P','Pause / resume'],['M','Toggle audio']].map(([key,label])=><div key={key}><span>{label}</span><kbd>{key}</kbd></div>)}</div><p className="help-note">On a phone or tablet, hold the on-screen steering, GAS and BRAKE buttons. Landscape gives you the best view. Cornering assistance is enabled by default.</p></>:<><p>Your ten fastest completed-session laps, saved locally.</p>{records.length?<div className="record-list">{records.map((r,i)=><div key={`${r.date}-${i}`}><span className="record-rank">{String(i+1).padStart(2,'0')}</span><span><b>{r.bike}</b><small>{r.assist?'Assisted':'Manual'}</small></span><strong>{formatTime(r.time)}</strong>{i===0&&<Trophy size={17}/>}</div>)}</div>:<div className="empty-records"><Trophy size={35}/><b>Every great lap starts somewhere.</b><span>Complete a race or time attack to set your first record.</span></div>}</>}
      <button className="primary-button dialog-done" onClick={()=>setDialog(null)}>GOT IT <Check size={17}/></button>
    </section></div>}
    {hint&&<div className="toast" role="status">{hint}</div>}
  </main>;
}
