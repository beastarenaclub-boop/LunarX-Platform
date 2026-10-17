import { useEffect, useRef, useState } from "react";
import type { Sport } from "../../../../../lib/virtual-sports/catalog.mjs";
import type { Round } from "../../../../../lib/virtual-sports/store.mjs";

export type SportsSceneProps = {
  sport: Sport;
  round?: Round;
  time: number;
  camera: string;
  quality: string;
  followPlayer?: number;
  zoom?: number;
  orbit?: number;
  onPlayerSelected?: (index:number)=>void;
};

export default function UnitySportsScene(props: SportsSceneProps) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const sendNow = useRef<()=>void>(()=>{});
  const latest = useRef({ ...props, sampledAt: performance.now() });
  latest.current = { ...props, sampledAt: performance.now() };
  const [readySport, setReadySport] = useState("");
  const [error, setError] = useState(false);
  const [counts, setCounts] = useState({ athletes: 0, vehicles: 0 });
  const [presentation, setPresentation] = useState({ stage: '', venue: '', officials: 0 });
  const ready = readySport === props.sport.id;

  useEffect(() => {
    // A single WebAssembly instance is retained when switching sports/cameras.
    // Only revealed presentation data crosses the iframe boundary. Bets and
    // balances stay in the existing authenticated website API.
    const send = () => {
      const { sport, round, time, camera, quality, sampledAt,followPlayer,zoom,orbit } = latest.current;
      const elapsed = round ? Math.max(-20, Math.min(45,
        (time + performance.now() - sampledAt - round.closes) / 1000)) : 0;
      // Open with the entire venue while the teams are still inside the
      // tunnel, then hand back to the low walkout camera at the tunnel mouth.
      const presentationCamera = sport.id === 'football' && round?.phase === 'betting' &&
        elapsed < -17 && ['broadcast', 'cinematic'].includes(camera) ? 'stadium' : camera;
      iframe.current?.contentWindow?.postMessage(
        {
          type: "arena-state",
          state: {
            sport: sport.id,
            camera: presentationCamera,
            quality,
            followPlayer:followPlayer??0,
            zoom:zoom??1,
            orbit:orbit??35,
            colors: sport.colors,
            phase: round?.phase ?? "betting",
            roundId: String(round?.id ?? ""),
            venue: sport.venue,
            elapsed,
            duration: 45,
            events: round?.events ?? [],
            order: round?.order ?? [],
          },
        },
        location.origin,
      );
    };
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== location.origin ||
        event.source !== iframe.current?.contentWindow
      )
        return;
      const message = event.data;
      if (!message || typeof message !== "object") return;
      if (
        message.type === "arena-ready" &&
        message.sport === latest.current.sport.id
      ) {
        setCounts({
          athletes: Number(message.athletes) || 0,
          vehicles: Number(message.vehicles) || 0,
        });
        setReadySport(message.sport);
        setPresentation({ stage: '', venue: '', officials: 0 });
        setError(false);
      }
      if (message.type === "arena-loaded") send();
      if (message.type === 'arena-presentation' && latest.current.sport.id === 'football' &&
          ['walkout','lineup','taking-positions','kickoff','live','goal-replay','full-time'].includes(message.stage)) {
        setPresentation({ stage: message.stage, venue: String(message.venue ?? ''), officials: Number(message.officials) || 0 });
      }
      if(message.type==='arena-player-selected' && Number.isInteger(message.index))latest.current.onPlayerSelected?.(message.index);
      if (message.type === "arena-error") {
        setError(true);
        console.error("Unity sports renderer:", message.message);
      }
    };
    window.addEventListener("message", receive);
    sendNow.current=send;
    const interval = window.setInterval(send, 1000);
    const observer=new IntersectionObserver(entries=>{
      iframe.current?.contentWindow?.postMessage({type:'arena-visibility',visible:entries[0]?.isIntersecting??true},location.origin);
    },{rootMargin:'80px'});
    if(iframe.current)observer.observe(iframe.current);
    send();
    return () => {
      window.removeEventListener("message", receive);
      clearInterval(interval);
      observer.disconnect();
    };
  }, []);
  useEffect(()=>{sendNow.current();},[props.sport,props.round,props.camera,props.quality,props.followPlayer,props.zoom,props.orbit]);

  return (
    <div
      className="vs-scene-host"
      data-testid="sports-scene"
      data-renderer="unity-urp"
      data-ready={ready && !error}
      data-athletes={counts.athletes}
      data-vehicles={counts.vehicles}
      data-presentation={props.sport.id === 'football' ? presentation.stage : undefined}
      data-venue={presentation.venue}
      data-officials={presentation.officials}
    >
      <iframe
        ref={iframe}
        src="/unity-sports/index.html"
        title={`${props.sport.short} live match`}
        tabIndex={-1}
        allow="autoplay; fullscreen"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          border: 0,
        }}
      />
      {ready && !error && props.sport.id === 'football' && props.round?.phase === 'betting' &&
        presentation.stage && ['broadcast', 'cinematic'].includes(props.camera) && (
        <div className="vs-match-presentation" aria-live="polite">
          <span>{presentation.stage === 'walkout' ? 'THE TEAMS ARE COMING OUT' : presentation.stage === 'lineup' ? 'MATCHDAY LINEUP' : presentation.stage === 'kickoff' ? 'READY FOR KICKOFF' : 'TAKING THEIR POSITIONS'}</span>
          <strong><i style={{background: props.sport.colors[0]}} />{props.sport.teams[0]}<em>v</em>{props.sport.teams[1]}<i style={{background: props.sport.colors[1]}} /></strong>
          <small>{props.sport.venue} · 11 v 11</small>
        </div>
      )}
      {ready && !error && props.sport.id === 'football' && props.round?.phase === 'live' && presentation.stage === 'goal-replay' && <div className="vs-goal-replay-label">GOAL REPLAY</div>}
      {error && (
        <div className="vs-scene-loading">
          Stadium could not load. Match scores and betting remain available.
        </div>
      )}
    </div>
  );
}
