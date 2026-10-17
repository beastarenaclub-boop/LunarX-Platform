import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Coins,
  Flag,
  Gauge,
  History,
  Maximize2,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trophy,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  SPORTS,
  sportById,
  BET_MS,
  PLAY_MS,
  ROUND_MS,
  type SportId,
} from "../../../../../lib/virtual-sports/catalog.mjs";
import type {
  BetInput,
  SportsState,
} from "../../../../../lib/virtual-sports/store.mjs";
import SportsScene from "./SportsScene";
import CricketBroadcast from "./CricketBroadcast";
import { FIXTURES, sportForFixture } from '../../../../../lib/virtual-sports/fixtures.mjs';
import { useMatchCommentary } from './MatchCommentary';
import { installAudioAutostart } from '../../game/audioAutostart';
import "./virtual-sports.css";

const number = (n: number) => n.toLocaleString("en-IN");
const pendingKey = "arena:pending-bet:v2";
function readPending(accountId?: string): BetInput | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(pendingKey) || "null");
    return accountId && saved?.accountId === accountId ? saved.input : null;
  } catch {
    return null;
  }
}
function useSports() {
  const [state, setState] = useState<SportsState>(),
    [connected, setConnected] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [pending, setPending] = useState<BetInput | null>(null);
  const revision = useRef(0),
    mutating = useRef(false),
    mounted = useRef(true),
    clock = useRef({ server: Date.now(), local: performance.now() }),
    [time, setTime] = useState(Date.now());
  const accept = useCallback((data: SportsState) => {
    if (!mounted.current) return;
    setState(data);
    setConnected(true);
    clock.current = { server: data.serverTime, local: performance.now() };
    setTime(data.serverTime);
    const unresolved = readPending(data.accountId);
    setPending(unresolved);
    if (
      unresolved &&
      data.bets.some((b) => b.requestId === unresolved.requestId)
    ) {
      sessionStorage.removeItem(pendingKey);
      setPending(null);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    let stopped = false,
      polling = false,
      controller: AbortController | undefined;
    const poll = async () => {
      if (stopped || mutating.current || polling) return;
      polling = true;
      const generation = revision.current;
      controller = new AbortController();
      const requestController = controller;
      const timeout = setTimeout(() => requestController.abort(), 6000);
      try {
        const r = await fetch("/api/virtual-sports/state", {
          signal: controller.signal,
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!r.ok) throw Error("unavailable");
        const data = await r.json();
        if (!stopped && generation === revision.current) accept(data);
      } catch {
        if (!stopped && generation === revision.current) setConnected(false);
      } finally {
        clearTimeout(timeout);
        polling = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1500),
      ticker = setInterval(
        () =>
          setTime(
            clock.current.server + performance.now() - clock.current.local,
          ),
        250,
      );
    return () => {
      stopped = true;
      mounted.current = false;
      controller?.abort();
      clearInterval(timer);
      clearInterval(ticker);
    };
  }, [accept]);
  const mutate = async (path: string, input: unknown) => {
    if (mutating.current) return;
    mutating.current = true;
    revision.current++;
    setBusy(true);
    setMessage("");
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 10000);
    try {
      const r = await fetch(`/api/virtual-sports/${path}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Sports-Client": "1", "X-Sports-Wallet": state?.mode === "wallet" ? "1" : "0" },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      const data = await r.json();
      if (!r.ok) {
        if (r.status >= 400 && r.status < 500 && path === "bets") {
          sessionStorage.removeItem(pendingKey);
          setPending(null);
        }
        throw Error(data.error || "Request failed.");
      }
      accept(data);
      setMessage(
        path === "bets"
          ? "Bet accepted. Good luck!"
          : "10,000 practice coins added.",
      );
    } catch (e) {
      if (mounted.current)
        setMessage(
          (e as Error).name === "AbortError"
            ? "Connection interrupted. Retry this same bet to confirm its status."
            : (e as Error).message ||
                "Connection interrupted. Retry to confirm.",
        );
    } finally {
      clearTimeout(timer);
      mutating.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const place = (input: Omit<BetInput, "requestId">) => {
    if (mutating.current) return;
    const request = pending ?? { ...input, requestId: crypto.randomUUID() };
    if (!state?.accountId) return;
    sessionStorage.setItem(pendingKey, JSON.stringify({ accountId: state.accountId, input: request }));
    setPending(request);
    return mutate("bets", request);
  };
  return {
    state,
    connected,
    busy,
    message,
    pending,
    time,
    place,
    refill: () => mutate("refill", {}),
  };
}

function SportIcon({ id, size = 22 }: { id: SportId; size?: number }) {
  if (id === "formula") return <Flag size={size} />;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      {id === "football" ? (
        <>
          <circle cx="16" cy="16" r="12" />
          <path d="m16 10 6 4-2 7h-8l-2-7 6-4Zm0 0V4m6 10 6-2m-8 9 4 5m-12-5-4 5m2-12-6-2" />
        </>
      ) : id === "cricket" ? (
        <>
          <path d="m22 3 4 3-6 8-4-3 6-8Zm-6 8 4 3-9 13-6-4 11-11Z" />
          <circle cx="25" cy="25" r="4" />
          <path d="m23 22 3 6" />
        </>
      ) : id === "basketball" ? (
        <>
          <circle cx="16" cy="16" r="12" />
          <path d="M4 16h24M16 4v24M8 7c9 6 9 12 0 18M24 7c-9 6-9 12 0 18" />
        </>
      ) : (
        <>
          <ellipse
            cx="19"
            cy="12"
            rx="8"
            ry="10"
            transform="rotate(35 19 12)"
          />
          <path d="m14 20-8 10m3-5-4-3m10-12 10 6m-12-2 9 6m-4-16-8 13m13-10-8 13" />
        </>
      )}
    </svg>
  );
}

export default function VirtualSports({
  standalone = false,
  initialSport = "football",
}: {
  standalone?: boolean;
  initialSport?: string;
}) {
  const [selected, setSelected] = useState<SportId>(() => {
    const requested = standalone
      ? new URLSearchParams(location.search).get("sport")
      : initialSport;
    return sportById(requested || "")?.id ?? "football";
  });
  const { state, connected, busy, message, pending, time, place, refill } = useSports();
  const walletMode = state?.mode === "wallet" || !standalone;
  const unit = walletMode ? "INR" : "coins";
  const money = (value: number) => walletMode ? `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : number(value);
  const [matchIds,setMatchIds]=useState<Record<string,string>>(()=>{
    try{return JSON.parse(localStorage.getItem('arena:fixtures:v1')||'null')??{football:'brazil-argentina',cricket:'india-pakistan',basketball:'usa-france',tennis:'classic',formula:'grand-prix'};}catch{return {};}
  });
  const matches=(state?.matches??state?.rounds??[]).filter(r=>r.sport===selected);
  const round=matches.find(r=>r.fixture?.id===matchIds[selected])??state?.rounds.find(r=>r.sport===selected);
  const sport=useMemo(()=>round?.fixture?sportForFixture(round.fixture):sportById(selected)!,[selected,round?.fixture]);
  const selectMatch=(id:string)=>{setMatchIds(old=>{const next={...old,[selected]:id};try{localStorage.setItem('arena:fixtures:v1',JSON.stringify(next));}catch{}return next;});};
  const [choice, setChoice] = useState<number | null>(null),
    [stake, setStake] = useState("100"),
    [tab, setTab] = useState("bets"),
    [camera, setCamera] = useState("broadcast"),
    [quality, setQuality] = useState("auto"),
    [sound, setSound] = useState(() => {
      try { return localStorage.getItem('arena:sound:auto-v1') !== 'off'; } catch { return true; }
    });
  const [followPlayer,setFollowPlayer]=useState(0),[zoom,setZoom]=useState(1),[orbit,setOrbit]=useState(35),[theater,setTheater]=useState(false);
  const commentary=useMatchCommentary(round,sport,sound);
  const playerCount={football:22,cricket:13,basketball:10,tennis:2,formula:4}[selected];
  const battingTeam=(round?.events.length??0)>=6?1:0;
  const playerTeam=(i:number)=>selected==='football'?Math.floor(i/11):selected==='basketball'?Math.floor(i/5):selected==='cricket'?(i<2?battingTeam:1-battingTeam):i;
  const role=(i:number)=>selected==='football'?['Goalkeeper','Right back','Centre back','Centre back','Left back','Midfielder','Midfielder','Midfielder','Right wing','Striker','Left wing'][i%11]:selected==='cricket'?(i<2?'Batter':i===2?'Bowler':i===3?'Wicketkeeper':'Fielder'):selected==='basketball'?['Point guard','Shooting guard','Small forward','Power forward','Centre'][i%5]:selected==='tennis'?'Singles player':'Driver';
  const playerLabel=(i:number)=>`${sport.teams[playerTeam(i)]} · #${selected==='football'?i%11+1:selected==='basketball'?i%5+1:i+1} ${role(i)}`;
  const dialog = useRef<HTMLDialogElement>(null),
    stage = useRef<HTMLDivElement>(null),
    audio = useRef<AudioContext | null>(null),
    lastEvent = useRef("");
  useEffect(() => {
    if (!standalone && sportById(initialSport))
      setSelected(initialSport as SportId);
  }, [initialSport, standalone]);
  useEffect(() => {
    setChoice(null);
    lastEvent.current = "";
    setFollowPlayer(0);setZoom(1);
  }, [selected,round?.fixture?.id]);
  useEffect(()=>setChoice(null),[round?.id]);
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    [],
  );
  const playTone = useCallback((frequency = 660) => {
    if (!audio.current || audio.current.state !== 'running' || document.hidden) return;
    const a = audio.current;
    const gain = a.createGain(),
      o = a.createOscillator();
    o.frequency.setValueAtTime(frequency, a.currentTime);
    o.frequency.exponentialRampToValueAtTime(
      frequency * 0.6,
      a.currentTime + 0.18,
    );
    gain.gain.setValueAtTime(0.05, a.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.25);
    o.connect(gain);
    gain.connect(a.destination);
    o.start();
    o.stop(a.currentTime + 0.26);
    o.onended = () => {
      o.disconnect();
      gain.disconnect();
    };
  }, []);
  useEffect(() => {
    try { localStorage.setItem('arena:sound:auto-v1',sound?'on':'off'); } catch { /* Optional preferences. */ }
    if(!sound)return;
    return installAudioAutostart(() => {
      const Audio=window.AudioContext ?? (window as typeof window & {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
      if(!Audio)return undefined;
      audio.current ??= new Audio();
      return audio.current.state!=='running'?audio.current.resume():undefined;
    });
  },[sound]);
  useEffect(() => {
    const e = round?.events.at(-1),
      key = e ? `${round?.id}:${e.at}` : "";
    if (key && lastEvent.current && lastEvent.current !== key && sound)
      playTone(760);
    lastEvent.current = key;
  }, [round, sound, playTone]);
  const changeSport = (id: SportId) => {
    setSelected(id);
    if (standalone) history.replaceState(null, "", `?sport=${id}`);
  };
  const phase = round?.phase ?? "loading",
    deadline = round
      ? phase === "betting"
        ? round.closes
        : phase === "live"
          ? round.ends
          : round.next
      : time;
  const remaining = Math.max(0, Math.ceil((deadline - time) / 1000)),
    isOpen = connected && phase === "betting" && remaining > 0;
  const amount = Number(stake),
    validAmount =
      /^\d+$/.test(stake) &&
      amount >= 10 &&
      amount <= 5000 &&
      amount <= (state?.account.balance ?? 0);
  const canBet = isOpen && choice !== null && validAmount && !busy && !pending;
  const potential =
    choice === null
      ? 0
      : walletMode ? Math.floor(amount * Math.round((round?.odds[choice] ?? 0) * 100)) / 100
        : Math.floor((amount * Math.round((round?.odds[choice] ?? 0) * 100)) / 100);
  const bets = state?.bets.filter((b) => b.sport === selected) ?? [],
    activeBets = bets.filter((b) => b.status === "pending"),
    results = state?.results.filter((r) => r.sport === selected) ?? [];
  const event = round?.events.at(-1),
    totalStake = activeBets.reduce((a, b) => a + b.stake, 0);
  const matchClock =
    selected === "football"
      ? `${Math.min(90, Math.floor((Math.max(0, time - (round?.closes ?? time)) / PLAY_MS) * 90))}′`
      : selected === "formula"
        ? `LAP ${Math.min(3, 1 + Math.floor((Math.max(0, time - (round?.closes ?? time)) / PLAY_MS) * 3))}/3`
        : selected === "cricket"
          ? `${battingTeam === 0 ? "1st" : "2nd"} innings`
          : selected === "tennis"
            ? "FIRST TO 5"
            : "QUICK MATCH";
  const fullscreen = () => {
    if (!stage.current) return;
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => {});
    else void stage.current.requestFullscreen?.().catch(() => {});
  };
  const toggleSound = () => {
    if(sound&&commentary.blocked){commentary.retry();return;}
    setSound(!sound);
  };
  return (
    <div className={`vs-app vs-broadcast-app ${theater?'vs-theater':''}`} style={{ "--sport": sport.color } as CSSProperties}>
      <aside className="vs-sidebar">
        <a
          className="vs-logo"
          href={standalone ? "?sport=football" : "/"}
          aria-label={standalone ? "Arena home" : "Back to game lobby"}
        >
          <span className="vs-logo-mark">
            A<span />
          </span>
          <span>
            ARENA<small>VIRTUAL SPORTS</small>
          </span>
        </a>
        <div className="vs-sidebar-label">THE CLUBHOUSE</div>
        <div className="vs-nav-active">
          <span>
            <Activity size={18} /> Sports arena
          </span>
          <span className="vs-count">05</span>
        </div>
        <div className="vs-sidebar-label vs-sports-label">EXPLORE SPORTS</div>
        <nav aria-label="Choose a sport">
          {SPORTS.map((s) => (
            <button
              key={s.id}
              className={`vs-nav-sport ${s.id === selected ? "selected" : ""}`}
              aria-pressed={s.id === selected}
              onClick={() => changeSport(s.id)}
            >
              <SportIcon id={s.id} size={19} />
              <span>{s.short}</span>
              {s.id === selected ? (
                <span className="vs-nav-dot" />
              ) : (
                <ChevronRight size={13} />
              )}
            </button>
          ))}
        </nav>
        <button
          className="vs-history-link"
          onClick={() => {
            setTab("history");
            document
              .getElementById("sports-activity")
              ?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
        >
          <History size={17} /> My activity
        </button>
        <div className="vs-side-bottom">
          <div className="vs-practice-icon">
            <ShieldCheck size={22} />
          </div>
          <strong>
            Big moments.
            <br />
            {walletMode ? "One wallet." : "Just for fun."}
          </strong>
          <p>
            {walletMode ? "Your balance. Every game." : "Practice with virtual coins."}
            <br />
            {walletMode ? "Winnings credited automatically." : "No cash value."}
          </p>
          <button onClick={() => dialog.current?.showModal()}>
            How it works <ArrowUpRight size={15} />
          </button>
        </div>
        {!standalone && (
          <a className="vs-back" href="/">
            <ArrowLeft size={15} /> Back to lobby
          </a>
        )}
        <span className="vs-sidebar-footer">
          LUNAR ORIGINALS · VIRTUAL SPORTS
        </span>
      </aside>
      <div className="vs-main">
        <header className="vs-topbar">
          <div className="vs-breadcrumb">
            <a href={standalone?'?sport=football':'/'}>ARENA SPORTS</a> <ChevronRight size={13} />
            <strong>Match centre</strong>
          </div>
          <div className="vs-topbar-actions">
            <span className={`vs-connection ${connected ? "" : "offline"}`}>
              <i />
              {connected ? "Connected" : "Connecting"}
            </span>
            <div className="vs-wallet">
              <span className="vs-wallet-icon">
                <Coins size={19} />
              </span>
              <div>
                <small>{walletMode ? "SHARED WALLET" : "PRACTICE BALANCE"}</small>
                <strong data-testid="sports-balance">
                  {state ? money(state.account.balance) : "—"}{" "}
                  <span>{unit}</span>
                </strong>
              </div>
            </div>
            {walletMode && <a className="vs-open-wallet" href="/wallet">Open Wallet <ArrowUpRight size={14} /></a>}
            <button
              className="vs-help"
              aria-label="Game rules"
              onClick={() => dialog.current?.showModal()}
            >
              <CircleHelp size={20} />
            </button>
          </div>
        </header>
        <main className="vs-content">
          <div className="vs-heading">
            <div>
              <span className="vs-eyebrow">
                <span /> THE NEXT BIG MOMENT IS YOURS
              </span>
              <h1>Match day<span>.</span></h1>
              <p>Choose your match. Follow every player. Back your side.</p>
            </div>
            <span className="vs-originals">
              <Sparkles size={16} /> Virtual matches · Hindi commentary
            </span>
          </div>
          <div
            className="vs-sport-tabs"
            role="tablist"
            aria-label="Virtual sports"
          >
            {SPORTS.map((s, i) => (
              <button
                key={s.id}
                id={`sport-tab-${s.id}`}
                role="tab"
                aria-selected={selected === s.id}
                aria-controls="sports-panel"
                className={selected === s.id ? "active" : ""}
                onClick={() => changeSport(s.id)}
                style={{ "--tab-color": s.color } as CSSProperties}
              >
                <span className="vs-tab-art">
                  <SportIcon id={s.id} size={31} />
                  <span className="vs-tab-orbit" />
                </span>
                <span>
                  <strong>{s.short}</strong>
                  <small>
                    {i === 4
                      ? "3-lap sprint"
                      : i === 1
                        ? "Super over"
                        : i === 3
                          ? "First to 5"
                          : "Quick match"}
                  </small>
                </span>
                <span className="vs-tab-index">0{i + 1}</span>
              </button>
            ))}
          </div>
          <div
            id="sports-panel"
            role="tabpanel"
            aria-labelledby={`sport-tab-${selected}`}
            className="vs-play-grid"
          >
            <section className="vs-match-column">
              <div className="vs-fixture-bar">
                <div className="vs-fixture-teams">
                  <span className="vs-team-crest" style={{background:sport.colors[0]}}>{sport.tags[0]}</span>
                  <div><small>{round?.fixture?.competition??'Arena originals'}</small><strong>{selected==='formula'?'Grand Prix · Four drivers':`${sport.teams[0]} vs ${sport.teams[1]}`}</strong><span>{sport.venue} · {selected==='football'?'11 v 11':selected==='cricket'?'Super over':selected==='basketball'?'5 v 5':selected==='tennis'?'Singles':'3 laps'}</span></div>
                  <span className="vs-team-crest away" style={{background:sport.colors[1]}}>{sport.tags[1]}</span>
                </div>
                <label className="vs-fixture-select">Choose teams / match<select aria-label="Choose match" value={round?.fixture?.id??'classic'} onChange={e=>selectMatch(e.target.value)}>{matches.map(r=><option key={r.id} value={r.fixture?.id??'classic'}>{r.fixture?.teams.join(' vs ')??sport.teams.join(' vs ')}</option>)}</select></label>
              </div>
              <div className="vs-match-header">
                <div>
                  <span className="vs-section-kicker">
                    VIRTUAL {sport.short.toUpperCase()}
                  </span>
                  <h2>
                    {sport.name} <span>3D</span>
                  </h2>
                </div>
                <span className="vs-match-id">
                  MATCH #
                  {round
                    ? String(Math.floor(round.starts / ROUND_MS)).slice(-6)
                    : "—"}
                </span>
              </div>
              <div className="vs-stage" data-sport={selected} ref={stage}>
                <SportsScene
                  sport={sport}
                  round={round}
                  time={time}
                  camera={camera}
                  quality={quality}
                  followPlayer={followPlayer}
                  zoom={zoom}
                  orbit={orbit}
                  onPlayerSelected={i=>{setFollowPlayer(i);setCamera('player');}}
                />
                {selected === "cricket" && <CricketBroadcast sport={sport} round={round} />}
                <div className="vs-stage-top">
                  <span
                    className={`vs-live-badge ${phase === "live" ? "live" : ""}`}
                  >
                    <i />
                    {phase === "live"
                      ? "LIVE SIMULATION"
                      : phase === "result"
                        ? "FULL TIME"
                        : "PRE-MATCH"}
                  </span>
                  <span className="vs-venue">
                    {sport.venue} <span>•</span>{" "}
                    {sport.id === "football"
                      ? "STADIUM LIVE"
                      : sport.id === "basketball"
                        ? "INDOOR ARENA"
                        : "DAY SESSION"}
                  </span>
                </div>
                <div className="vs-scoreboard">
                  {selected === "formula" ? (
                    <>
                      <span className="vs-team">
                        <i
                          style={{
                            background: sport.colors[round?.order[0] ?? 0],
                          }}
                        />
                        {sport.tags[round?.order[0] ?? 0]}
                      </span>
                      <span className="vs-score">P1</span>
                      <span className="vs-match-clock">{matchClock}</span>
                    </>
                  ) : (
                    <>
                      <span className="vs-team">
                        <i style={{ background: sport.colors[0] }} />
                        {sport.tags[0]}
                      </span>
                      <span className="vs-score" data-testid="sports-score">
                        {round?.score[0] ?? 0}
                        <em>:</em>
                        {round?.score[1] ?? 0}
                      </span>
                      <span className="vs-team">
                        {sport.tags[1]}
                        <i style={{ background: sport.colors[1] }} />
                      </span>
                      <span className="vs-match-clock">
                        {phase === "betting" ? "UP NEXT" : matchClock}
                      </span>
                    </>
                  )}
                </div>
                {phase === "result" && round && (
                  <div className="vs-result-card" data-testid="sports-result">
                    <Trophy size={23} />
                    <small>MATCH RESULT</small>
                    <strong>{sport.selections[round.winner!]}</strong>
                    <b className="vs-final-score">{selected==='formula'?'P1':round.score.join(' — ')}</b>
                    <span>
                      {selected === "formula"
                        ? "Race winner"
                        : selected === "tennis"
                          ? "Match winner"
                          : round.winner === 1
                            ? "Match drawn"
                            : "Full-time winner"}
                    </span>
                    {bets.some(b=>b.roundId===round.id)&&<span>Your return: {money(bets.filter(b=>b.roundId===round.id).reduce((n,b)=>n+b.payout,0))} {unit}</span>}
                  </div>
                )}
                {camera==='player'&&<div className="vs-player-caption"><span>PLAYER CAM</span><strong>{playerLabel(followPlayer)}</strong></div>}
                <div className="vs-stage-bottom">
                  <div className="vs-commentary">
                    <span className="vs-commentary-icon">
                      <Radio size={15} />
                    </span>
                    <div>
                      <small>
                        {phase === "betting"
                          ? "TAKE YOUR POSITION"
                          : phase === "result"
                            ? "THE FINAL WHISTLE"
                            : "MATCH FEED"}
                      </small>
                      <strong>
                        {commentary.caption}
                      </strong>
                    </div>
                  </div>
                  <div className="vs-scene-tools">
                    <button
                      title={sound ? "Mute sound" : "Enable sound"}
                      aria-label={sound ? "Mute sound" : "Enable sound"}
                      onClick={toggleSound}
                    >
                      {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
                    </button>
                    <button
                      title="Fullscreen"
                      aria-label="Fullscreen match"
                      onClick={fullscreen}
                    >
                      <Maximize2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
              <div className="vs-stage-toolbar">
                <span>
                  <span className="vs-3d-dot" /> REAL-TIME 3D
                </span>
                <div>
                  <label>
                    Camera{" "}
                    <select
                      aria-label="Camera view"
                      value={camera}
                      onChange={(e) => setCamera(e.target.value)}
                    >
                      <option value="broadcast">Broadcast</option>
                      <option value="cinematic">Cinematic</option>
                      <option value="overhead">Overhead</option>
                      <option value="player">Player close-up</option>
                      <option value="sideline">Touchline</option>
                      <option value="stadium">Stadium tour</option>
                    </select>
                  </label>
                  <label>
                    <Gauge size={14} />
                    <select
                      aria-label="Graphics quality"
                      value={quality}
                      onChange={(e) => setQuality(e.target.value)}
                    >
                      <option value="auto">Auto · smooth graphics</option>
                      <option value="high">High graphics</option>
                      <option value="balanced">Balanced</option>
                    </select>
                  </label>
                  <button className="vs-theater-button" onClick={()=>setTheater(!theater)}>{theater?'Exit theatre':'Theatre view'}</button>
                </div>
              </div>
              <div className="vs-broadcast-controls">
                <button className={`vs-hindi-toggle ${sound?'active':''}`} onClick={toggleSound} aria-label={sound?'Mute Hindi commentary':'Enable Hindi commentary'}>{sound?<Volume2 size={18}/>:<VolumeX size={18}/>} Hindi commentary <b>{sound?'ON':'OFF'}</b></button>
                <label>Player camera<select aria-label="Player to follow" value={followPlayer} onChange={e=>{setFollowPlayer(Number(e.target.value));setCamera('player');}}>{Array.from({length:playerCount},(_,i)=><option key={i} value={i}>{playerLabel(i)}</option>)}</select></label>
                <label>Zoom<input aria-label="Camera zoom" type="range" min="0.75" max="1.6" step="0.05" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label>
                <label>Angle<input aria-label="Camera angle" type="range" min="0" max="360" step="5" value={orbit} onChange={e=>{setOrbit(Number(e.target.value));if(camera!=='stadium')setCamera('player');}}/></label>
              </div>
              {commentary.blocked&&sound&&<p className="vs-audio-note">Commentary could not play. Tap the speaker to try again.</p>}
              <details className="vs-squad" open={camera==='player'}><summary>Virtual squad · {playerCount} {selected==='formula'?'drivers':'players'} <span>Choose any player for a close-up</span></summary><div>{Array.from({length:playerCount},(_,i)=><button key={i} onClick={()=>{setFollowPlayer(i);setCamera('player');}} aria-label={`Follow ${playerLabel(i)}`} aria-pressed={camera==='player'&&followPlayer===i} style={{'--kit':sport.colors[playerTeam(i)]} as CSSProperties}><span>{selected==='football'?i%11+1:selected==='basketball'?i%5+1:i+1}</span><strong>{sport.tags[playerTeam(i)]}</strong><small>{role(i)}</small></button>)}</div></details>
              <div className="vs-betting-dock" data-testid="sports-betting-dock">
              <div className="vs-market-card">
                <div className="vs-market-title">
                  <div>
                    <h3>
                      {selected === "formula"
                        ? "Back the race winner"
                        : "Who takes the win?"}
                    </h3>
                    <span>{sport.format}</span>
                  </div>
                  <span
                    className={`vs-countdown ${phase === "live" ? "locked" : ""}`}
                    data-testid="sports-phase"
                  >
                    <i />
                    {phase === "betting"
                      ? `Bets close in ${remaining}s`
                      : phase === "live"
                        ? `Match live · ${remaining}s`
                        : `Next match in ${remaining}s`}
                  </span>
                </div>
                <div
                  className={`vs-odds-grid ${selected === "formula" ? "four" : ""}`}
                >
                  {sport.selections.map((name, i) => (
                    <button
                      key={name}
                      className={choice === i ? "chosen" : ""}
                      disabled={!isOpen || busy || !!pending}
                      onClick={() => {
                        setChoice(i);
                        if (sound) playTone(520);
                      }}
                      aria-label={`Select ${name}`}
                      aria-pressed={choice === i}
                    >
                      <span className="vs-selection-label">
                        <span className="vs-selection-symbol">
                          {selected === "formula"
                            ? `0${i + 1}`
                            : sport.selections.length === 3
                              ? ["1", "X", "2"][i]
                              : i + 1}
                        </span>
                        <strong>{name}</strong>
                      </span>
                      <span className="vs-odd-value">
                        {round?.odds[i]?.toFixed(2) ?? "—"}
                        {choice === i ? (
                          <Check size={14} />
                        ) : (
                          <ArrowUpRight size={13} />
                        )}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="vs-market-foot">
                  <ShieldCheck size={13} />
                  <span>Fixed odds · Returns include your stake</span>
                  <span>{walletMode ? "₹10–₹5,000" : "10–5,000 coins"}</span>
                </div>
              </div>
            <aside className="vs-betslip" aria-label={walletMode ? "Place a wallet bet" : "Place a virtual coin bet"}>
              <div className="vs-betslip-title">
                <span>
                  <TicketIcon /> Bet slip
                </span>
                <span className="vs-count">{choice === null ? "0" : "1"}</span>
              </div>
              <div className="vs-betslip-body">
                <span className="vs-slip-kicker">SINGLE BET</span>
                {choice !== null ? (
                  <div className="vs-picked">
                    <div>
                      <SportIcon id={selected} size={17} />
                      <small>{sport.name}</small>
                      <button
                        aria-label="Remove selection"
                        disabled={busy || !!pending}
                        onClick={() => setChoice(null)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <strong>{sport.selections[choice]}</strong>
                    <span>
                      Match winner <b>{round?.odds[choice]?.toFixed(2)}</b>
                    </span>
                  </div>
                ) : (
                  <div className="vs-slip-empty">
                    <span>
                      <SportIcon id={selected} size={29} />
                    </span>
                    <strong>Make your pick</strong>
                    <p>Select an outcome below the match to get started.</p>
                  </div>
                )}
                <div className="vs-stake-label">
                  <label htmlFor="sports-stake">Stake amount</label>
                  <span>{walletMode ? "INR · ₹" : "COINS"}</span>
                </div>
                <div className="vs-stake-input">
                  <Coins size={18} />
                  <input
                    id="sports-stake"
                    aria-label="Stake amount"
                    type="text"
                    inputMode="numeric"
                    value={stake}
                    disabled={busy || !!pending}
                    onChange={(e) => setStake(e.target.value)}
                    autoComplete="off"
                  />
                  <span>◈</span>
                </div>
                <div className="vs-chips">
                  {[50, 100, 500, 1000].map((n) => (
                    <button
                      key={n}
                      className={amount === n ? "active" : ""}
                      disabled={busy || !!pending}
                      onClick={() => setStake(String(n))}
                    >
                      {number(n)}
                    </button>
                  ))}
                </div>
                {!validAmount && state && (
                  <p className="vs-input-error">
                    {amount > state.account.balance
                      ? "Your balance is too low."
                      : walletMode ? "Enter ₹10–₹5,000 in whole rupees." : "Enter 10–5,000 whole coins."}
                  </p>
                )}
                <div className="vs-return">
                  <span>
                    Potential return<small>Including your stake</small>
                  </span>
                  <strong>
                    {validAmount ? money(potential) : "—"}
                    <small>{unit}</small>
                  </strong>
                </div>
                <button
                  className="vs-place"
                  data-testid="sports-place"
                  disabled={pending ? busy || !connected : !canBet}
                  onClick={() =>
                    void place({
                      sport: selected,
                      roundId: round!.id,
                      choice: choice ?? 0,
                      stake: amount,
                    })
                  }
                >
                  {busy ? (
                    <>
                      <RefreshCw size={17} className="vs-spin" /> Confirming…
                    </>
                  ) : pending ? (
                    "Retry pending bet"
                  ) : !connected ? (
                    "Connecting…"
                  ) : !isOpen ? (
                    "Betting closed"
                  ) : choice === null ? (
                    "Select an outcome"
                  ) : (
                    <>
                      Place bet <ArrowUpRight size={18} />
                    </>
                  )}
                </button>
                <div className="vs-feedback" role="status" aria-live="polite">
                  {message || (walletMode ? "Your shared wallet is debited when the bet is accepted." : "Coins are deducted when your bet is accepted.")}
                </div>
                {pending && (
                  <p className="vs-pending-note">
                    Pending confirmation:{" "}
                    {sportForFixture(FIXTURES.find(f=>f.sport===pending.sport&&pending.roundId.startsWith(`${f.sport}-${f.id}-`))??FIXTURES.find(f=>f.sport===pending.sport&&f.id==='classic')!).selections[pending.choice]},{" "}
                    {money(pending.stake)} {unit}. Retry confirms this same
                    request.
                  </p>
                )}
              </div>
              <div className="vs-slip-footer">
                <ShieldCheck size={16} />
                <span>
                  Server-settled results
                  <br />
                  <strong>{walletMode ? "Connected to your shared wallet" : "Practice coins only"}</strong>
                </span>
              </div>
              <div className="vs-session-card">
                <span className="vs-eyebrow">YOUR MATCH</span>
                <div>
                  <span>{walletMode ? "Amount in play" : "Coins in play"}</span>
                  <strong>{money(totalStake)}</strong>
                </div>
                <div>
                  <span>Open bets</span>
                  <strong>{activeBets.length}</strong>
                </div>
                <div>
                  <span>Next round</span>
                  <strong>
                    {round
                      ? `${Math.max(0, Math.ceil((round.next - time) / 1000))}s`
                      : "—"}
                  </strong>
                </div>
              </div>
              <div className="vs-tip">
                <span>THE ARENA PLAYBOOK</span>
                <p>
                  Pick a winner before the countdown ends. Watch the action.
                  Winning returns land automatically.
                </p>
                <button onClick={() => dialog.current?.showModal()}>
                  Learn the rules <ChevronRight size={14} />
                </button>
              </div>
              {walletMode && <a className="vs-refill vs-wallet-deposit" href="/wallet"><Coins size={16} /> Add funds / Wallet history <ArrowUpRight size={15} /></a>}
              {!walletMode && state && state.account.balance < 1000 && (
                <button
                  className="vs-refill"
                  disabled={
                    busy ||
                    state.bets.some((b) => b.status === "pending") ||
                    time - state.account.refillAt < 60000
                  }
                  onClick={() => void refill()}
                >
                  <Coins size={16} /> Refill 10,000 practice coins
                </button>
              )}
            </aside>
              </div>
              <section className="vs-activity" id="sports-activity">
                <div className="vs-activity-tabs">
                  <button
                    className={tab === "bets" ? "active" : ""}
                    onClick={() => setTab("bets")}
                  >
                    My bets <span>{activeBets.length}</span>
                  </button>
                  <button
                    className={tab === "history" ? "active" : ""}
                    onClick={() => setTab("history")}
                  >
                    Bet history
                  </button>
                  <button
                    className={tab === "results" ? "active" : ""}
                    onClick={() => setTab("results")}
                  >
                    Match results
                  </button>
                  <span>LAST 50 BETS</span>
                </div>
                <div className="vs-activity-body">
                  {tab === "results" ? (
                    results.length ? (
                      results.slice(0, 5).map((r) => (
                        <div className="vs-bet-row" key={r.id}>
                          <span className="vs-receipt-icon">
                            <Trophy size={16} />
                          </span>
                          <div>
                            <strong>{(r.fixture?sportForFixture(r.fixture):sport).selections[r.winner]}</strong>
                            <small>
                              {r.fixture?.teams.join(' vs ')} · Match #
                              {String(
                                Math.floor(
                                  Number(r.id.split("-").at(-1)) / ROUND_MS,
                                ),
                              ).slice(-6)}
                            </small>
                          </div>
                          <span>
                            {selected === "formula"
                              ? "P1"
                              : r.score.join(" : ")}
                          </span>
                          <span className="vs-status won">FINAL</span>
                        </div>
                      ))
                    ) : (
                      <Empty text="Results will appear after the first match." />
                    )
                  ) : (tab === "bets"
                      ? activeBets
                      : bets.filter((b) => b.status !== "pending")
                    ).length ? (
                    (tab === "bets"
                      ? activeBets
                      : bets.filter((b) => b.status !== "pending")
                    ).map((b) => (
                      <div
                        className="vs-bet-row"
                        key={b.id}
                        data-testid="sports-bet"
                      >
                        <span className="vs-receipt-icon">
                          {b.status === "won" ? (
                            <ArrowDownLeft size={17} />
                          ) : (
                            <SportIcon id={selected} size={17} />
                          )}
                        </span>
                        <div>
                          <strong>{b.selectionName??sport.selections[b.choice]}</strong>
                          <small>
                            {money(b.stake)} {unit} @ {b.odds.toFixed(2)}
                          </small>
                        </div>
                        <span
                          className={b.status === "won" ? "vs-positive" : ""}
                        >
                          {b.status === "pending"
                            ? `${money(walletMode ? b.stake * Math.round(b.odds * 100) / 100 : Math.floor((b.stake * Math.round(b.odds * 100)) / 100))} potential`
                            : `${b.payout > 0 ? "+" : ""}${money(b.payout)} ${unit}`}
                        </span>
                        <span className={`vs-status ${b.status}`}>
                          {b.status}
                        </span>
                      </div>
                    ))
                  ) : (
                    <Empty
                      text={
                        tab === "bets"
                          ? "Your next big moment starts with a selection."
                          : "Your settled bets will appear here."
                      }
                    />
                  )}
                </div>
              </section>
            </section>

          </div>
          <footer className="vs-footer">
            <span>
              <span className="vs-3d-dot" /> ALWAYS ANOTHER MATCH
            </span>
            <span>
              {walletMode ? "Computer-generated sports · Shared wallet · Server-settled returns" : "Computer-generated sports · Virtual coins have no cash value"}
            </span>
            <button onClick={() => dialog.current?.showModal()}>
              Rules & information <ArrowUpRight size={12} />
            </button>
          </footer>
        </main>
      </div>
      <dialog
        ref={dialog}
        className="vs-rules"
        aria-labelledby="sports-rules-title"
      >
        <div>
          <span className="vs-eyebrow">THE ARENA PLAYBOOK</span>
          <button
            aria-label="Close rules"
            onClick={() => dialog.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <h2 id="sports-rules-title">
          A little knowledge.
          <br />A lot of action.
        </h2>
        <p>
          Every {ROUND_MS / 1000}-second round has {BET_MS / 1000} seconds to
          bet, a {PLAY_MS / 1000}-second animated match, and 10 seconds for
          results. These are computer-generated highlights, not live real-world
          sporting events.
        </p>
        <ol>
          <li>
            Select a sport and an outcome. Football, cricket and basketball
            include a draw/tie. Tennis is first to five points; Formula is a
            three-lap race.
          </li>
          <li>
            Stake {walletMode ? "₹10–₹5,000 in whole rupees" : "10–5,000 whole virtual coins"} before betting closes. Odds lock
            when the server accepts your bet.
          </li>
          <li>
            Winning return = stake × accepted decimal odds, rounded down to a
            {walletMode ? "paise" : "whole coin"}. Returns include the original stake. Losing bets return
            zero.
          </li>
          <li>
            {walletMode ? "All five sports use the same wallet as your other games. Stakes are deducted on acceptance and winning returns are credited automatically, even after you leave the page. Open Wallet to add funds and view transactions." : <>Start with 10,000 practice coins shared across these five sports.
            Below 1,000, refill after all bets settle, at most once per minute.
            These coins are separate from your main wallet, cannot be withdrawn
            and have no cash value.</>}
          </li>
          <li>
            All players watch the same scheduled rounds. The server creates
            results independently of stakes and settles once. Reconnect or
            reload to recover your bets; retry an interrupted request to avoid
            placing a second bet.
          </li>
        </ol>
        <p className="vs-rules-note">
          This is a computer-generated sports experience. 3D performance depends
          on your device. Use Balanced graphics for a lighter scene.
        </p>
        <button className="vs-place" onClick={() => dialog.current?.close()}>
          Got it. Let’s play <ArrowUpRight size={17} />
        </button>
      </dialog>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="vs-empty">
      <History size={21} />
      <span>{text}</span>
    </div>
  );
}
function TicketIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M4 3h16v6a3 3 0 0 0 0 6v6H4v-6a3 3 0 0 0 0-6V3Z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </svg>
  );
}
