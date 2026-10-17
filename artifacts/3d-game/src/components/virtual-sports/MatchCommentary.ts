import { useCallback, useEffect, useRef, useState } from 'react';
import { installAudioAutostart } from '../../game/audioAutostart';
import type { Round } from '../../../../../lib/virtual-sports/store.mjs';
import type { Sport } from '../../../../../lib/virtual-sports/catalog.mjs';
import lines from './commentary-hi.json';

const phrases:Record<string,string>=lines;
export function commentaryKey(round:Round|undefined,sport:Sport):string {
  if(!round)return 'welcome';
  const fixture=round.fixture?.id??'classic';
  if(round.phase==='betting')return `intro-${sport.id}-${fixture}`;
  if(round.phase==='result'){
    if(sport.selections.length===3&&round.winner===1)return 'draw';
    const winner=sport.selections.length===3?(round.winner===0?0:1):round.winner;
    return `win-${sport.id}-${fixture}-${winner}`;
  }
  const event=round.events.at(-1);
  if(!event)return `start-${sport.id}`;
  if(sport.id==='cricket')return ({0:'dot',1:'one',2:'two',3:'three',4:'four',6:'six'} as Record<number,string>)[event.points]??'break';
  if(event.kind==='goal')return 'goal';
  if(event.kind==='save')return event.text.includes('save')?'save':'possession';
  if(event.kind==='basket')return 'basket';
  if(event.kind==='point')return 'point';
  if(sport.id==='formula')return 'lap';
  return 'break';
}
export function useMatchCommentary(round:Round|undefined,sport:Sport,enabled:boolean){
  const narration=useRef<HTMLAudioElement|null>(null),crowd=useRef<HTMLAudioElement|null>(null),last=useRef(''),context=useRef('');
  const [playing,setPlaying]=useState(false),[blocked,setBlocked]=useState(false);
  const [spokenCaption,setSpokenCaption]=useState('');
  const key=commentaryKey(round,sport),caption=phrases[key]??phrases.finish;
  const latest=useRef({enabled,round,key,caption});latest.current={enabled,round,key,caption};
  const generation=useRef(0);
  const retry=useCallback(()=>{
    const s=latest.current,voice=narration.current,bed=crowd.current;
    if(!s.enabled||document.hidden||!voice||!bed)return;
    if(bed.paused)void bed.play().catch(()=>{});
    if(!s.round)return;
    const token=`${s.round.id}:${s.round.phase}:${s.round.events.at(-1)?.at??0}`;
    if(last.current===token)return;
    const nextContext=`${s.round.id}:${s.round.phase}`;
    const priority=context.current!==nextContext||s.key==='goal';
    if(!voice.paused&&!voice.ended&&!priority)return;
    context.current=nextContext;last.current=token;
    const request=++generation.current;
    voice.pause();voice.src=`/virtual-sports/audio/hi/${phrases[s.key]?s.key:'finish'}.ogg`;
    setSpokenCaption(s.caption);
    void voice.play().then(()=>{if(request===generation.current)setBlocked(false);}).catch(()=>{
      if(request!==generation.current)return;
      last.current='';setBlocked(true);setPlaying(false);
    });
  },[]);
  useEffect(()=>{
    const voice=new Audio();voice.preload='auto';voice.volume=.92;narration.current=voice;
    const bed=new Audio('/virtual-sports/audio/crowd.mp3');bed.loop=true;bed.volume=.1;crowd.current=bed;
    voice.onplay=()=>{setPlaying(true);bed.volume=.055;};
    voice.onended=()=>{setPlaying(false);bed.volume=.13;};
    voice.onerror=()=>{setPlaying(false);setBlocked(true);};
    const visibility=()=>{if(document.hidden){generation.current++;voice.pause();bed.pause();setPlaying(false);}};
    document.addEventListener('visibilitychange',visibility);
    const stopAutostart=installAudioAutostart(retry);
    return()=>{generation.current++;stopAutostart();voice.onplay=voice.onended=voice.onerror=null;voice.pause();bed.pause();voice.src='';bed.src='';document.removeEventListener('visibilitychange',visibility);};
  },[retry]);
  useEffect(()=>{
    if(!enabled){generation.current++;narration.current?.pause();crowd.current?.pause();setPlaying(false);last.current='';return;}
    retry();
    return()=>{generation.current++;narration.current?.pause();crowd.current?.pause();};
  },[enabled,retry]);
  useEffect(()=>{
    retry();
  },[enabled,round?.id,round?.phase,round?.events.length,key,retry]);
  return {caption:enabled&&playing?spokenCaption:caption,playing,blocked,retry};
}
