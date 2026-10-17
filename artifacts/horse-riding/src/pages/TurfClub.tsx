import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Coins,
  Flag,
  Globe2,
  History,
  Info,
  MapPin,
  Maximize2,
  Minimize2,
  Play,
  Radio,
  Settings2,
  ShieldCheck,
  Sun,
  Trophy,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  CAMERA_MODES,
  RUNNERS,
  VENUES,
  oddsFor,
  progressAt,
  standingsAt,
  venueById,
  type CameraMode,
} from "../racing/engine";
import { useTurf } from "../racing/store";
import { cheer, hoofBeat, unlockAudio } from "../racing/audio";
import CinematicScene from "../racing/CinematicScene";
import { horsePhoto, venuePhoto } from "../racing/cinematicMedia";
import "../racing/turf-club.css";

const RacingScene = lazy(() => import("../racing/RacingScene"));
const coins = (value: number) => new Intl.NumberFormat("en-US").format(value);
const cameraNames: Record<CameraMode, string> = {
  broadcast: "Broadcast",
  rail: "Trackside",
  drone: "Drone",
  chase: "Chase",
  jockey: "Jockey",
  finish: "Finish line",
};
function HorseMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M10 39h29M14 36c-2-10 0-17 9-22l-1-8 7 5 5-1 5 13-5 4-7-6c-6 6-1 12 6 15H14Z"
        fill="currentColor"
      />
      <path
        d="m25 12 3-9 4 9M16 17l-5 9 7 4"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <circle cx="32" cy="16" r="1.4" fill="var(--tc-paper,#f6f5ef)" />
    </svg>
  );
}
function VenueArt({ id }: { id: string }) {
  return (
    <img
      className="tc-venue-art tc-venue-photo"
      src={venuePhoto(id)}
      alt=""
      loading="lazy"
    />
  );
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      className="tc-modal"
      ref={ref}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="tc-modal-heading">
        <h2>{title}</h2>
        <button onClick={close} aria-label="Close dialog">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function MiniMap() {
  const { plan, elapsed, selected } = useTurf();
  const venue = venueById(useTurf((s) => s.venueId));
  return (
    <div className="tc-minimap">
      <span>
        CIRCUIT VIEW{" "}
        <b>
          {venue.laps} {venue.laps > 1 ? "LAPS" : "LAP"}
        </b>
      </span>
      <svg viewBox="0 0 184 84" aria-label="Live race circuit">
        <rect
          x="17"
          y="17"
          width="150"
          height="50"
          rx="25"
          fill="none"
          stroke="#ffffff20"
          strokeWidth="12"
        />
        <rect
          x="17"
          y="17"
          width="150"
          height="50"
          rx="25"
          fill="none"
          stroke="#ffffff50"
          strokeWidth="1"
        />
        <path d="M92 8v19" stroke="#dfc48b" strokeWidth="3" />
        {RUNNERS.map((r) => {
          const progress = plan
            ? progressAt(plan, r.id, elapsed) * venue.laps
            : 0;
          const circumference = 200 + 50 * Math.PI;
          let distance = ((progress % 1) * circumference + 50) % circumference;
          let x = 0,
            y = 0;
          if (distance < 100) {
            x = 42 + distance;
            y = 17;
          } else if ((distance -= 100) < 25 * Math.PI) {
            const a = -Math.PI / 2 + distance / 25;
            x = 142 + Math.cos(a) * 25;
            y = 42 + Math.sin(a) * 25;
          } else if ((distance -= 25 * Math.PI) < 100) {
            x = 142 - distance;
            y = 67;
          } else {
            distance -= 100;
            const a = Math.PI / 2 + distance / 25;
            x = 42 + Math.cos(a) * 25;
            y = 42 + Math.sin(a) * 25;
          }
          return (
            <circle
              key={r.id}
              cx={x}
              cy={y + (r.id - 4) * 0.65}
              r={selected === r.id ? 4 : 2.8}
              fill={r.color}
              stroke={selected === r.id ? "white" : "#122b23"}
              strokeWidth="1"
            />
          );
        })}
      </svg>
    </div>
  );
}
export default function TurfClub() {
  const s = useTurf(),
    venue = venueById(s.venueId),
    runner = RUNNERS[s.selected - 1];
  const [stake, setStake] = useState("100"),
    [modal, setModal] = useState<"rules" | "history" | null>(null);
  const [resultClosed, setResultClosed] = useState(false),
    [fullscreen, setFullscreen] = useState(false);
  const [filmCamera, setFilmCamera] = useState<CameraMode>("broadcast");
  const stageRef = useRef<HTMLDivElement>(null);
  const locked = s.phase !== "betting",
    running = s.phase === "racing" || s.phase === "countdown";
  const amount = Number(stake),
    stakeTotal = s.tickets.reduce((n, t) => n + t.stake, 0);
  const standings = s.plan
    ? standingsAt(s.plan, s.elapsed)
    : (s.result?.order ?? RUNNERS.map((r) => r.id));
  const leaderProgress = s.plan
    ? Math.min(1, progressAt(s.plan, standings[0], s.elapsed))
    : s.phase === "finished"
      ? 1
      : 0;
  useEffect(() => {
    s.tick();
    const timer = window.setInterval(() => useTurf.getState().tick(), 100);
    return () => clearInterval(timer);
  }, [s.tick]);
  useEffect(() => {
    if (s.muted || s.phase !== "racing" || s.visualMode === "cinematic") return;
    const timer = window.setInterval(hoofBeat, 370);
    return () => clearInterval(timer);
  }, [s.muted, s.phase, s.visualMode]);
  useEffect(() => {
    if (s.result) {
      setResultClosed(false);
      if (!useTurf.getState().muted) cheer();
    }
  }, [s.result]);
  useEffect(() => {
    const listener = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", listener);
    return () => document.removeEventListener("fullscreenchange", listener);
  }, []);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (
        modal ||
        (s.result && !resultClosed) ||
        /INPUT|SELECT|TEXTAREA/.test((e.target as HTMLElement)?.tagName)
      )
        return;
      if (e.code === "KeyC")
        s.setCamera(
          CAMERA_MODES[
            (CAMERA_MODES.indexOf(s.camera) + 1) % CAMERA_MODES.length
          ],
        );
      if (e.code === "KeyM") {
        unlockAudio();
        s.toggleSound();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [s.camera, s.setCamera, s.toggleSound, modal, s.result, resultClosed]);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stageRef.current?.requestFullscreen();
    } catch {
      /* Fullscreen is optional in embedded browsers. */
    }
  };
  let liveCamera = s.camera;
  if (s.visualMode === "cinematic") liveCamera = filmCamera;
  else if (s.autoCamera && s.phase === "racing" && s.plan)
    liveCamera =
      s.elapsed > Math.min(...s.plan.times) - 5
        ? "finish"
        : (
            [
              "rail",
              "chase",
              "drone",
              "broadcast",
              "jockey",
              "rail",
            ] as CameraMode[]
          )[Math.floor(Math.max(0, s.elapsed) / 7) % 6];
  return (
    <div
      className="game-page tc-app"
      data-game-screen="horse-racing"
      data-phase={s.phase}
      data-visual-mode={s.visualMode}
    >
      <header className="tc-header">
        <a className="tc-brand" href={`${import.meta.env.BASE_URL}race`}>
          <HorseMark />
          <span>
            TURF<span className="tc-brand-light">CLUB</span>
            <small>THE WORLD IS YOUR RACECOURSE</small>
          </span>
        </a>
        <nav className="tc-nav">
          <span className="active">
            <Flag size={15} /> Race day
          </span>
          <button onClick={() => setModal("history")}>
            <History size={15} /> My races
          </button>
          <a href={`${import.meta.env.BASE_URL}ride`}>
            Free ride <ArrowRight size={14} />
          </a>
        </nav>
        <div className="tc-header-right">
          <span className="tc-practice">PRACTICE</span>
          <div className="tc-wallet">
            <Coins size={18} />
            <span>
              <small>YOUR BALANCE</small>
              <b data-testid="turf-balance">
                {coins(s.balance)} <em>coins</em>
              </b>
            </span>
          </div>
          <button
            className="tc-avatar"
            onClick={() => setModal("rules")}
            aria-label="How to play"
          >
            TC
          </button>
        </div>
      </header>
      <main className="tc-main">
        <div className="tc-page-heading">
          <div>
            <div className="tc-eyebrow">
              <span /> THE WORLD RACING SERIES
            </div>
            <h1>A great day for a great race.</h1>
          </div>
          <button className="tc-help" onClick={() => setModal("rules")}>
            <Info size={15} /> How to play
          </button>
        </div>
        <section className="tc-venues" aria-label="Race locations">
          {VENUES.map((v) => (
            <button
              key={v.id}
              disabled={locked}
              onClick={() => s.setVenue(v.id)}
              className={`tc-venue ${v.id === s.venueId ? "is-selected" : ""}`}
              aria-pressed={v.id === s.venueId}
              data-testid={`venue-${v.id}`}
            >
              <VenueArt id={v.id} />
              <span className="tc-venue-country">{v.country}</span>
              {v.id === s.venueId && (
                <span className="tc-venue-check">
                  <Check size={11} />
                </span>
              )}
              <span className="tc-venue-name">{v.name}</span>
              <span className="tc-venue-meta">
                {v.distance.toLocaleString()}m <i /> {v.surface}
                {v.laps > 1 ? " · 2 laps" : ""}
              </span>
            </button>
          ))}
        </section>
        <div className="tc-race-layout">
          <section className="tc-race-main">
            <div className="tc-meeting">
              <div>
                <span className="tc-meeting-overline">
                  <MapPin size={12} /> {venue.name.toUpperCase()} <i /> RACE{" "}
                  {String(s.history.length + 1).padStart(2, "0")}
                </span>
                <h2>{venue.event}</h2>
              </div>
              <div className="tc-weather">
                <Sun size={20} />
                <span>
                  {venue.temperature}°C<small>{venue.weather}</small>
                </span>
              </div>
            </div>
            <div className="tc-stage-shell" ref={stageRef}>
              <div className="tc-view-switch">
                <div>
                  <button
                    aria-pressed={s.visualMode === "cinematic"}
                    onClick={() => s.setVisualMode("cinematic")}
                  >
                    Cinematic HD
                  </button>
                  <button
                    aria-pressed={s.visualMode === "simulation"}
                    onClick={() => s.setVisualMode("simulation")}
                  >
                    3D simulation
                  </button>
                </div>
                <span>
                  {s.visualMode === "cinematic"
                    ? "Higgsfield original footage"
                    : "Live simulated horse positions"}
                </span>
              </div>
              <div
                className={`tc-stage ${s.visualMode === "cinematic" ? "tc-cinema-stage" : ""}`}
                data-testid="race-stage"
              >
                <Suspense
                  fallback={
                    <div className="tc-scene-loading">Loading racecourse…</div>
                  }
                >
                  {s.visualMode === "cinematic" ? (
                    <CinematicScene onCameraChange={setFilmCamera} />
                  ) : (
                    <RacingScene />
                  )}
                </Suspense>
                <div className="tc-stage-top">
                  <div className={`tc-live-pill ${running ? "is-live" : ""}`}>
                    <span />{" "}
                    {s.phase === "betting"
                      ? s.visualMode === "cinematic"
                        ? "RACE PREVIEW"
                        : "PADDOCK LIVE"
                      : s.phase === "finished"
                        ? "RACE COMPLETE"
                        : "RACE SIMULATION"}
                  </div>
                  <span className="tc-camera-label">
                    <Radio size={12} /> {cameraNames[liveCamera].toUpperCase()}
                  </span>
                </div>
                {s.phase === "betting" && (
                  <div className="tc-stage-caption">
                    <span>THE STAGE IS SET.</span>
                    <h3>
                      Eight thoroughbreds.
                      <br />
                      One finish line.
                    </h3>
                    <p>Pick your favourite. Feel every furlong.</p>
                  </div>
                )}
                {s.phase === "countdown" && (
                  <div className="tc-countdown" role="status">
                    <span>UNDER STARTER'S ORDERS</span>
                    <b>{Math.max(1, Math.ceil(-s.elapsed))}</b>
                    <small>Betting closed · Good luck!</small>
                  </div>
                )}
                {s.phase === "racing" && (
                  <div className="tc-live-positions">
                    <span>SIMULATED RUNNING ORDER</span>
                    {standings.slice(0, 5).map((id, i) => (
                      <button key={id} onClick={() => s.select(id)}>
                        <em>{i + 1}</em>
                        <b style={{ background: RUNNERS[id - 1].color }}>
                          {id}
                        </b>
                        <span>{RUNNERS[id - 1].name}</span>
                        {s.selected === id && (
                          <span className="tc-follow-dot" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
                <MiniMap />
                <div className="tc-stage-bottom">
                  <span>
                    <Flag size={12} /> {venue.distance.toLocaleString()}m <i />{" "}
                    {venue.surface.toUpperCase()} <i />{" "}
                    {s.phase === "racing"
                      ? `LAP ${Math.min(venue.laps, Math.floor(leaderProgress * venue.laps) + 1)} / ${venue.laps}`
                      : "8 RUNNERS"}
                  </span>
                  <span>
                    {s.phase === "racing"
                      ? `${Math.floor(Math.max(0, s.elapsed) / 60)
                          .toString()
                          .padStart(2, "0")}:${Math.floor(
                          Math.max(0, s.elapsed) % 60,
                        )
                          .toString()
                          .padStart(2, "0")}`
                      : "TC SPORTS"}
                  </span>
                </div>
                <div className="tc-race-progress">
                  <span style={{ width: `${leaderProgress * 100}%` }} />
                </div>
              </div>
              <div className="tc-camera-toolbar">
                <div className="tc-camera-choices">
                  <button
                    className={s.autoCamera ? "is-active" : ""}
                    onClick={s.toggleAuto}
                    aria-pressed={s.autoCamera}
                  >
                    <Radio size={13} /> Auto
                  </button>
                  <span className="tc-toolbar-divider" />
                  {CAMERA_MODES.map((mode) => (
                    <button
                      key={mode}
                      className={
                        !s.autoCamera && mode === s.camera ? "is-active" : ""
                      }
                      onClick={() => s.setCamera(mode)}
                      aria-pressed={!s.autoCamera && mode === s.camera}
                    >
                      {cameraNames[mode]}
                    </button>
                  ))}
                </div>
                <div className="tc-stage-actions">
                  <button
                    onClick={() => {
                      unlockAudio();
                      s.toggleSound();
                    }}
                    aria-label={
                      s.muted ? "Enable race sound" : "Mute race sound"
                    }
                    title="Sound (M)"
                  >
                    {s.muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
                  </button>
                  <button
                    onClick={s.toggleQuality}
                    aria-label={`Graphics quality: ${s.quality}`}
                    title={`Graphics: ${s.quality}`}
                  >
                    <Settings2 size={16} />
                  </button>
                  <button
                    onClick={toggleFullscreen}
                    aria-label={
                      fullscreen ? "Exit fullscreen" : "Enter fullscreen"
                    }
                  >
                    {fullscreen ? (
                      <Minimize2 size={17} />
                    ) : (
                      <Maximize2 size={17} />
                    )}
                  </button>
                </div>
              </div>
              {s.visualMode === "cinematic" && (
                <div className="tc-cinema-disclosure">
                  AI-generated race footage. Standings and payouts follow the
                  simulation; use 3D simulation to watch the exact finish.
                </div>
              )}
            </div>
            <div className="tc-runners-heading">
              <div>
                <h2>
                  Meet the field <span>08</span>
                </h2>
                <p>
                  {s.phase === "betting"
                    ? "Select a runner to build your bet slip."
                    : s.visualMode === "cinematic"
                      ? "Select a runner to view their profile and odds."
                      : "Select a runner to follow their race."}
                </p>
              </div>
              <span className="tc-odds-label">
                DECIMAL ODDS <Info size={12} />
              </span>
            </div>
            <div className="tc-runners">
              {RUNNERS.map((r) => {
                const ticket = s.tickets.find((t) => t.horseId === r.id),
                  chosen = s.selected === r.id;
                return (
                  <button
                    key={r.id}
                    onClick={() => s.select(r.id)}
                    className={`tc-runner ${chosen ? "is-selected" : ""}`}
                    aria-pressed={chosen}
                    data-testid={`runner-${r.id}`}
                  >
                    <img
                      className="tc-runner-photo"
                      src={horsePhoto(r.id)}
                      alt={`${r.name} with jockey in racing silks`}
                      loading="lazy"
                    />
                    <div className="tc-runner-top">
                      <span
                        className="tc-silk"
                        style={{ "--silk": r.color } as React.CSSProperties}
                      >
                        <svg viewBox="0 0 36 34" aria-hidden="true">
                          <path
                            d="m11 5-8 8 5 6 4-3v15h13V16l4 3 5-6-8-8-5 3h-5Z"
                            fill="currentColor"
                          />
                          <path
                            d="m13 5 6 8 6-8M19 13v17"
                            stroke="#ffffffb0"
                            strokeWidth="2"
                          />
                        </svg>
                        <b>{r.id}</b>
                      </span>
                      <span className="tc-runner-info">
                        <b>{r.name}</b>
                        <small>{r.jockey}</small>
                      </span>
                      {ticket ? (
                        <span className="tc-ticket-check">
                          <Check size={12} />
                        </span>
                      ) : (
                        <span className="tc-select-ring">
                          {chosen && <span />}
                        </span>
                      )}
                    </div>
                    <div className="tc-runner-bottom">
                      <span>
                        FORM <b>{r.form}</b>
                      </span>
                      <strong>
                        {oddsFor(r.id).toFixed(2)}
                        <small>×</small>
                      </strong>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="tc-field-footer">
              <span>
                <ShieldCheck size={14} /> Virtual racing. Real excitement.
              </span>
              <span>All bets use free practice coins.</span>
            </div>
          </section>
          <aside className="tc-slip">
            <div className="tc-slip-heading">
              <h2>Your bet slip</h2>
              <span>{s.tickets.length.toString().padStart(2, "0")}</span>
            </div>
            <div className="tc-slip-status">
              <span className={locked ? "closed" : ""} />{" "}
              {locked ? "BETTING CLOSED" : "OPEN FOR BETTING"}
              <span>WIN MARKET</span>
            </div>
            <div className="tc-slip-content">
              <img
                className="tc-slip-photo"
                src={horsePhoto(runner.id)}
                alt={runner.name}
              />
              <div className="tc-selected-runner">
                <span
                  className="tc-runner-number"
                  style={{ background: runner.color }}
                >
                  {runner.id}
                </span>
                <div>
                  <small>YOUR SELECTION</small>
                  <h3>{runner.name}</h3>
                  <p>
                    {runner.jockey} <i /> {runner.style}
                  </p>
                </div>
              </div>
              <div className="tc-market">
                <span>To win the race</span>
                <b>
                  {oddsFor(runner.id).toFixed(2)} <small>×</small>
                </b>
              </div>
              <label className="tc-stake-label" htmlFor="turf-stake">
                Your stake <span>PRACTICE COINS</span>
              </label>
              <div className="tc-stake-input">
                <Coins size={17} />
                <input
                  id="turf-stake"
                  type="number"
                  min="10"
                  max="10000"
                  step="1"
                  value={stake}
                  disabled={locked}
                  onChange={(e) => setStake(e.target.value)}
                />
                <span>coins</span>
              </div>
              <div className="tc-chips">
                {[50, 100, 250, 500].map((value) => (
                  <button
                    key={value}
                    disabled={locked}
                    className={Number(stake) === value ? "is-active" : ""}
                    onClick={() => setStake(String(value))}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <div className="tc-return">
                <span>
                  Potential return<small>Includes your stake</small>
                </span>
                <b>
                  {Number.isSafeInteger(amount) && amount > 0 && amount <= 10000
                    ? coins(Math.round(amount * oddsFor(runner.id)))
                    : "—"}
                  <small> coins</small>
                </b>
              </div>
              <button
                className="tc-add-bet"
                disabled={locked}
                onClick={() => s.addTicket(amount)}
                data-testid="place-bet"
              >
                {locked ? (
                  <>
                    <ShieldCheck size={16} /> Bets are locked
                  </>
                ) : (
                  <>
                    Add to bet slip <ArrowRight size={17} />
                  </>
                )}
              </button>
              {s.error && (
                <p className="tc-error" role="alert">
                  {s.error}
                </p>
              )}
              <div className="tc-tickets">
                <div className="tc-tickets-title">
                  <span>YOUR TICKETS</span>
                  <b>{coins(stakeTotal)} coins staked</b>
                </div>
                {s.tickets.length ? (
                  s.tickets.map((ticket) => (
                    <div className="tc-ticket" key={ticket.horseId}>
                      <span
                        style={{
                          background: RUNNERS[ticket.horseId - 1].color,
                        }}
                      >
                        {ticket.horseId}
                      </span>
                      <div>
                        <b>{RUNNERS[ticket.horseId - 1].name}</b>
                        <small>
                          {coins(ticket.stake)} coins × {ticket.odds.toFixed(2)}
                        </small>
                      </div>
                      <button
                        disabled={locked}
                        onClick={() => s.removeTicket(ticket.horseId)}
                        aria-label={`Remove bet on ${RUNNERS[ticket.horseId - 1].name}`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="tc-empty-slip">
                    <Flag size={19} />
                    <p>
                      A favourite? A dark horse?
                      <br />
                      Your race starts with a pick.
                    </p>
                  </div>
                )}
              </div>
              {s.balance < 10 && !s.tickets.length && !locked && (
                <button className="tc-refill" onClick={s.refill}>
                  Get 10,000 free practice coins
                </button>
              )}
              <div className="tc-start-section">
                {s.phase === "finished" ? (
                  <button className="tc-start" onClick={s.next}>
                    Next race <ArrowRight size={17} />
                  </button>
                ) : (
                  <button
                    className="tc-start"
                    disabled={locked}
                    onClick={() => {
                      if (!s.muted) unlockAudio();
                      s.start();
                      if (window.matchMedia("(max-width: 680px)").matches) {
                        stageRef.current?.scrollIntoView({
                          block: "start",
                          behavior: "smooth",
                        });
                      }
                    }}
                    data-testid="start-race"
                  >
                    {running ? (
                      <>
                        <span className="tc-spinner" /> Race in progress
                      </>
                    ) : (
                      <>
                        <Play size={15} fill="currentColor" />{" "}
                        {s.tickets.length ? "Start the race" : "Watch a race"}
                      </>
                    )}
                  </button>
                )}
                <p>
                  {running
                    ? "Follow the action from every angle."
                    : "Your tickets lock when the race starts."}
                </p>
              </div>
            </div>
            <div className="tc-tip">
              <Trophy size={24} />
              <div>
                <b>A different race. Every time.</b>
                <p>
                  Explore six racecourses, from sunlit coastlines to a two-lap
                  marathon.
                </p>
              </div>
            </div>
          </aside>
        </div>
        <footer className="tc-footer">
          <span>
            <HorseMark /> TURF CLUB <i /> WORLD RACING SERIES
          </span>
          <span>
            <Globe2 size={12} /> 6 destinations. Endless possibilities.
          </span>
          <span>Practice coins · No cash value</span>
        </footer>
      </main>
      {modal === "rules" && (
        <Modal title="Welcome to Turf Club" close={() => setModal(null)}>
          <div className="tc-rules">
            <p>
              A race day with eight thoroughbreds, six original venues and
              photorealistic Higgsfield cinematics.
            </p>
            <ol>
              <li>
                <b>Choose a racecourse.</b> Each meeting has its own setting,
                distance and duration. Marathon Stadium has two laps.
              </li>
              <li>
                <b>Pick your runners.</b> Enter a stake of 10–10,000 whole
                coins, then add the bet. You can back more than one horse.
              </li>
              <li>
                <b>Start the race.</b> All tickets lock at the countdown. You
                can also watch without betting.
              </li>
              <li>
                <b>Follow every angle.</b> Auto switches cameras; choose any of
                six views or press C. Cinematic HD plays AI-generated camera
                footage. Choose 3D simulation to follow a selected horse's exact
                position and finish. M toggles sound. The quality button
                switches HD / reduced-resolution footage or 3D detail.
              </li>
              <li>
                <b>First across the line wins.</b> A winning ticket returns
                stake × decimal odds, rounded to whole coins. Other tickets lose
                their stake.
              </li>
            </ol>
            <p>
              10,000 free practice coins to begin. Balance, tickets and active
              races save in this browser. Switching venues before the start
              refunds your tickets. If your balance is below 10 with no tickets,
              a free refill appears.
            </p>
            <p className="tc-rules-note">
              Local, simulated entertainment. No deposits, withdrawals or cash
              value. Ratings weight the random draw; your bets do not change the
              result. Race time is compressed for gameplay. Locations are
              fictional.
            </p>
            <p className="tc-rules-note">
              Cinematic footage is illustrative: it does not depict the exact
              randomly generated order. The live standings, finish times, winner
              portrait and payouts come from the race simulation. The 3D mode
              renders that simulation directly.
            </p>
            <a
              href={`${import.meta.env.BASE_URL}assets/racing/CREDITS.md`}
              target="_blank"
              rel="noreferrer"
            >
              Asset credits <ChevronRight size={12} />
            </a>
          </div>
        </Modal>
      )}
      {modal === "history" && (
        <Modal title="Your recent races" close={() => setModal(null)}>
          <div className="tc-history">
            {!s.history.length ? (
              <div className="tc-empty-history">
                <Trophy size={34} />
                <h3>Your story starts at the gate.</h3>
                <p>Completed races will appear here.</p>
              </div>
            ) : (
              s.history.map((r) => (
                <div key={r.id}>
                  <span
                    className="tc-history-winner"
                    style={{ background: RUNNERS[r.winner - 1].color }}
                  >
                    {r.winner}
                  </span>
                  <span>
                    <b>{RUNNERS[r.winner - 1].name}</b>
                    <small>
                      {venueById(r.venueId).name} ·{" "}
                      {new Date(r.date).toLocaleDateString()}
                    </small>
                  </span>
                  <span className={r.payout > r.stake ? "tc-positive" : ""}>
                    <b>
                      {r.payout - r.stake > 0 ? "+" : ""}
                      {coins(r.payout - r.stake)}
                    </b>
                    <small>net coins</small>
                  </span>
                </div>
              ))
            )}
          </div>
        </Modal>
      )}
      {s.result && !resultClosed && (
        <Modal title="Official race result" close={() => setResultClosed(true)}>
          <div className="tc-result">
            <img
              className="tc-result-photo"
              src={horsePhoto(s.result.winner)}
              alt={RUNNERS[s.result.winner - 1].name}
            />
            <div className="tc-result-trophy">
              <Trophy size={34} />
            </div>
            <span className="tc-eyebrow">
              {venue.name.toUpperCase()} · WINNER
            </span>
            <h2>{RUNNERS[s.result.winner - 1].name}</h2>
            <p>
              {RUNNERS[s.result.winner - 1].jockey} ·{" "}
              {s.result.times[s.result.winner - 1].toFixed(2)}s
            </p>
            <div className="tc-result-podium">
              {s.result.order.slice(0, 3).map((id, i) => (
                <div key={id}>
                  <small>{["1ST", "2ND", "3RD"][i]}</small>
                  <span style={{ background: RUNNERS[id - 1].color }}>
                    {id}
                  </span>
                  <b>{RUNNERS[id - 1].name}</b>
                  <small>{s.result!.times[id - 1].toFixed(2)}s</small>
                </div>
              ))}
            </div>
            <div className="tc-result-payout">
              <span>
                Total return<b>{coins(s.result.payout)} coins</b>
              </span>
              <span>
                Net result
                <b
                  className={
                    s.result.payout >= s.result.stake ? "tc-positive" : ""
                  }
                >
                  {s.result.payout - s.result.stake > 0 ? "+" : ""}
                  {coins(s.result.payout - s.result.stake)} coins
                </b>
              </span>
            </div>
            <details>
              <summary>Full finishing order</summary>
              {s.result.order.map((id, i) => (
                <div className="tc-full-result" key={id}>
                  <span>
                    {i + 1}. {RUNNERS[id - 1].name}
                  </span>
                  <b>{s.result!.times[id - 1].toFixed(2)}s</b>
                </div>
              ))}
            </details>
            <button
              className="tc-start"
              onClick={() => {
                setResultClosed(true);
                s.next();
              }}
            >
              Back to the paddock <ArrowRight size={17} />
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
