import type { CSSProperties } from "react";
import { Radio, Users, Volume2, VolumeX } from "lucide-react";
import { useStore } from "@/game/store";
import { unlockAudio } from "@/game/audio";
import { updateSettings } from "@/game/engine";
import { BET_SEND_BUFFER_MS } from "../table/AutoBet";
import HistoryStrip from "./HistoryStrip";
import { furyMotion } from "./furyMotion";
import FurySky from "./FurySky";
import airfield from "@/assets/fury/desert-airfield-runway.webp";
import sky from "@/assets/fury/open-sky-runway.webp";
import plane from "@/assets/fury/golden-plane-runway.webp";

/** Runway artwork is presentation only. Motion follows the public round clock. */
export default function FuryScene() {
  const phase = useStore(s => s.phase);
  const multiplier = useStore(s => s.multiplier);
  const flyMs = useStore(s => s.flyMs);
  const countdownMs = useStore(s => s.countdownMs);
  const countdownTotalMs = useStore(s => s.countdownTotalMs);
  const roundId = useStore(s => s.roundId);
  const gameDisabled = useStore(s => s.gameDisabled);
  const lang = useStore(s => s.settings.language);
  const sound = useStore(s => s.settings.sound);
  const liveBets = useStore(s => s.liveBets);
  const realLive = useStore(s => s.realLiveBetsActive);
  const players = realLive ? liveBets.filter(b => b.roundId === roundId) : [];
  const hi = lang === "hi";
  const connecting = roundId === "connecting" || roundId === "init";
  const seconds = Math.max(0, countdownMs - BET_SEND_BUFFER_MS) / 1000;
  const remaining = Math.max(0, Math.min(100, (countdownMs - BET_SEND_BUFFER_MS) / Math.max(1, countdownTotalMs - BET_SEND_BUFFER_MS) * 100));
  const parked = phase === "betting" || connecting;
  const motion = furyMotion(parked ? 0 : flyMs);
  const status = connecting ? "Connecting" : gameDisabled && phase === "betting" ? "Betting paused" : phase === "flying" ? (motion.stage === "runway" ? "Taking off" : "In flight") : phase === "crashed" ? "Flight ended" : seconds > 0 ? "Receiving bets" : "Taking off";
  const sceneStyle = {
    "--fury-travel": motion.travel,
    "--fury-plane-x": `${7 + motion.travel * 62}%`,
    "--fury-plane-y": `${85 - motion.climb * 53}%`,
    "--fury-plane-mobile-y": `${85 - motion.climb * 41}%`,
    "--fury-bank": `${motion.pitch}deg`,
    "--fury-ground-x": `${motion.groundX}%`,
    "--fury-ground-y": `${motion.groundY}%`,
    "--fury-ground-opacity": motion.groundOpacity,
    "--fury-shadow": motion.shadow,
    "--fury-dust": motion.dust,
  } as CSSProperties;

  return <div className="fury-scene" data-testid="fury-scene" data-phase={connecting ? "betting" : phase} data-flight-stage={parked ? "parked" : motion.stage} style={sceneStyle}>
    <div className="fury-flight-sky" aria-hidden="true"><img src={sky} alt="" width="1920" height="1080" decoding="async" /></div>
    <div className="fury-airfield" aria-hidden="true"><img src={airfield} alt="" width="1920" height="1080" decoding="async" /></div>
    <FurySky />
    <div className="fury-scene-vignette" aria-hidden="true" />
    <div className="fury-scene-top">
      <div className="fury-scene-brand">
        <div className="fury-wordmark" aria-label="Fury Flight">FURY<span>FLIGHT</span></div>
        <div className="fury-scene-tools">
          <span className="fury-flight-status" role="status"><Radio size={12} />{status}</span>
          <button type="button" className="fury-sound-toggle" data-testid="fury-sound-toggle" aria-label={sound ? "Mute Fury Flight sound" : "Enable Fury Flight sound"} aria-pressed={sound} onClick={() => { void unlockAudio(); updateSettings({ sound: !sound }); }}>
            {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
        </div>
      </div>
      <HistoryStrip />
    </div>
    <div className="fury-aircraft" aria-hidden="true">
      <div className="fury-plane-shadow" />
      <div className="fury-runway-dust"><i /><i /><i /></div>
      <div className="fury-plane-float">
        <div className="fury-exhaust"><i /><i /><i /></div>
        <img className="fury-plane-sprite" src={plane} alt="" width="960" height="382" decoding="async" draggable={false} />
        <span className="fury-propeller" />
      </div>
    </div>
    {phase === "betting" || connecting ? <div className="fury-departure" data-testid="fury-departure">
      <span className="fury-departure-label">{connecting ? (hi ? "कनेक्ट हो रहा है" : "CONNECTING TO FLIGHT") : gameDisabled ? (hi ? "बेटिंग रुकी हुई है" : "BETTING PAUSED") : seconds > 0 ? (hi ? "बेट स्वीकार हो रही हैं" : "RECEIVING BETS") : (hi ? "उड़ान शुरू हो रही है" : "TAKING OFF")}</span>
      {!connecting && !gameDisabled && <>
        <div className="fury-countdown" data-testid="fury-countdown">{seconds.toFixed(1)}<span>s</span></div>
        <div className="fury-countdown-track" role="progressbar" aria-label="Betting time remaining" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(remaining)}><div style={{ width: `${remaining}%` }} /></div>
      </>}
      <div className="fury-departure-stats">
        <div><span>{hi ? "बेट" : "Bets"}</span><b>{players.length}</b></div>
        <div><span>{hi ? "कुल" : "Total stake"}</span><b>₹{players.reduce((sum, bet) => sum + bet.amount, 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</b></div>
      </div>
    </div> : <div className="fury-readout">
      <span className="fury-readout-label" role={phase === "crashed" ? "status" : undefined}>{phase === "crashed" ? (hi ? "उड़ान समाप्त" : "FLEW AWAY!") : (hi ? "वर्तमान मल्टीप्लायर" : "CURRENT MULTIPLIER")}</span>
      <div className="fury-multiplier" data-testid="fury-multiplier">{multiplier.toFixed(2)}<span>×</span></div>
      <p>{phase === "crashed" ? (hi ? "अगली उड़ान का इंतज़ार करें" : "Next flight shortly") : (hi ? "उड़ान समाप्त होने से पहले कैश आउट करें" : "Cash out before the flight ends")}</p>
    </div>}
    <div className="fury-scene-bottom">
      {players.length ? <div className="fury-live-bets" aria-label="This flight's latest bets">
        {players.slice(-8).map(bet => <span className="fury-live-bet" key={bet.id} data-cashed-out={bet.cashedOutAt != null}>
          <span>{bet.name.slice(0, 1)}*{bet.name.slice(-1)}</span>
          <b>₹{bet.amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</b>
          {bet.cashedOutAt != null && <em>{bet.cashedOutAt.toFixed(2)}×</em>}
        </span>)}
      </div> : <span><i />{motion.groundOpacity > .15 ? "DESERT AIRFIELD" : "OPEN SKIES"}</span>}
      <span><Users size={12} />{players.length} bets</span>
    </div>
  </div>;
}
