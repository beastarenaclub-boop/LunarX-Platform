import { sharedAudioContext } from "@/game/audio";
import wheelOgg from "./assets/wheel.ogg";
import wheelMp3 from "./assets/wheel.mp3";
import chipOgg from "./assets/amount_chip_select_button.ogg";
import chipMp3 from "./assets/amount_chip_select_button.mp3";
import betOgg from "./assets/bet.ogg";
import betMp3 from "./assets/bet.mp3";
import winOgg from "./assets/win.ogg";
import winMp3 from "./assets/win.mp3";
import loseOgg from "./assets/loose.ogg";
import loseMp3 from "./assets/loose.mp3";
import takeOgg from "./assets/take_button.ogg";
import takeMp3 from "./assets/take_button.mp3";
import tickWav from "./assets/timer_tick_from_clock.wav";
import drainOgg from "./assets/tick_tick.ogg";
import drainMp3 from "./assets/tick_tick.mp3";

const clips = { wheel: [wheelOgg, wheelMp3], chip: [chipOgg, chipMp3], bet: [betOgg, betMp3],
  win: [winOgg, winMp3], lose: [loseOgg, loseMp3], take: [takeOgg, takeMp3], tick: [tickWav], drain: [drainOgg, drainMp3] };
type Cue = keyof typeof clips;
const priority: Record<Cue, number> = { tick: 0, chip: 1, bet: 1, wheel: 2, win: 2, lose: 2, take: 3, drain: 3 };
let decodedContext: AudioContext | null = null;
const decoded = new Map<Cue, Promise<AudioBuffer | null>>();
type Voice = { cue: Cue; playing: boolean; stop: () => void };
let active: Voice | null = null;
let clock: Voice | null = null;

function load(context: AudioContext, cue: Cue): Promise<AudioBuffer | null> {
  if (decodedContext !== context) { decoded.clear(); decodedContext = context; }
  if (!decoded.has(cue)) decoded.set(cue, (async () => {
    // Original supplied bytes first; MP3 only when the browser needs another codec.
    for (const url of clips[cue]) {
      try {
        const response = await fetch(url);
        if (response.ok) return await context.decodeAudioData(await response.arrayBuffer());
      } catch { /* Try the alternate codec. */ }
    }
    return null;
  })());
  return decoded.get(cue)!;
}

export function stopSounds() { active?.stop(); clock?.stop(); }

/** The clock has its own voice; only playing wheel audio pauses its ticks. */
export function playSound(cue: Cue, enabled: boolean, elapsedMs = 0): () => void {
  const context = enabled ? sharedAudioContext() : null;
  if (!context || context.state === "closed") return () => {};
  if (cue === "tick") {
    if (active?.cue === "wheel" && active.playing) return () => {};
    clock?.stop();
  } else {
    if (active && priority[active.cue] > priority[cue]) return () => {};
    active?.stop();
  }
  const startedAt = performance.now();
  let cancelled = false, source: AudioBufferSourceNode | null = null;
  const voice: Voice = { cue, playing: false, stop: () => {
    cancelled = true; voice.playing = false; source?.stop(); source?.disconnect(); source = null;
    if (active === voice) active = null;
    if (clock === voice) clock = null;
  } };
  if (cue === "tick") clock = voice; else active = voice;
  void load(context, cue).then(buffer => {
    if (cancelled) return;
    if (!buffer || context.state !== "running") { voice.stop(); return; }
    const offset = cue === "wheel" ? Math.max(0, elapsedMs + performance.now() - startedAt) / 1000 : 0;
    if (offset >= buffer.duration) { voice.stop(); return; }
    // A wheel may start while a tick is still decoding.
    if (cue === "tick" && active?.cue === "wheel" && active.playing) { voice.stop(); return; }
    if (cue === "wheel") clock?.stop();
    source = context.createBufferSource(); source.buffer = buffer;
    source.loop = cue === "drain"; source.connect(context.destination);
    source.onended = () => {
      voice.playing = false; source?.disconnect(); source = null;
      if (active === voice) active = null;
      if (clock === voice) clock = null;
    };
    voice.playing = true; source.start(0, offset);
  });
  return voice.stop;
}

export function playWheelSound(enabled: boolean, elapsedMs = 0) { return playSound("wheel", enabled, elapsedMs); }
