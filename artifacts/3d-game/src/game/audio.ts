import { AUDIO_UNLOCK_GRACE_MS, GameSoundBank, CRASH_AUDIO_GAMES, isGameAudioId, type GameAudioId, type GameSoundCue } from "./gameSoundDesign";
import { SevenSoundBank, type SevenSound } from "./sevenSoundDesign";
import { furyEngineRate } from "./furySounds";

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
// Dedicated bus for UI navigation sounds (hover/select ticks, dialog swooshes).
// Routed straight to master — parallel to sfxGain — so it has its own volume
// independent of the in-game SFX slider.
let uiGain: GainNode | null = null;
let musicGain: GainNode | null = null;
// Dedicated bus for the croupier voice announcements.
let voiceGain: GainNode | null = null;
let rouletteSfxGain: GainNode | null = null;
let rouletteVoiceGain: GainNode | null = null;
let musicSource: AudioBufferSourceNode | null = null;
let musicPlaying = false;
let activeAudioGame: GameAudioId | null = null;
let gameSounds: GameSoundBank | null = null;
let audioGeneration = 0;
let soundRequest = 0;
let stopDiceShake = () => {};
let sevenSounds: SevenSoundBank | null = null;
let sevenGeneration = 0;

/** Route changes invalidate sounds from the previous game, including pending clips. */
export function setAudioGame(game: GameAudioId | null) {
  if (activeAudioGame === game) return;
  audioGeneration++;
  stopSevenTableAudio();
  stopMusic();
  stopEngineHum();
  stopRouletteAudio();
  gameSounds?.stop();
  activeAudioGame = game;
  if (game === "baccarat") void preloadTableAudio();
  if (game === "7up7down") void preloadSevenAudio();
  else if (game) void preloadGameAudio(game);
}

export function preloadGameAudio(game: GameAudioId): Promise<void> {
  const c = tryEnsure();
  if (!c) return Promise.resolve();
  gameSounds ??= new GameSoundBank(c);
  return gameSounds.preload(game);
}

export function playGameSound(cue: GameSoundCue, game: string | null = activeAudioGame, volume = 1) {
  if (!game || !isGameAudioId(game) || game !== activeAudioGame || !tabVisible || soundOff) return;
  const c = tryEnsure();
  if (!c) return;
  const request = ++soundRequest;
  if (c.state !== "running") {
    const generation = audioGeneration, requestedAt = Date.now();
    void unlockAudio().then(() => {
      // Keep the latest cue while the device wakes up, without replaying a
      // backlog of clicks or sounds from a previous route/mute state.
      if (c.state === "running" && request === soundRequest && generation === audioGeneration && Date.now() - requestedAt < AUDIO_UNLOCK_GRACE_MS) playGameSound(cue, game, volume);
    });
    return;
  }
  gameSounds ??= new GameSoundBank(c);
  if (!gameSounds.ready(game, cue)) {
    const generation = audioGeneration, requestedAt = Date.now();
    const grace = ["select", "bet", "clear"].includes(cue) ? AUDIO_UNLOCK_GRACE_MS : 350;
    void gameSounds.prepare(game, cue).then(ready => {
      if (ready && generation === audioGeneration && request === soundRequest && Date.now() - requestedAt < grace) playGameSound(cue, game, volume);
    });
    return;
  }
  gameSounds.play(game, cue, sfxGain!, volume);
}

/** Continuous dice rattle, owned by the visible rolling phase. */
export function startDiceShake(): () => void {
  stopDiceShake();
  let cancelled = false;
  let source: AudioBufferSourceNode | null = null;
  const stop = () => {
    cancelled = true;
    try { source?.stop(); } catch { /* Already stopped by a route or mute change. */ }
    source = null;
  };
  stopDiceShake = stop;
  if ((activeAudioGame !== "dice" && activeAudioGame !== "7up7down") || !tabVisible || soundOff) return stop;
  const c = tryEnsure(), generation = audioGeneration;
  if (!c) return stop;
  void unlockAudio().then(() => {
    if (cancelled || generation !== audioGeneration || (activeAudioGame !== "dice" && activeAudioGame !== "7up7down") || !tabVisible || soundOff || c.state !== "running") return;
    sevenSounds ??= new SevenSoundBank(c);
    source = sevenSounds.play("shake", sfxGain!, .78, true);
  });
  return stop;
}

export function preloadSevenAudio() {
  const c = tryEnsure();
  if (!c) return Promise.resolve();
  sevenSounds ??= new SevenSoundBank(c);
  return sevenSounds.preload();
}

export function stopSevenTableAudio() {
  sevenGeneration++;
  stopDiceShake();
  sevenSounds?.stop();
}

export function playSevenSound(cue: SevenSound, volume = 1) {
  if ((activeAudioGame !== "dice" && activeAudioGame !== "7up7down") || !tabVisible || soundOff) return;
  const c = tryEnsure();
  if (!c) return;
  const generation = sevenGeneration, request = ++soundRequest, requestedAt = Date.now();
  const grace = ["select", "chip", "stack", "undo", "clear", "confirm", "open", "close", "error"].includes(cue) ? AUDIO_UNLOCK_GRACE_MS : 350;
  const perform = () => {
    if (generation !== sevenGeneration || (activeAudioGame !== "dice" && activeAudioGame !== "7up7down") || !tabVisible || soundOff || c.state !== "running" || Date.now() - requestedAt > grace) return;
    sevenSounds ??= new SevenSoundBank(c);
    if (!sevenSounds.ready(cue)) {
      void sevenSounds.prepare(cue).then(ready => { if (ready && request === soundRequest) perform(); });
      return;
    }
    sevenSounds.play(cue, sfxGain!, volume);
  };
  if (c.state === "running") perform();
  else void unlockAudio().then(() => { if (request === soundRequest) perform(); });
}

function flightSound(cue: "launch" | "crash" | "win", game: string | null = activeAudioGame) {
  if (game && game === activeAudioGame && CRASH_AUDIO_GAMES.has(game)) playGameSound(cue, game);
}

// ===== Croupier voice pack (real recorded-style human announcements) =====
// Roulette-only clips: one per pocket ("Twenty three. Red."), plus table calls
// ("No more bets", "Place your bets", "Winner"). Kept in a subfolder and loaded
// LAZILY (only when a roulette table is open) so the other games don't pay the
// download cost. Announcements route through their own gain node so a voice is
// always clearly audible over the table sfx.
const voiceUrls = import.meta.glob("../assets/audio/voice/*.mp3", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const voiceUrlByName: Record<string, string> = {};
for (const [filePath, url] of Object.entries(voiceUrls)) {
  const name = filePath.split("/").pop()!.replace(/\.mp3$/, "");
  voiceUrlByName[name] = url;
}

const voiceBuffers: Record<string, AudioBuffer> = {};
const voiceLoading: Record<string, Promise<AudioBuffer | null>> = {};
// Only one announcement at a time — a new call cuts off the previous one so
// the croupier never talks over himself.
let currentVoice: AudioBufferSourceNode | null = null;
// Monotonic token: clips load asynchronously, so a slow earlier call could
// otherwise resolve after a newer one and play a stale line ("No more bets"
// landing on top of the next round's "Place your bets").
let voiceGeneration = 0;
// True while Sound is off. Time-sensitive audio (croupier calls, the ball
// roll) is dropped rather than played silently, so re-enabling sound mid-clip
// can't unmute a stale call.
let soundOff = false;

// Event guards live in the audio layer as a second line of defence: page
// effects can run more than once during reconnect/snapshot hydration, but a
// croupier line must never be repeated for the same authoritative round.
const spokenRoundEvents = new Set<string>();
const SPOKEN_ROUND_LIMIT = 256;
function speakRoundOnce(event: string, clip: string, roundId: string) {
  if (!roundId || spokenRoundEvents.has(event)) return;
  spokenRoundEvents.add(event);
  if (spokenRoundEvents.size > SPOKEN_ROUND_LIMIT) {
    const first = spokenRoundEvents.values().next().value;
    if (typeof first === "string") spokenRoundEvents.delete(first);
  }
  speak(clip);
}

/** Cut off any announcement in flight and invalidate pending loads. */
function stopVoice() {
  voiceGeneration++;
  const src = currentVoice;
  currentVoice = null;
  if (!src) return;
  try {
    src.stop();
  } catch {
    /* already stopped */
  }
}

/** Stop every time-sensitive roulette layer when leaving the table. */
export function stopRouletteAudio() {
  stopVoice();
  stopBallRoll(0);
}
function loadVoice(name: string): Promise<AudioBuffer | null> {
  const cached = voiceBuffers[name];
  if (cached) return Promise.resolve(cached);
  const inflight = voiceLoading[name];
  if (inflight) return inflight;
  const url = voiceUrlByName[name];
  if (!url) return Promise.resolve(null);
  let c: AudioContext;
  try {
    c = ensure();
  } catch {
    return Promise.resolve(null); // WebAudio unsupported — stay silent.
  }
  const p = fetch(url)
    .then((res) => res.arrayBuffer())
    .then((data) => c.decodeAudioData(data))
    .then((buf) => {
      voiceBuffers[name] = buf;
      return buf;
    })
    .catch(() => null);
  voiceLoading[name] = p;
  return p;
}

// ===== Table sound pack (recorded casino table audio) =====
// Specialist recordings belong to Roulette's wheel and Teen Patti Live's
// physical card choreography. Other games synthesize their own action cues.
const tableUrls = import.meta.glob("../assets/audio/table/*.mp3", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const tableUrlByName: Record<string, string> = {};
for (const [filePath, url] of Object.entries(tableUrls)) {
  const name = filePath.split("/").pop()!.replace(/\.mp3$/, "");
  tableUrlByName[name] = url;
}

const tableBuffers: Record<string, AudioBuffer> = {};
const tableLoading: Record<string, Promise<AudioBuffer | null>> = {};
const tablePreloadedGames = new Set<string>();

// The clips are mastered to a common loudness, so these trims are purely
// mix balance: chips read clearly, the spin layers sit well under the
// croupier, and nothing fights the announcement.
const tableGainTrim: Record<string, number> = {
  "chip-place-1": 0.85,
  "chip-place-2": 0.85,
  "chip-place-3": 0.85,
  "chip-stack-push": 0.8,
  "chip-scoop": 0.7,
  "wheel-launch": 0.55,
  "fret-rattle": 0.5,
  "ball-drop": 0.75,
  "table-win": 0.7,
  "table-lose": 0.7,
};

function loadTableClip(name: string): Promise<AudioBuffer | null> {
  const cached = tableBuffers[name];
  if (cached) return Promise.resolve(cached);
  const inflight = tableLoading[name];
  if (inflight) return inflight;
  const url = tableUrlByName[name];
  if (!url) return Promise.resolve(null);
  let c: AudioContext;
  try {
    c = ensure();
  } catch {
    return Promise.resolve(null); // WebAudio unsupported — stay silent.
  }
  const p = fetch(url)
    .then((res) => res.arrayBuffer())
    .then((data) => c.decodeAudioData(data))
    .then((buf) => {
      tableBuffers[name] = buf;
      return buf;
    })
    .catch(() => null);
  tableLoading[name] = p;
  return p;
}

/**
 * Fetch order for the warm-up: what a player can trigger soonest goes first.
 * Chips are one click away, the spin layers are next, and the settle cues have
 * a whole round to arrive. Anything not listed follows in glob order.
 */
const TABLE_PRELOAD_ORDER = [
  "ball-roll-loop",
  "wheel-launch",
  "ball-drop",
  "fret-rattle",
];

/**
 * Only warm the active game's recordings; generated effects are immediate.
 */
export async function preloadTableAudio(game?: "lucky-7"): Promise<void> {
  if (game === "lucky-7") {
    const c = tryEnsure();
    if (!c) return;
    gameSounds ??= new GameSoundBank(c);
    return gameSounds.preloadDice();
  }
  if (activeAudioGame !== "roulette" && activeAudioGame !== "teen-patti-live" && activeAudioGame !== "baccarat") return;
  if (tablePreloadedGames.has(activeAudioGame)) return;
  tablePreloadedGames.add(activeAudioGame);
  const names = Object.keys(tableUrlByName).filter(name => activeAudioGame !== "roulette" ? name.startsWith("tp-") : TABLE_PRELOAD_ORDER.includes(name));
  names.sort((a, b) => {
    const ia = TABLE_PRELOAD_ORDER.indexOf(a);
    const ib = TABLE_PRELOAD_ORDER.indexOf(b);
    return (ia < 0 ? TABLE_PRELOAD_ORDER.length : ia) - (ib < 0 ? TABLE_PRELOAD_ORDER.length : ib);
  });
  for (const name of names) void loadTableClip(name);
}

/**
 * Default grace for a clip asked for before its buffer landed. Short, because
 * a chip tap that arrives late is worse than one that never arrives. Cues with
 * more slack (a spin whoosh under a multi-second landing) raise it per call.
 */
const TABLE_LATE_START_MS = 400;
// A stronger roulette mix, applied before the player's existing volume/mute.
const ROULETTE_AUDIO_BOOST = 1.65;

function startTableClip(
  c: AudioContext,
  buf: AudioBuffer,
  name: string,
  opts: { gain?: number; rate?: number },
) {
  const src = c.createBufferSource();
  src.buffer = buf;
  if (opts.rate !== undefined) src.playbackRate.value = opts.rate;
  const g = c.createGain();
  g.gain.value = (tableGainTrim[name] ?? 1) * (opts.gain ?? 1);
  src.connect(g);
  g.connect(activeAudioGame === "roulette" ? rouletteSfxGain! : sfxGain!);
  src.onended = () => {
    try {
      src.disconnect();
      g.disconnect();
    } catch {
      /* already torn down */
    }
  };
  src.start();
}

function playTable(
  name: string,
  opts: { gain?: number; rate?: number; throttleMs?: number; lateMs?: number } = {},
) {
  if (!tabVisible || soundOff) return;
  let c: AudioContext;
  try {
    c = ensure();
  } catch {
    return;
  }
  if (c.state === "suspended") void c.resume().catch(() => {});
  if (opts.throttleMs && throttled(name, opts.throttleMs)) return;
  const buf = tableBuffers[name];
  if (buf) {
    startTableClip(c, buf, name, opts);
    return;
  }
  // Asked for before the warm-up finished: play it the moment it decodes, but
  // only while it is still relevant — a chip click that resolves seconds later
  // would land against nothing on screen.
  const requestedGame = activeAudioGame;
  const deadline = Date.now() + (opts.lateMs ?? TABLE_LATE_START_MS);
  void loadTableClip(name).then((late) => {
    if (!late || requestedGame !== activeAudioGame || !tabVisible || soundOff || Date.now() > deadline) return;
    startTableClip(c, late, name, opts);
  });
}

// ===== Ball-on-track roll (continuous layer under a roulette spin) =====
// A single looping voice for the whole spin: the ball whirring round the
// track. Volume and pitch follow the wheel's own speed, so it swells with the
// launch and thins out as the ball loses pace. Deliberately quiet — it is a
// bed that must never fight the croupier.
const ROLL_MIN_LEVEL = 0.06;
const ROLL_MAX_LEVEL = 0.34;
const ROLL_MIN_RATE = 0.78;
const ROLL_MAX_RATE = 1.32;
/** Skip the mp3 decoder's edge padding, which would gap the loop each cycle. */
const ROLL_EDGE = 0.03;

let rollVoice: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
let rollStarting = false;
/** Bumped by every stop, so a start still awaiting its buffer is cancelled. */
let rollToken = 0;
let rollLevel = ROLL_MIN_LEVEL;
let rollRate = 1;

function driveBallRoll(speed01: number) {
  if (!tabVisible || soundOff) return;
  const v = speed01 < 0 ? 0 : speed01 > 1 ? 1 : speed01;
  rollLevel = ROLL_MIN_LEVEL + (ROLL_MAX_LEVEL - ROLL_MIN_LEVEL) * v;
  rollRate = ROLL_MIN_RATE + (ROLL_MAX_RATE - ROLL_MIN_RATE) * v;
  const live = rollVoice;
  if (live && ctx) {
    // setTargetAtTime rather than a step: safe to call every animation frame
    // without zipper noise.
    live.gain.gain.setTargetAtTime(rollLevel, ctx.currentTime, 0.08);
    live.src.playbackRate.setTargetAtTime(rollRate, ctx.currentTime, 0.08);
    return;
  }
  if (rollStarting) return;
  let c: AudioContext;
  try {
    c = ensure();
  } catch {
    return;
  }
  if (c.state === "suspended") void c.resume().catch(() => {});
  rollStarting = true;
  const token = rollToken;
  void loadTableClip("ball-roll-loop").then((buf) => {
    rollStarting = false;
    // Stopped (settle, unmount, tab hide, sound off) while the buffer loaded.
    if (!buf || token !== rollToken || !tabVisible || soundOff) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = ROLL_EDGE;
    src.loopEnd = Math.max(ROLL_EDGE * 2, buf.duration - ROLL_EDGE);
    src.playbackRate.value = rollRate;
    const g = c.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(rollLevel, c.currentTime + 0.12);
    src.connect(g);
    g.connect(activeAudioGame === "roulette" ? rouletteSfxGain! : sfxGain!);
    src.start(0, ROLL_EDGE);
    rollVoice = { src, gain: g };
  });
}

/** Fade the roll out and tear it down. Idempotent. */
function stopBallRoll(fadeMs = 220) {
  rollToken++;
  rollStarting = false;
  const live = rollVoice;
  rollVoice = null;
  if (!live || !ctx) return;
  const now = ctx.currentTime;
  const fade = Math.max(0.03, fadeMs / 1000);
  live.src.onended = () => {
    try {
      live.src.disconnect();
      live.gain.disconnect();
    } catch {
      /* already torn down */
    }
  };
  try {
    live.gain.gain.cancelScheduledValues(now);
    live.gain.gain.setValueAtTime(live.gain.gain.value, now);
    live.gain.gain.linearRampToValueAtTime(0, now + fade);
    live.src.stop(now + fade + 0.02);
  } catch {
    /* already stopped */
  }
}

// UI navigation ticks (hover/select on game tiles, bottom-nav, top-bar) are
// only allowed on game routes — mirroring the background-music route gate. On
// the lobby/home and other non-game pages these incidental ticks stay silent
// even though the Sound setting is on. EngineHost flips this via the engine's
// setMusicRouteAllowed, which forwards to setUiNavAllowed below. Default false
// so a fresh page load (always the lobby first) is silent until we're in a game.
let uiNavAllowed = false;

export function setUiNavAllowed(allowed: boolean) {
  uiNavAllowed = allowed;
}

// Throttle map for high-frequency SFX (peg hits, rapid clicks). Each entry is
// the AudioContext.currentTime of the last played instance. Acts as a simple
// voice limit so auto-play / fast clicks can't pile up into a wall of noise.
const lastPlayedAt: Record<string, number> = {};
function throttled(key: string, minIntervalMs: number): boolean {
  const c = ctx;
  if (!c) return false;
  const now = c.currentTime;
  const prev = lastPlayedAt[key] ?? 0;
  if (now - prev < minIntervalMs / 1000) return true;
  lastPlayedAt[key] = now;
  return false;
}

// Tab-visibility mute: when the browser tab is hidden (backgrounded, another
// tab focused, window minimized) ALL audio is silenced — new SFX are skipped
// and the master bus is ducked to zero so running sounds (engine hum, music)
// go quiet too. Restored the moment the tab becomes visible again.
let tabVisible = typeof document === "undefined" || !document.hidden;
// Remember the last master volume set via setVolumes so we can restore it.
let lastMasterVolume = 0.7;

function applyTabMute() {
  if (!masterGain || !ctx) return;
  const target = tabVisible ? lastMasterVolume : 0;
  masterGain.gain.setTargetAtTime(target, ctx.currentTime, 0.05);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    tabVisible = !document.hidden;
    applyTabMute();
    if (!tabVisible) {
      audioGeneration++;
      stopSevenTableAudio();
      // A table call is time-sensitive: drop it rather than let it resume
      // half-spoken when the player comes back to the tab.
      stopVoice();
      // The wheel's animation loop is also frozen while hidden, so nothing
      // would be driving the roll. Kill it outright rather than leave a loop
      // running silently; the wheel's next frame restarts it if the spin is
      // still going when the player returns.
      stopBallRoll(0);
      stopEngineHum();
      gameSounds?.stop();
      pauseMusic();
    } else if (musicPlaying) {
      void unlockAudio();
      startMusic();
    }
  });
}

/** Audio availability must never prevent a game or its controls from rendering. */
function tryEnsure(): AudioContext | null {
  try { return ensure(); } catch { return null; }
}

function ensure(): AudioContext {
  if (ctx) return ctx;
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const AC = w.AudioContext ?? w.webkitAudioContext;
  if (!AC) throw new Error("WebAudio not supported");
  const c = new AC();
  ctx = c;
  masterGain = c.createGain();
  masterGain.gain.value = 0.7;
  masterGain.connect(c.destination);
  sfxGain = c.createGain();
  sfxGain.gain.value = 0.8;
  sfxGain.connect(masterGain);
  uiGain = c.createGain();
  uiGain.gain.value = 0.8;
  uiGain.connect(masterGain);
  musicGain = c.createGain();
  musicGain.gain.value = 0.25;
  musicGain.connect(masterGain);
  voiceGain = c.createGain();
  // Announcements sit slightly above the sfx bed so the call is always clear.
  voiceGain.gain.value = 1;
  voiceGain.connect(masterGain);
  // Boost only this table's mix, with a peak limiter before the existing
  // master/mute control. Other games retain their original gain paths.
  const rouletteBoostGain = c.createGain();
  rouletteBoostGain.gain.value = ROULETTE_AUDIO_BOOST;
  const rouletteLimiter = c.createDynamicsCompressor();
  rouletteLimiter.threshold.value = -3;
  rouletteLimiter.knee.value = 3;
  rouletteLimiter.ratio.value = 20;
  rouletteLimiter.attack.value = 0.002;
  rouletteLimiter.release.value = 0.15;
  rouletteBoostGain.connect(rouletteLimiter);
  rouletteLimiter.connect(masterGain);
  rouletteSfxGain = c.createGain();
  rouletteSfxGain.gain.value = 0.8;
  rouletteSfxGain.connect(rouletteBoostGain);
  rouletteVoiceGain = c.createGain();
  rouletteVoiceGain.gain.value = 1;
  rouletteVoiceGain.connect(rouletteBoostGain);
  // resume() can finish after route setup, including automatic browser unlock.
  c.addEventListener("statechange", () => {
    if (c.state === "running" && musicPlaying) startMusic();
  });
  return c;
}

/**
 * Warm the croupier voice clips for a roulette table: the two table calls
 * plus (optionally) a specific pocket. Called when the Roulette page mounts so
 * the first announcement doesn't wait on a network round-trip.
 */
export function preloadCroupierVoice() {
  void loadVoice("no-more-bets");
  void loadVoice("place-your-bets");
  void loadVoice("winner");
}

export type CroupierGame =
  | "lunar"
  | "aviator"
  | "jetx"
  | "mines"
  | "plinko"
  | "dice"
  | "roulette"
  | "baccarat"
  | "blackjack"
  | "teen-patti"
  | "teen-patti-live"
  | "andar-bahar"
  | "lucky-7"
  | "crazy-time"
  | "vegetable-bowl";

/**
 * Shared round vocabulary. Only clips that exist in the approved pack are
 * requested; adding a game never makes audio a dependency of settlement.
 */
export function preloadCroupierRoundVoice() {
  void loadVoice("place-your-bets");
  void loadVoice("no-more-bets");
  void loadVoice("winner");
}

export function voiceRoundOpen(game: CroupierGame, roundId: string) {
  speakRoundOnce(`${game}:${roundId}:open`, "place-your-bets", roundId);
}

export function voiceBetsClosed(game: CroupierGame, roundId: string) {
  speakRoundOnce(`${game}:${roundId}:closed`, "no-more-bets", roundId);
}

/** Spoken only after the caller has observed an authoritative settled win. */
export function voiceRoundWin(game: CroupierGame, roundId: string) {
  speakRoundOnce(`${game}:${roundId}:win`, "winner", roundId);
}

/** Loss/result wording is optional until an approved clip is supplied. */
export function voiceRoundLoss(game: CroupierGame, roundId: string) {
  speakRoundOnce(`${game}:${roundId}:loss`, "round-loss", roundId);
}

/**
 * Crash/Mines/Plinko/Dice result slots are intentionally separate from the
 * generic winner line. They become audible as soon as the approved
 * game-specific recording is present, while a missing recording remains a
 * silent no-op and cannot delay settlement.
 */
export function voiceRoundResult(
  game: CroupierGame,
  roundId: string,
  resultClip: string,
) {
  if (!resultClip || !voiceUrlByName[resultClip]) return;
  speakRoundOnce(`${game}:${roundId}:result`, resultClip, roundId);
}

function speak(name: string, onEnded?: () => void) {
  if (!tabVisible || soundOff) return;
  let c: AudioContext;
  try {
    c = ensure();
  } catch {
    return;
  }
  if (c.state === "suspended") void c.resume().catch(() => {});
  // Claim the latest slot up front and cut off whatever is playing, so the
  // most recent call always wins regardless of load order.
  stopVoice();
  const gen = voiceGeneration;
  void loadVoice(name).then((buf) => {
    // Superseded by a newer call, muted, or backgrounded while loading.
    if (!buf || gen !== voiceGeneration || !tabVisible || soundOff) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(activeAudioGame === "roulette" ? rouletteVoiceGain! : voiceGain!);
    src.onended = () => {
      src.disconnect();
      // Only a clip that played to the end (still the current one) chains a
      // follow-up line; a clip cut short by a newer call must not.
      if (currentVoice !== src) return;
      currentVoice = null;
      onEnded?.();
    };
    currentVoice = src;
    src.start();
  });
}

export function setVolumes(master: number, sfx: number, music: number, ui: number) {
  // Ensure the AudioContext exists so volume changes (and sound-toggle
  // re-enables) take effect immediately, even before the first sfx plays.
  // Toggling Sound on counts as a user gesture, so creating ctx here is fine.
  const c = tryEnsure();
  if (!c) return;
  if (c.state === "suspended") void c.resume().catch(() => {});
  // Route the master level through the tab-visibility mute: remember the
  // requested volume, but keep the bus at 0 while the tab is hidden.
  lastMasterVolume = master;
  masterGain!.gain.value = tabVisible ? master : 0;
  sfxGain!.gain.value = sfx;
  musicGain!.gain.value = music;
  uiGain!.gain.value = ui;
  // Croupier announcements follow the SFX slider (a touch louder so the call
  // carries over the table sfx) and stop outright when Sound is turned off.
  voiceGain!.gain.value = Math.min(1, sfx * 1.25);
  rouletteSfxGain!.gain.value = sfx;
  rouletteVoiceGain!.gain.value = Math.min(1, sfx * 1.25);
  soundOff = master <= 0 || sfx <= 0;
  if (soundOff) {
    audioGeneration++;
    stopSevenTableAudio();
    stopVoice();
    gameSounds?.stop();
    stopEngineHum();
    // Turning Sound off mid-spin must silence the roll immediately rather
    // than leave it looping behind a zeroed bus.
    stopBallRoll(60);
  }
}

export function unlockAudio() {
  const c = tryEnsure();
  if (!c) return Promise.resolve();
  // Mobile browsers resolve resume asynchronously after the trusted tap.
  // Callers that need to start recorded speech must wait for that resolution.
  return (c.state === "suspended" ? c.resume() : Promise.resolve()).then(() => {
    if (musicPlaying) startMusic();
  }).catch(() => {});
}

/** Observe the actual device state so a game can offer a tap when autoplay is blocked. */
export function subscribeAudioState(listener: (state: AudioContextState | "unsupported") => void) {
  const context = tryEnsure();
  const update = () => listener(context?.state ?? "unsupported");
  update();
  context?.addEventListener("statechange", update);
  return () => context?.removeEventListener("statechange", update);
}

// Filmed dealers use the already-unlocked game AudioContext. Keeping their
// audio separate from muted video avoids mobile audible-autoplay failures.
const dealerBuffers = new Map<string, AudioBuffer>();
const dealerLoads = new Map<string, Promise<void>>();
export function preloadDealerAudio(url: string): Promise<void> {
  const previous = dealerLoads.get(url);
  if (previous) return previous;
  const loading = fetch(url).then(response => {
    if (!response.ok) throw new Error("Dealer audio unavailable");
    return response.arrayBuffer();
  }).then(bytes => ensure().decodeAudioData(bytes)).then(buffer => {
    dealerBuffers.set(url, buffer);
  }).catch(() => { dealerLoads.delete(url); });
  dealerLoads.set(url, loading);
  return loading;
}

export function dealerAudioUnlocked(): boolean { return ctx?.state === "running"; }
export function dealerAudioReady(url: string): boolean { return dealerBuffers.has(url); }

// A filmed take must use its embedded soundtrack: one browser media clock for
// speech, lips, seeking and buffering. Cache the source because Web Audio only
// permits one MediaElementAudioSourceNode per element, including StrictMode.
const dealerMedia = new WeakMap<HTMLMediaElement, {
  source: MediaElementAudioSourceNode;
  gain: GainNode;
}>();
export function connectDealerMedia(element: HTMLMediaElement) {
  const c = tryEnsure();
  if (!c) return null;
  let graph = dealerMedia.get(element);
  if (!graph) {
    const source = c.createMediaElementSource(element);
    const gain = c.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    graph = { source, gain };
    dealerMedia.set(element, graph);
  }
  const { gain } = graph;
  // Callers supply the combined master/voice level, as with playDealerAudio.
  gain.disconnect();
  gain.connect(c.destination);
  return {
    setVolume: (value: number) => {
      gain.gain.value = Math.max(0, Math.min(1, value));
    },
    disconnect: () => {
      gain.gain.value = 0;
      gain.disconnect();
    },
  };
}

export interface DealerAudioHandle {
  stop: () => void;
  setVolume: (volume: number) => void;
  setRate: (rate: number) => void;
  getPosition: () => number;
}

export function playDealerAudio(url: string, offset: number, duration: number, rate: number, volume: number, onEnded?: () => void): DealerAudioHandle | null {
  const buffer = dealerBuffers.get(url);
  if (!ctx || ctx.state !== "running" || !buffer || document.hidden || duration <= 0 || offset >= buffer.duration) return null;
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  gain.gain.value = Math.max(0, Math.min(1, volume));
  source.connect(gain);
  // This volume already includes the player's master and effects settings.
  gain.connect(ctx.destination);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try { source.stop(); } catch { /* Already ended. */ }
    source.disconnect(); gain.disconnect();
  };
  source.onended = () => {
    if (stopped) return;
    stop();
    onEnded?.();
  };
  let position = Math.max(0, offset);
  let startedAt = ctx.currentTime;
  let playbackRate = rate;
  const getPosition = () => position + (ctx!.currentTime - startedAt) * playbackRate;
  source.start(0, Math.max(0, offset), Math.min(duration, buffer.duration - offset));
  return {
    stop,
    setVolume: value => { gain.gain.value = Math.max(0, Math.min(1, value)); },
    setRate: value => {
      position = getPosition();
      startedAt = ctx!.currentTime;
      playbackRate = value;
      source.playbackRate.value = value;
    },
    getPosition,
  };
}

function blip(
  freq: number,
  duration: number,
  type: OscillatorType = "sine",
  attack = 0.01,
  peak = 0.35,
  dest: () => GainNode = () => sfxGain!,
) {
  if (!tabVisible) return;
  const c = tryEnsure();
  if (!c) return;
  if (c.state === "suspended") void c.resume().catch(() => {});
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.value = 0;
  g.gain.linearRampToValueAtTime(peak, c.currentTime + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
  osc.connect(g);
  g.connect(dest());
  osc.start();
  osc.stop(c.currentTime + duration);
}

function noiseSwoosh(
  duration: number,
  up: boolean,
  peak = 0.18,
  dest: () => GainNode = () => sfxGain!,
) {
  // Filtered-noise whoosh whose lowpass cutoff glides up (open) or down
  // (close). Used for dialog open/close transitions.
  if (!tabVisible) return;
  const c = tryEnsure();
  if (!c) return;
  if (c.state === "suspended") void c.resume().catch(() => {});
  const samples = Math.floor(c.sampleRate * duration);
  const buf = c.createBuffer(1, samples, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < samples; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 0.8;
  const fromF = up ? 400 : 1600;
  const toF = up ? 1600 : 400;
  filter.frequency.setValueAtTime(fromF, c.currentTime);
  filter.frequency.exponentialRampToValueAtTime(toF, c.currentTime + duration);
  const g = c.createGain();
  g.gain.value = 0;
  g.gain.linearRampToValueAtTime(peak, c.currentTime + duration * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
  src.connect(filter);
  filter.connect(g);
  g.connect(dest());
  src.start();
  src.stop(c.currentTime + duration);
}

// Routing helper for UI navigation sounds so they sit on the dedicated uiGain
// bus (independent of the SFX slider).
const ui = () => uiGain!;

// Each flight theme has its own seamless loop.
let engineSource: AudioBufferSourceNode | null = null;
let engineRequest = 0;
let enginePending = false;
function startEngineHum() {
  if (engineSource || enginePending || !activeAudioGame || !CRASH_AUDIO_GAMES.has(activeAudioGame) || !tabVisible || soundOff) return;
  const c = tryEnsure();
  if (!c || c.state !== "running") return;
  gameSounds ??= new GameSoundBank(c);
  if (!gameSounds.ready(activeAudioGame, "engine")) {
    const request = ++engineRequest, generation = audioGeneration, game = activeAudioGame;
    enginePending = true;
    void gameSounds.prepare(game, "engine").then(ready => {
      if (request !== engineRequest) return;
      enginePending = false;
      if (ready && generation === audioGeneration && game === activeAudioGame) startEngineHum();
    });
    return;
  }
  engineSource = gameSounds.play(activeAudioGame, "engine", sfxGain!, .65, true);
  if (engineSource && activeAudioGame === "fury") engineSource.playbackRate.value = furyEngineRate(0);
}
function stopEngineHum() {
  engineRequest++; enginePending = false;
  try { engineSource?.stop(); } catch { /* already ended */ }
  engineSource = null;
}

function sweep(
  fromFreq: number,
  toFreq: number,
  duration: number,
  type: OscillatorType = "sine",
  peak = 0.35,
) {
  const c = tryEnsure();
  if (!c) return;
  if (c.state === "suspended") void c.resume().catch(() => {});
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(fromFreq, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(
    Math.max(1, toFreq),
    c.currentTime + duration,
  );
  g.gain.value = 0;
  g.gain.linearRampToValueAtTime(peak, c.currentTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
  osc.connect(g);
  g.connect(sfxGain!);
  osc.start();
  osc.stop(c.currentTime + duration);
}

export const sfx = {
  // Original game cues and recorded specialist foley share the effects bus.

  // ===== Lunar =====
  takeoff(game?: string) {
    flightSound("launch", game);
  },
  engineStart(game?: string) {
    if (game && game !== activeAudioGame) return;
    startEngineHum();
  },
  engineStop() {
    stopEngineHum();
  },
  engineIntensity(_m: number, flyMs = 0, game?: string) {
    if (game && game !== activeAudioGame) return;
    startEngineHum();
    if (engineSource && ctx) {
      const rate = activeAudioGame === "fury" ? furyEngineRate(flyMs) : 1 + Math.min(.65, Math.log(Math.max(1, _m)) * .16);
      engineSource.playbackRate.setTargetAtTime(rate, ctx.currentTime, .15);
    }
  },
  cashout() {
    flightSound("win");
  },
  bet() { playGameSound(activeAudioGame && gameSounds?.hasRecording(activeAudioGame, "bet") ? "bet" : "select"); },
  crash(game?: string) {
    if (game && game !== activeAudioGame) return;
    stopEngineHum();
    flightSound("crash", game);
  },
  click() {
    // Throttle so rapid-fire clicks (chip mash, double-taps) don't stack into a
    // click cloud. 60ms is below human "single click" perception but enough to
    // keep the mix clean.
    playGameSound("select");
  },

  // ===== UI navigation =====
  uiHover() {
    // Soft, very quiet tick as the pointer moves across game tiles / menu
    // items. Throttled so sweeping across many tiles doesn't machine-gun.
    // Suppressed off game routes (lobby/home) so navigation stays silent there.
    if (!uiNavAllowed) return;
    if (throttled("uiHover", 70)) return;
    blip(1500, 0.025, "sine", 0.003, 0.06, ui);
  },
  uiSelect() {
    // Slightly brighter two-step tick when a tile / nav item is chosen.
    // Suppressed off game routes (lobby/home) so navigation stays silent there.
    if (!uiNavAllowed) return;
    if (throttled("uiSelect", 60)) return;
    blip(880, 0.04, "triangle", 0.004, 0.16, ui);
    setTimeout(() => blip(1320, 0.05, "triangle", 0.004, 0.18, ui), 35);
  },
  dialogOpen() {
    // Upward swoosh as a panel / dialog slides in.
    noiseSwoosh(0.22, true, 0.16, ui);
    blip(880, 0.07, "sine", 0.005, 0.12, ui);
  },
  dialogClose() {
    // Downward swoosh as a panel / dialog dismisses.
    noiseSwoosh(0.2, false, 0.14, ui);
    blip(660, 0.07, "sine", 0.005, 0.1, ui);
  },
  achievementUnlock() {
    // Bright sparkle arpeggio for an unlocked achievement.
    blip(784, 0.09, "triangle", 0.004, 0.26);
    setTimeout(() => blip(988, 0.09, "triangle", 0.004, 0.26), 70);
    setTimeout(() => blip(1319, 0.14, "triangle", 0.004, 0.28), 140);
    setTimeout(() => blip(1760, 0.12, "sine", 0.004, 0.2), 210);
  },
  levelUp() {
    // Celebratory rising fanfare for a level-up. Bigger than an achievement
    // cue: a four-note major flourish with a shimmer tail.
    blip(523, 0.12, "triangle", 0.005, 0.3);
    setTimeout(() => blip(659, 0.12, "triangle", 0.005, 0.3), 90);
    setTimeout(() => blip(784, 0.12, "triangle", 0.005, 0.3), 180);
    setTimeout(() => blip(1047, 0.26, "triangle", 0.005, 0.34), 270);
    setTimeout(() => sweep(1047, 2093, 0.3, "sine", 0.16), 300);
  },

  // ===== Mines =====
  mineReveal() {
    playGameSound("reveal", "mines");
  },
  mineHit() {
    playGameSound("crash", "mines");
  },
  minesCashout() {
    playGameSound("win", "mines");
  },

  // ===== Plinko =====
  plinkoDrop() {
    playGameSound("roll", "plinko");
  },
  plinkoPeg() {
    // Throttled so auto-drop with multiple balls doesn't pile up dozens of
    // overlapping ticks per frame.
    playGameSound("impact", "plinko", .55);
  },
  plinkoWin() {
    playGameSound("win", "plinko");
  },
  plinkoLose() {
    playGameSound("lose", "plinko");
  },

  // ===== Dice =====
  diceRoll() {
    playGameSound("roll", "dice");
  },
  diceWin() {
    playGameSound("win", "dice");
  },
  diceLose() {
    playGameSound("lose", "dice");
  },

  // Shared controls use the active game's own chip/card palette.
  chipPlace() { playGameSound("select"); },
  chipStackPush() { playGameSound("bet"); },
  chipScoop() { playGameSound("clear"); },
  cardDeal() { playGameSound("deal"); },
  // Baccarat uses the same licensed physical table recordings, with a softer mix.
  baccaratCardPlace(index = 0) { playTable(`tp-card-place-${index % 4 + 1}`, { gain: .72, lateMs: 120 }); },
  baccaratChipPlace() { playTable(`tp-chip-place-${Math.floor(Math.random() * 3) + 1}`, { gain: .78, throttleMs: 45 }); },
  baccaratChipStack() { playTable("tp-chip-stack", { gain: .7, throttleMs: 100 }); },
  baccaratChipScoop() { playTable("tp-chip-scoop", { gain: .65, throttleMs: 100 }); },
  /** Recorded CC0 casino card foley; one cue for each physical card. */
  teenPattiCardLift(index = 0) {
    playTable(`tp-card-slide-${index % 2 + 1}`, { gain: .8, lateMs: 100 });
  },
  teenPattiCardPlace(index = 0) {
    playTable(`tp-card-place-${index % 4 + 1}`, { gain: .9, lateMs: 100 });
  },
  teenPattiChipPlace() {
    playTable(`tp-chip-place-${Math.floor(Math.random() * 3) + 1}`, { gain: .9, throttleMs: 45 });
  },
  teenPattiChipStack() {
    playTable("tp-chip-stack", { gain: .85, throttleMs: 100 });
  },
  teenPattiChipScoop() {
    playTable("tp-chip-scoop", { gain: .8, throttleMs: 100 });
  },
  teenPattiShuffle() {
    playTable("tp-card-shuffle", { gain: .55, throttleMs: 1000 });
  },
  // ===== Roulette spin =====
  // Driven by the wheel's own motion (see RouletteWheel's audio hooks) rather
  // than fixed timers, so the cues stay in sync however long the reveal window
  // is and whenever the player joined the round.

  /**
   * Croupier launches the ball — one-shot whoosh off the rim. Given a long
   * grace period: it sits under a multi-second landing, so arriving a beat
   * late still reads, and a player who opens the table mid-spin would
   * otherwise lose it to a cold cache.
   */
  wheelLaunch() {
    playTable("wheel-launch", { throttleMs: 500, lateMs: 1200 });
  },
  /**
   * Continuous ball-on-track layer. Call every animation frame with the ball's
   * speed as a 0..1 fraction of its peak; the loop starts on the first call and
   * tracks speed from there.
   */
  ballRoll(speed01: number) {
    driveBallRoll(speed01);
  },
  /** Fade the roll out: settle, unmount, tab hide, flat wheel, or Sound off. */
  ballRollStop(fadeMs?: number) {
    stopBallRoll(fadeMs);
  },
  // The rattle and the clack are pinned to what the ball is visibly doing, so
  // they get a tight grace period — silence beats a clack after the ball has
  // already settled.
  /** Ball skipping over the frets as it loses pace. */
  ballRattle() {
    playTable("fret-rattle", { throttleMs: 800, lateMs: 250 });
  },
  /** Ball drops off the track and clacks into its pocket. */
  ballDrop() {
    playTable("ball-drop", { throttleMs: 400, lateMs: 250 });
  },

  // Airborne dice are quiet. Play one complete two-dice recording at first
  // contact; its uneven clatter already includes all later bounces and rest.
  diceThrow() { gameSounds?.stopDiceRoll(); },
  diceImpact(strength = 1) {
    if (strength >= .99) playGameSound("roll", "lucky-7", .85);
  },
  diceSettle() { gameSounds?.stopDiceRoll(); },
  winCelebration(game?: string) { playGameSound("win", game ?? activeAudioGame); },
  tableWin(game: string) { playGameSound("win", game); },
  tableLose(game: string) { playGameSound("lose", game); },

  // ===== Croupier voice (roulette table calls, real spoken clips) =====
  /** "No more bets, please." — betting window just closed. */
  voiceNoMoreBets() {
    speak("no-more-bets");
  },
  /** "Place your bets." — a fresh betting window opened. */
  voicePlaceYourBets() {
    speak("place-your-bets");
  },
  /**
   * Announces the winning pocket with its colour ("Twenty three. Red.").
   * When the player's own bets won, the croupier follows up with "Winner!"
   * once the number call finishes.
   */
  voicePocket(pocket: number, playerWon = false) {
    if (!Number.isInteger(pocket) || pocket < 0 || pocket > 36) return;
    speak(`pocket-${pocket}`, playerWon ? () => speak("winner") : undefined);
  },
  /** "Winner! Nicely played." — the player's own bet came in. */
  voiceWinner() {
    speak("winner");
  },
  /** Warm one pocket clip while the wheel is still spinning. */
  preloadVoicePocket(pocket: number) {
    if (!Number.isInteger(pocket) || pocket < 0 || pocket > 36) return;
    void loadVoice(`pocket-${pocket}`);
  },
};

// Original music phrases follow the game and the existing Music toggle.
export function startMusic() {
  // The live studio owns a recorded jazz layer with separate table controls.
  if (!activeAudioGame || activeAudioGame === "teen-patti-live" || activeAudioGame === "baccarat" || activeAudioGame === "dragon-tiger-one-day") return;
  musicPlaying = true;
  if (musicSource || !tabVisible || lastMasterVolume <= 0) return;
  const c = tryEnsure();
  if (!c || c.state !== "running") return;
  gameSounds ??= new GameSoundBank(c);
  if (!gameSounds.ready(activeAudioGame, "music")) {
    const generation = audioGeneration, game = activeAudioGame, request = musicRequest;
    void gameSounds.prepare(game, "music").then(ready => {
      if (ready && musicPlaying && generation === audioGeneration && request === musicRequest && game === activeAudioGame) startMusic();
    });
    return;
  }
  musicSource = gameSounds.play(activeAudioGame, "music", musicGain!, .55, true);
}
let musicRequest = 0;
export function stopMusic() {
  musicPlaying = false;
  pauseMusic();
}
function pauseMusic() {
  musicRequest++;
  try { musicSource?.stop(); } catch { /* already ended */ }
  musicSource = null;
}
