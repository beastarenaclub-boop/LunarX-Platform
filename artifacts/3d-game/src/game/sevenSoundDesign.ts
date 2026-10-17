import chip1 from "../assets/audio/table/tp-chip-place-1.mp3?url";
import chip2 from "../assets/audio/table/tp-chip-place-2.mp3?url";
import chip3 from "../assets/audio/table/tp-chip-place-3.mp3?url";
import stack from "../assets/audio/table/tp-chip-stack.mp3?url";
import scoop from "../assets/audio/table/tp-chip-scoop.mp3?url";
import dice from "../assets/audio/lucky7/roll-1.wav?url";
import { PublicDemoSoundBank } from "./publicDemoSounds";

export type SevenSound = "select" | "chip" | "stack" | "undo" | "clear" | "confirm" | "open" | "close" | "tick" | "lastTick" | "lock" | "land" | "down" | "seven" | "up" | "win" | "lose" | "error" | "roundOpen" | "shake";
const RATE = 24000;
const durations: Record<SevenSound, number> = { select: .075, chip: .10, stack: .22, undo: .16, clear: .28, confirm: .34, open: .14, close: .13, tick: .075, lastTick: .16, lock: .30, land: .22, down: .40, seven: .62, up: .40, win: 1.15, lose: .44, error: .22, roundOpen: .48, shake: .72 };

/** Short original table cues, plus a download-free fallback for the CC0 foley. */
export function renderSevenSound(cue: SevenSound): Float32Array {
  const data = new Float32Array(Math.ceil(durations[cue] * RATE));
  const note = (start: number, frequency: number, length: number, level: number, bell = false) => {
    for (let i = 0; i < length * RATE; i++) {
      const at = Math.floor(start * RATE) + i;
      if (at >= data.length) break;
      const t = i / RATE, phase = 2 * Math.PI * frequency * t;
      const envelope = Math.min(1, t / .003) * Math.exp(-t / (length * .25)) * Math.min(1, (length - t) / .012);
      data[at] += (Math.sin(phase) + (bell ? .25 * Math.sin(phase * 2.76) : .12 * Math.sin(phase * 2))) * envelope * level;
    }
  };
  let seed = 7127;
  const clack = (start: number, level: number, pitch = 1700) => {
    for (let i = 0; i < .065 * RATE; i++) {
      const at = Math.floor(start * RATE) + i;
      if (at >= data.length) break;
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      const t = i / RATE, noise = (seed >>> 0) / 2147483648 - 1;
      data[at] += (noise * .55 + Math.sin(2 * Math.PI * pitch * t) * .45) * Math.min(1, t / .0015) * Math.exp(-t * 105) * level;
    }
  };
  const chime = (frequencies: number[], beat: number, level = .28) => frequencies.forEach((frequency, i) => note(i * beat, frequency, .32, level, true));
  switch (cue) {
    case "select": clack(0, .23, 2400); break;
    case "chip": clack(0, .54); clack(.027, .23, 2250); break;
    case "stack": [0, .03, .065, .105].forEach(t => clack(t, .36, 1900 + t * 2000)); break;
    case "undo": clack(0, .35, 1200); clack(.06, .20, 900); break;
    case "clear": [0, .045, .10, .15].forEach((t, i) => clack(t, .38 - i * .065, 1300 - i * 170)); break;
    case "confirm": chime([660, 990], .10, .24); break;
    case "open": note(0, 540, .1, .16); note(.04, 810, .1, .13); break;
    case "close": note(0, 710, .09, .14); note(.035, 470, .095, .12); break;
    case "tick": note(0, 1100, .07, .20); break;
    case "lastTick": note(0, 1480, .13, .25); break;
    case "lock": note(0, 550, .24, .22); note(.08, 410, .18, .17); break;
    case "land": clack(0, .65, 1000); clack(.032, .52, 1450); clack(.10, .2, 1900); break;
    case "down": chime([784, 587], .1, .23); break;
    case "up": chime([587, 784], .1, .23); break;
    case "seven": chime([659, 831, 988, 1318], .08, .25); break;
    case "win": chime([523, 659, 784, 1047, 1319, 1568], .115, .26); note(.52, 1047, .6, .13, true); break;
    case "lose": note(0, 370, .25, .13); note(.14, 294, .29, .11); break;
    case "error": note(0, 230, .10, .14); note(.12, 230, .1, .12); break;
    case "roundOpen": chime([523, 784, 1047], .09, .20); break;
    case "shake": [0, .041, .109, .153, .235, .30, .335, .422, .479, .541, .61].forEach((t, i) => clack(t, .38 + i % 3 * .07, 1200 + i % 4 * 320)); break;
  }
  for (let i = 0; i < data.length; i++) data[i] = Math.tanh(data[i]) * .8;
  return data;
}

/** Existing CC0 chip/dice recordings; licenses live beside the source assets. */
export class SevenSoundBank {
  private recorded = new Map<string, AudioBuffer>();
  private generated = new Map<SevenSound, AudioBuffer>();
  private voices = new Set<AudioBufferSourceNode>();
  private loading: Promise<void> | null = null;
  private nextChip = 0;
  private last = new Map<SevenSound, number>();
  private announcement: AudioBufferSourceNode | null = null;
  private publicSounds: PublicDemoSoundBank;
  constructor(private context: AudioContext) { this.publicSounds = new PublicDemoSoundBank(context); }
  ready(cue: SevenSound) { return this.publicSounds.ready("7up7down", cue); }
  prepare(cue: SevenSound) { return this.publicSounds.prepare("7up7down", cue); }
  preload() {
    const exact = this.publicSounds.preload("7up7down");
    this.loading ??= Promise.all(Object.entries({ chip1, chip2, chip3, stack, scoop, dice }).map(async ([name, url]) => {
      try {
        const response = await fetch(url);
        if (response.ok) this.recorded.set(name, await this.context.decodeAudioData(await response.arrayBuffer()));
      } catch { /* Immediate original foley remains available offline. */ }
    })).then(() => {});
    return Promise.all([exact, this.loading]).then(() => {});
  }
  play(cue: SevenSound, destination: AudioNode, volume = 1, loop = false) {
    const now = this.context.currentTime;
    if (this.context.state !== "running" || (!loop && now - (this.last.get(cue) ?? -Infinity) < .045)) return null;
    if (!this.ready(cue)) { void this.prepare(cue); return null; }
    const exact = this.publicSounds.take("7up7down", cue);
    this.last.set(cue, now);
    const recorded = cue === "chip" ? `chip${this.nextChip++ % 3 + 1}` : cue === "stack" ? "stack" : cue === "clear" || cue === "undo" ? "scoop" : cue === "shake" ? "dice" : "";
    let buffer = exact?.buffer ?? this.recorded.get(recorded) ?? this.generated.get(cue);
    if (!buffer) {
      const samples = renderSevenSound(cue);
      buffer = this.context.createBuffer(1, samples.length, RATE);
      buffer.getChannelData(0).set(samples); this.generated.set(cue, buffer);
    }
    const source = this.context.createBufferSource(), gain = this.context.createGain();
    if (exact && ["lock", "roundOpen", "lastTick"].includes(cue)) {
      try { this.announcement?.stop(); } catch { /* Already finished. */ }
      this.announcement = source;
    }
    source.buffer = buffer; source.loop = loop;
    if (loop && this.recorded.has(recorded)) { source.loopStart = .02; source.loopEnd = Math.min(.82, buffer.duration); }
    if (cue === "undo" && !exact) source.playbackRate.value = 1.7;
    gain.gain.value = Math.min(1, Math.max(0, volume)) * (exact ? .65 : 1);
    source.connect(gain); gain.connect(destination);
    if (this.voices.size >= 10) { const oldest = [...this.voices].find(voice => !voice.loop); try { oldest?.stop(); } catch { /* Finished between events. */ } }
    this.voices.add(source);
    source.onended = () => { if (this.announcement === source) this.announcement = null; this.voices.delete(source); source.disconnect(); gain.disconnect(); };
    const delay = ["down", "seven", "up"].includes(cue) ? .17 : cue === "win" || cue === "lose" ? .45 : 0;
    source.start(now + delay);
    return source;
  }
  stop() {
    for (const voice of this.voices) { try { voice.stop(); } catch { /* Already ended. */ } }
    this.voices.clear(); this.last.clear();
    this.announcement = null;
  }
}
