import { renderChickenSound } from "./chickenSounds";
import { renderPirateSound } from "./pirateSounds";
import { Lucky7DiceRecordings } from "./lucky7DiceRecordings";
import { PublicDemoSoundBank } from "./publicDemoSounds";
import { renderFurySound } from "./furySounds";
import { FuryHelicopterRecording } from "./furyHelicopterRecording";

/** Original, locally synthesized sound designs. No downloads or audio service required. */
type Instrument = "bell" | "wood" | "pluck" | "brass" | "glass" | "pulse" | "air";
type Texture = "space" | "propeller" | "turbine" | "fire" | "wind" | "sand" | "crystal" | "peg" | "dice" | "wheel" | "felt" | "paper" | "wood" | "bamboo" | "drum" | "harvest" | "hoof" | "motor" | "digital";
interface SoundDesign {
  label: string;
  root: number;
  instrument: Instrument;
  texture: Texture;
  melody: readonly number[];
  beat: number;
  seed: number;
}
const design = (label: string, root: number, instrument: Instrument, texture: Texture, melody: number[], beat: number, seed: number): SoundDesign =>
  ({ label, root, instrument, texture, melody, beat, seed });

export const GAME_SOUND_DESIGNS = {
  "chicken-road-pirate": design("Chicken Road Pirate Edition · clucks, wooden rafts, splashes, treasure and sea shanty", 587.33, "wood", "wood", [0, 3, 7, 12], .22, 719),
  "dragon-tiger-one-day": design("One Day Dragon Tiger · bamboo, jade chimes and studio bells", 246.94, "glass", "bamboo", [0, 2, 7, 9, 14, 19], .165, 359),
  "crazy-time": design("Crazy Time · wheel clicks and showtime bells", 587.33, "bell", "wheel", [0, 4, 7, 12, 16, 19], .105, 331),
  lunar: design("Lunar · orbital bells and rocket air", 220, "bell", "space", [0, 7, 12, 14], .19, 11),
  aviator: design("Aviator · propeller and radio brass", 293.66, "brass", "propeller", [0, 4, 7, 12], .12, 23),
  jetx: design("JetX · turbine and sharp synth", 164.81, "pulse", "turbine", [0, 12, 7, 19], .09, 37),
  fury: design("Fury · recorded helicopter rotor and cashout chime", 130.81, "brass", "propeller", [0, 3, 7, 10, 12], .095, 67),
  mines: design("Mines · crystal gems and deep impact", 659.25, "glass", "crystal", [0, 3, 7, 12], .11, 101),
  "chicken-road": design("Chicken Road · hen clucks, wing flaps and golden egg chimes", 523.25, "wood", "harvest", [0, 4, 7, 12, 16], .09, 347),
  plinko: design("Plinko · wooden pegs and marimba", 392, "wood", "peg", [0, 4, 7, 9, 12], .085, 113),
  dice: design("Dice · compact rattle and arcade pulse", 440, "pulse", "dice", [0, 7, 5, 12], .10, 127),
  roulette: design("Roulette · wheel ticks and casino bells", 523.25, "bell", "wheel", [0, 4, 7, 16], .15, 139),
  baccarat: design("Baccarat · soft felt and glass notes", 349.23, "glass", "felt", [0, 7, 14, 16], .21, 149),
  blackjack: design("Blackjack · crisp card snaps", 587.33, "pluck", "paper", [0, 4, 12, 7], .095, 157),
  "teen-patti": design("Teen Patti · wood taps and strings", 329.63, "pluck", "wood", [0, 2, 7, 12, 14], .12, 167),
  "teen-patti-live": design("Teen Patti Live · studio felt and mellow bells", 277.18, "bell", "felt", [0, 5, 9, 12], .18, 179),
  "andar-bahar": design("Andar Bahar · alternating bamboo taps", 493.88, "wood", "bamboo", [0, 7, 2, 9, 12], .13, 191),
  "lucky-7": design("Lucky 7 · chunky dice and seven-note flourish", 698.46, "wood", "dice", [0, 4, 7, 12, 7, 12, 19], .08, 199),
  "dragon-tiger": design("Dragon Tiger · low drums and gong shimmer", 146.83, "bell", "drum", [0, 7, 10, 12], .24, 211),
  rummy: design("Rummy · paper shuffle and harp plucks", 293.66, "pluck", "paper", [0, 5, 9, 14, 17], .145, 223),
  "vegetable-bowl": design("Vegetable Bowl · basket taps and harvest pops", 349.23, "wood", "harvest", [0, 2, 4, 7, 9, 12], .105, 227),
  "horse-racing": design("Horse Racing · hoof rhythm and finish brass", 174.61, "brass", "hoof", [0, 5, 7, 12, 17], .13, 239),
  "bike-racing": design("Bike Racing · motor pulses and grid beeps", 207.65, "pulse", "motor", [0, 12, 10, 19], .09, 251),
  wingo: design("Colour Trading · liquid synth and colour chimes", 466.16, "glass", "digital", [0, 4, 9, 12, 16], .115, 263),
  "lottery-2d": design("2D Lottery · ticket stamp and two-note chime", 415.3, "pluck", "paper", [0, 12], .16, 277),
  "lottery-3d": design("3D Lottery · rolling numbers and three-note chime", 311.13, "bell", "wheel", [0, 7, 12], .14, 281),
  "lottery-titli": design("Titli · flutter and garden bells", 783.99, "glass", "harvest", [0, 2, 9, 14], .12, 293),
  "forex-trading": design("Aurum Trading · market bells and coin clicks", 329.63, "bell", "digital", [0, 4, 7, 12, 16], .14, 307),
} satisfies Record<string, SoundDesign>;

// Keep the previous sound design for cues without an accessible exact recording.
// Route identity is separate so a new game's recording cannot leak into Mines/JetX.
const COLLECTION_SOUND_FALLBACKS = {
  "chicken-road-2": "mines", "pirate-jackpot-mines": "mines",
  "7up7down": "dice", "duck-duel": "mines", "tower-rush": "mines", "jackpot-fishing": "mines", "coin-flip": "mines",
} as const satisfies Record<string, keyof typeof GAME_SOUND_DESIGNS>;
export type GameAudioId = keyof typeof GAME_SOUND_DESIGNS | keyof typeof COLLECTION_SOUND_FALLBACKS;
export type GameSoundCue = "idle" | "select" | "bet" | "clear" | "deal" | "reveal" | "roll" | "impact" | "settle" | "win" | "lose" | "launch" | "crash" | "engine" | "music" | "tick";
export function isGameAudioId(value: string): value is GameAudioId {
  return Object.prototype.hasOwnProperty.call(GAME_SOUND_DESIGNS, value) || Object.prototype.hasOwnProperty.call(COLLECTION_SOUND_FALLBACKS, value);
}
export function audioGameForRoute(route: string): GameAudioId | null {
  const name = route.replace(/\/$/, "").slice(1);
  if (name === "play") return "lunar";
  if (name === "lunar-colour-trading") return "wingo";
  if (name === "lottery") return "lottery-2d";
  if (name === "prize-lotto") return "lottery-3d";
  return isGameAudioId(name) ? name : null;
}
export const CRASH_AUDIO_GAMES = new Set<GameAudioId>(["lunar", "aviator", "jetx", "fury"]);
const TAU = Math.PI * 2;
const RATE = 24000;
const tone = (phase: number, instrument: Instrument, t: number) => {
  const s = Math.sin(phase);
  switch (instrument) {
    case "bell": return s * .62 + Math.sin(phase * 2.756) * Math.exp(-t * 9) * .25 + Math.sin(phase * 5.404) * Math.exp(-t * 16) * .13;
    case "glass": return s * .6 + Math.sin(phase * 2) * .22 + Math.sin(phase * 4.01) * Math.exp(-t * 12) * .18;
    case "wood": return s * .65 + Math.sin(phase * 3.97) * Math.exp(-t * 30) * .35;
    case "pluck": return s * .6 + Math.sin(phase * 2) * Math.exp(-t * 16) * .25 + Math.sin(phase * 3) * Math.exp(-t * 22) * .15;
    case "brass": return s * .6 + Math.sin(phase * 2) * .25 + Math.sin(phase * 3) * .1 + Math.sin(phase * 4) * .05;
    case "pulse": return s * .7 + Math.sin(phase * 3) * .2 + Math.sin(phase * 5) * .1;
    case "air": return s * .75 + Math.sin(phase * 1.005) * .25;
  }
};

/** Deterministic PCM also makes every design exportable and testable offline. */
export function renderGameSound(game: GameAudioId, cue: GameSoundCue, rate = RATE): Float32Array {
  if (game === "fury") {
    const samples = renderFurySound(cue, rate);
    if (samples) return samples;
  }
  if (game === "chicken-road-pirate") return renderPirateSound(cue, rate);
  if (game === "chicken-road" && (cue === "idle" || cue === "bet" || cue === "reveal" || cue === "win" || cue === "crash")) {
    return renderChickenSound(cue, rate);
  }
  const fallback = COLLECTION_SOUND_FALLBACKS[game as keyof typeof COLLECTION_SOUND_FALLBACKS];
  const p = GAME_SOUND_DESIGNS[fallback ?? game as keyof typeof GAME_SOUND_DESIGNS];
  const loop = cue === "engine" || cue === "music";
  const duration = cue === "music" ? p.beat * 32 : cue === "engine" ? 2 : cue === "win" ? p.melody.length * p.beat + .65 : cue === "roll" ? .65 : cue === "launch" || cue === "crash" ? .8 : cue === "lose" ? .55 : cue === "deal" ? .16 : cue === "reveal" || cue === "bet" ? .3 : .12;
  const data = new Float32Array(Math.ceil(duration * rate));
  let seed = p.seed;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 2147483648 - 1; };
  const note = (start: number, frequency: number, length: number, volume: number, instrument = p.instrument, end = frequency) => {
    let phase = 0;
    for (let i = 0; i < Math.floor(length * rate); i++) {
      const at = Math.floor(start * rate) + i;
      if (at >= data.length && !loop) break;
      const t = i / rate, x = t / length;
      phase += TAU * (frequency * Math.pow(end / frequency, x)) / rate;
      const env = Math.min(1, t / .006) * Math.exp(-4 * x) * Math.min(1, (length - t) / .035);
      data[at % data.length] += tone(phase, instrument, t) * env * volume;
    }
  };
  const foley = (start: number, length: number, volume: number) => {
    const soft = ["felt", "sand", "wind", "space"].includes(p.texture);
    const low = ["drum", "hoof", "motor", "fire"].includes(p.texture);
    let filtered = 0;
    for (let i = 0; i < Math.floor(length * rate); i++) {
      const at = Math.floor(start * rate) + i;
      if (at >= data.length) break;
      const t = i / rate, x = t / length, noise = random();
      filtered += (noise - filtered) * (soft ? .08 : low ? .035 : .48);
      const texture = soft || low ? filtered : noise - filtered;
      const body = Math.sin(TAU * (low ? 95 : p.root * .7) * t * (1 - .25 * x));
      data[at] += (texture * .65 + body * (soft ? .1 : .35)) * Math.min(1, t / .002) * Math.exp(-6 * x) * Math.min(1, (1 - x) * 15) * volume;
    }
  };
  if (cue === "music") {
    for (let i = 0; i < 16; i++) {
      note(i * p.beat * 2, p.root * Math.pow(2, p.melody[i % p.melody.length] / 12) / 2, .65, .09, "air");
      if (i % 4 === 0) note(i * p.beat * 2, p.root / 4, .9, .08, "air");
    }
  } else if (cue === "engine") {
    // Integer cycle counts make both ends seamless; modulation gives each vehicle its own motion.
    const motor = ["propeller", "motor", "fire", "turbine"].includes(p.texture);
    const base = Math.round((motor ? p.root / 3 : p.root / 2) * 2) / 2;
    const modulation = p.texture === "propeller" ? 22 : p.texture === "turbine" ? 7 : p.texture === "fire" ? 31 : 3;
    for (let i = 0; i < data.length; i++) {
      const t = i / rate;
      data[i] = (Math.sin(TAU * base * t) * .11 + Math.sin(TAU * base * 2 * t) * .045 + Math.sin(TAU * (base * 4 + 1) * t) * .025) * (.7 + .3 * Math.sin(TAU * modulation * t));
    }
  } else if (cue === "win") {
    p.melody.forEach((n, i) => note(i * p.beat, p.root * Math.pow(2, n / 12), .6, .21));
  } else if (cue === "lose") {
    note(0, p.root * .75, .26, .13);
    note(.16, p.root * .5, .36, .11);
  } else if (cue === "launch" || cue === "crash") {
    foley(0, .8, .6);
    note(0, cue === "launch" ? p.root / 2 : p.root * 1.5, .75, .19, p.instrument, cue === "launch" ? p.root * 2 : p.root / 4);
  } else if (cue === "roll") {
    for (let i = 0; i < 7; i++) foley(i * .072, .10, .46 - i * .035);
  } else if (cue === "deal" || cue === "clear") {
    foley(0, duration, .6);
    note(.02, p.root * .7, .09, .08);
  } else if (cue === "impact" || cue === "settle") {
    foley(0, duration, .6);
    note(0, p.root * (cue === "impact" ? .5 : 1), .11, .14);
  } else {
    const frequency = p.root * (cue === "tick" ? 1.5 : cue === "reveal" ? 2 : 1);
    note(0, frequency, duration, cue === "tick" ? .09 : .18);
    if (cue === "bet") note(.075, p.root * Math.pow(2, p.melody[1] / 12), .2, .12);
    if (cue === "select" || cue === "bet") foley(0, .06, .2);
  }
  // Headroom even when several balls/chips land together.
  for (let i = 0; i < data.length; i++) data[i] = Math.tanh(data[i]) * .8;
  return data;
}

// Opening the device after the first tap can take over a second on mobile/Windows.
export const AUDIO_UNLOCK_GRACE_MS = 3000;

/** Bounded decoded cache and polyphony; stopping cancels even future-scheduled sources. */
export class GameSoundBank {
  private buffers = new Map<string, AudioBuffer>();
  private voices = new Set<AudioBufferSourceNode>();
  private last = new Map<string, number>();
  private diceRecordings: Lucky7DiceRecordings | null = null;
  private diceRoll: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private publicSounds: PublicDemoSoundBank;
  private furyHelicopter: FuryHelicopterRecording;
  constructor(private context: AudioContext) {
    this.publicSounds = new PublicDemoSoundBank(context);
    this.furyHelicopter = new FuryHelicopterRecording(context);
  }
  preload(game: GameAudioId) { return game === "fury" ? this.furyHelicopter.preload() : this.publicSounds.preload(game); }
  hasRecording(game: GameAudioId, cue: GameSoundCue) { return game === "fury" && cue === "engine" || this.publicSounds.has(game, cue); }
  ready(game: GameAudioId, cue: GameSoundCue) { return game === "fury" && cue === "engine" ? this.furyHelicopter.ready() : this.publicSounds.ready(game, cue); }
  async prepare(game: GameAudioId, cue: GameSoundCue) {
    if (game === "fury" && cue === "engine") {
      await this.furyHelicopter.preload();
      return this.furyHelicopter.ready();
    }
    return this.publicSounds.prepare(game, cue);
  }
  preloadDice(): Promise<void> {
    this.diceRecordings ??= new Lucky7DiceRecordings(this.context);
    return this.diceRecordings.preload();
  }
  stopDiceRoll() {
    const roll = this.diceRoll;
    this.diceRoll = null;
    if (!roll) return;
    const now = this.context.currentTime;
    roll.gain.gain.setTargetAtTime(0, now, .008);
    try { roll.source.stop(now + .04); } catch { /* Already settled. */ }
  }
  play(game: GameAudioId, cue: GameSoundCue, destination: AudioNode, volume = 1, loop = false): AudioBufferSourceNode | null {
    if (this.context.state !== "running") return null;
    // Fury's rotor continues across takeoff and stops with the round. No
    // overlapping generated launch or fly-away effect is needed.
    if (game === "fury" && (cue === "launch" || cue === "crash")) return null;
    if (!this.ready(game, cue)) { void this.prepare(game, cue); return null; }
    const recording = this.publicSounds.take(game, cue);
    const key = `${game}:${cue}`;
    const now = this.context.currentTime;
    if (!loop && now - (this.last.get(key) ?? -Infinity) < (cue === "impact" ? .045 : .06)) return null;
    this.last.set(key, now);
    const diceCue = game === "lucky-7" && (cue === "roll" || cue === "impact" || cue === "settle");
    const helicopter = game === "fury" && cue === "engine";
    let buffer = helicopter ? this.furyHelicopter.take() : recording?.buffer ?? (diceCue ? this.diceRecordings?.take(cue) : this.buffers.get(key));
    if (helicopter && !buffer) return null;
    if (diceCue && !buffer) {
      void this.preloadDice();
      return null; // A slow download must not produce percussion or replay a late roll.
    }
    if (!buffer) {
      const samples = renderGameSound(game, cue);
      buffer = this.context.createBuffer(1, samples.length, RATE);
      buffer.getChannelData(0).set(samples);
      this.buffers.set(key, buffer);
      if (this.buffers.size > 48) this.buffers.delete(this.buffers.keys().next().value!);
    }
    const source = this.context.createBufferSource(), gain = this.context.createGain();
    source.buffer = buffer;
    source.loop = loop;
    gain.gain.value = Math.max(0, Math.min(1, volume)) * (recording ? .65 : 1);
    if (game === "fury" && loop && cue === "engine") {
      const level = gain.gain.value;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(level, now + .4);
    }
    source.connect(gain); gain.connect(destination);
    source.onended = () => {
      if (this.diceRoll?.source === source) this.diceRoll = null;
      this.voices.delete(source); source.disconnect(); gain.disconnect();
    };
    if (diceCue) { this.stopDiceRoll(); this.diceRoll = { source, gain }; }
    if (!loop) {
      if (this.voices.size >= 12) { const oldest = this.voices.values().next().value!; oldest.stop(); this.voices.delete(oldest); }
      this.voices.add(source);
    }
    if (recording?.clip.duration !== undefined) source.start(0, recording.clip.offset ?? 0, recording.clip.duration);
    else source.start();
    return source;
  }
  stop() {
    for (const source of this.voices) { try { source.stop(); } catch { /* already ended */ } }
    this.voices.clear(); this.last.clear();
    this.diceRoll = null;
  }
}
