import type { Sport } from "../../../../../lib/virtual-sports/catalog.mjs";
import type { Round } from "../../../../../lib/virtual-sports/store.mjs";

export default function CricketBroadcast({ sport, round }: { sport: Sport; round?: Round }) {
  const innings = (round?.events.length ?? 0) >= 6 ? 1 : 0;
  const balls = round?.events.filter(e => e.team === innings) ?? [];
  const runs = round?.score[innings] ?? 0;
  const overs = `${Math.floor(balls.length / 6)}.${balls.length % 6}`;
  const target = (round?.score[0] ?? 0) + 1;
  const last = balls.at(-1);
  return <>
    <div className="vs-cricket-field" aria-label="Cricket field positions">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <ellipse cx="60" cy="60" rx="54" ry="53" fill="#16351ec9" stroke="#e3eac0a6" strokeWidth="1.5" />
        <ellipse cx="60" cy="60" rx="19" ry="31" fill="none" stroke="#ffffff50" />
        <rect x="57" y="47" width="6" height="25" rx="1" fill="#e4d9a6" />
        {[[60,32],[46,39],[33,50],[83,43],[75,79],[28,82],[93,70],[47,95],[27,30],[68,17],[62,79]].map(([x,y],i) => <circle key={i} cx={x} cy={y} r="2.7" fill={sport.colors[1-innings]} stroke="#fff" strokeWidth=".5" />)}
        <circle cx="59" cy="49" r="2.5" fill={sport.colors[innings]} stroke="white" />
        <circle cx="62" cy="71" r="2.5" fill={sport.colors[innings]} stroke="white" />
      </svg>
      <span>FIELD VIEW</span>
    </div>
    <div className="vs-cricket-bug"><span>ARENA</span><strong>CRICKET</strong><small>SUPER OVER</small></div>
    <div className="vs-cricket-scorebar" data-testid="cricket-broadcast">
      <div className="vs-cricket-team" style={{ borderColor: sport.colors[innings] }}>
        <strong>{sport.tags[innings]}</strong><span>v {sport.tags[1-innings]}</span>
      </div>
      <div className="vs-cricket-runs"><strong>{runs}<small>RUNS</small></strong><span><b>{overs}</b> / 1 OV</span></div>
      <div className="vs-cricket-over"><small>THIS OVER</small><div>{Array.from({length:6},(_,i)=><span key={i} className={balls[i]?.points >= 4 ? 'boundary' : balls[i] ? 'played' : ''}>{balls[i]?.points ?? '·'}</span>)}</div></div>
      <div className="vs-cricket-chase"><small>{innings ? `TARGET ${target}` : '1ST INNINGS'}</small><strong>{round?.phase==='result' ? 'INNINGS COMPLETE' : innings ? `${Math.max(0,target-runs)} FROM ${6-balls.length} BALLS` : `${6-balls.length} BALLS REMAINING`}</strong></div>
      <div className="vs-cricket-last"><small>{round?.phase==='betting' ? 'UP NEXT' : 'LAST BALL'}</small><strong>{round?.phase==='betting' ? 'SUPER SIX' : last ? last.points===6 ? 'SIX!' : last.points===4 ? 'FOUR!' : last.points===0 ? 'DOT BALL' : `${last.points} RUN${last.points===1?'':'S'}` : 'READY'}</strong></div>
    </div>
  </>;
}
