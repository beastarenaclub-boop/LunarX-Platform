import type { GameSoundCue } from "./gameSoundDesign";

const TAU = Math.PI * 2;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
const DURATIONS = { select: .09, bet: .26, clear: .14, tick: .08, win: .86 };

/** Short UI confirmations; aircraft audio uses the real helicopter recording. */
export function renderFurySound(cue: GameSoundCue, rate: number): Float32Array | null {
  if (!(cue in DURATIONS)) return null;
  const duration = DURATIONS[cue as keyof typeof DURATIONS];
  const count = Math.ceil(duration * rate);
  const data = new Float32Array(count);
  let seed = 7319, low = 0, air = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / rate;
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    const noise = (seed >>> 0) / 2147483648 - 1;
    low += (noise - low) * (1 - Math.exp(-TAU * 180 / rate));
    air += (noise - air) * (1 - Math.exp(-TAU * 1700 / rate));
    const wind = air - low;
    let sample = 0;
    if (cue === "win") {
      // A brief coin/bell confirmation leaves the flight engine audible.
      for (const [start, hz, level] of [[0, 1046.5, .17], [.095, 1318.5, .15], [.19, 1568, .14]]) {
        const age = t - start;
        if (age >= 0) sample += (Math.sin(TAU * hz * age) + .2 * Math.sin(TAU * hz * 2.76 * age)) * level * smooth(age / .004) * Math.exp(-age * 8.5);
      }
      sample *= 1 - smooth((t - .68) / .18);
    } else {
      const hz = cue === "bet" ? 740 : cue === "tick" ? 1240 : cue === "clear" ? 430 : 900;
      sample = (Math.sin(TAU * hz * t) * .13 + wind * (cue === "bet" ? .2 : .09)) * smooth(t / .003) * Math.exp(-t * (cue === "bet" ? 24 : 48));
      if (cue === "bet" && t > .065) sample += Math.sin(TAU * 1110 * (t - .065)) * .09 * smooth((t - .065) / .003) * Math.exp(-(t - .065) * 27);
      sample *= 1 - smooth((t - duration * .7) / (duration * .3));
    }
    data[i] = Math.tanh(sample) * .8;
  }
  return data;
}

/** Engine speed follows public takeoff/climb time, never the hidden result. */
export function furyEngineRate(flyMs: number) {
  const elapsed = Number.isFinite(flyMs) ? Math.max(0, flyMs) : 0;
  // Keep the recorded rotor close to its natural pitch at every flight speed.
  return .96 + .04 * smooth(elapsed / 1400) + .02 * smooth((elapsed - 1400) / 6000);
}
