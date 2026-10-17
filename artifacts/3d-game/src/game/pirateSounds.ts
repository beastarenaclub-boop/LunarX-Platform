import type { GameSoundCue } from "./gameSoundDesign";

/** Original Pirate Edition score and foley, synthesized locally without downloads. */
const TAU = Math.PI * 2;
const EIGHTH = .22;
const MUSIC_LENGTH = EIGHTH * 48; // Eight bars of a lilting 6/8 sea shanty.
const lengths: Record<GameSoundCue, number> = {
  idle: .42, select: .12, bet: .68, clear: .4, deal: .18, reveal: .62,
  roll: .65, impact: .24, settle: .28, win: 1.65, lose: .85,
  launch: .55, crash: 1.15, engine: 4, music: MUSIC_LENGTH, tick: .09,
};

export function renderPirateSound(cue: GameSoundCue, rate: number): Float32Array {
  const data = new Float32Array(Math.round(lengths[cue] * rate));
  const loop = cue === "music" || cue === "engine";
  let seed = 719;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 2147483648 - 1;
  };
  const mix = (start: number, length: number, sample: (t: number, x: number) => number) => {
    const offset = Math.round(start * rate), count = Math.round(length * rate);
    for (let i = 0; i < count; i++) {
      const at = offset + i;
      if (!loop && at >= data.length) break;
      data[at % data.length] += sample(i / rate, i / count);
    }
  };
  const envelope = (t: number, x: number, length: number, decay = 4) =>
    Math.min(1, t / .008) * Math.exp(-decay * x) * Math.min(1, (length - t) / .025);
  const note = (start: number, length: number, pitch: number, volume: number, instrument: "pluck" | "bell" | "flute" | "wood" = "pluck", end = pitch) => {
    let phase = 0;
    mix(start, length, (t, x) => {
      phase += TAU * pitch * Math.pow(end / pitch, x) * (instrument === "flute" ? 1 + .004 * Math.sin(TAU * 5 * t) : 1) / rate;
      let body = Math.sin(phase);
      if (instrument === "bell") body += .35 * Math.sin(phase * 2.756) * Math.exp(-10 * t) + .12 * Math.sin(phase * 5.404) * Math.exp(-20 * t);
      if (instrument === "pluck") body += .32 * Math.sin(phase * 2) * Math.exp(-12 * t) + .14 * Math.sin(phase * 3) * Math.exp(-20 * t);
      if (instrument === "wood") body += .5 * Math.sin(phase * 3.91) * Math.exp(-38 * t);
      if (instrument === "flute") body += .14 * Math.sin(phase * 2) + .045 * Math.sin(phase * 3);
      return body * volume * envelope(t, x, length, instrument === "flute" ? 1.3 : 4.5);
    });
  };
  const rustle = (start: number, length: number, volume: number, splash = false) => {
    let low = 0, smooth = 0;
    mix(start, length, (t, x) => {
      low += (random() - low) * (splash ? .32 : .16);
      smooth += (low - smooth) * .045;
      return (low - smooth) * volume * Math.min(1, t / .014) * Math.exp(-3 * x) * Math.sin(Math.PI * x);
    });
  };
  const cluck = (start: number, length: number, pitch: number, volume: number) => {
    let phase = 0, breath = 0;
    mix(start, length, (t, x) => {
      const bend = .8 + .48 * Math.exp(-(((x - .18) / .16) ** 2)) - .24 * x;
      phase += TAU * pitch * bend * (1 + .025 * Math.sin(TAU * 29 * t)) / rate;
      breath += (random() - breath) * .24;
      const voice = .56 * Math.sin(phase + .8 * Math.sin(phase * 2)) + .25 * Math.sin(phase * 2) + .13 * Math.sin(phase * 3) + .06 * Math.sin(phase / 2);
      return (voice + breath * .12) * volume * Math.min(1, t / .01) * Math.pow(Math.sin(Math.PI * x), .8) * Math.exp(-x);
    });
  };
  const coins = (start: number, count: number, volume: number) => {
    for (let i = 0; i < count; i++) {
      note(start + i * .068, .24, [1174.66, 1567.98, 1760, 2349.32][i % 4], volume, "bell");
      rustle(start + i * .068, .045, volume * .6);
    }
  };
  const ocean = () => {
    // Periodic components and modulation keep the water bed seamless at the loop boundary.
    for (let harmonic = 0; harmonic < 28; harmonic++) {
      const cycles = Math.round((85 + harmonic * 67.3) * lengths[cue]);
      const phase = random() * Math.PI;
      const volume = .0035 / (1 + harmonic * .15);
      mix(0, lengths[cue], (_t, x) =>
        Math.sin(TAU * cycles * x + phase) * volume * (.65 + .35 * Math.sin(TAU * 2 * x)));
    }
  };

  switch (cue) {
    case "music": {
      ocean();
      const melody = [0, 3, 7, 7, 5, 3, 0, 3, 7, 10, 7, 5, -2, 2, 5, 5, 3, 2, -2, 2, 5, 9, 5, 2,
        0, 3, 7, 12, 10, 7, 5, 3, 0, 3, 5, 7, -2, 2, 5, 9, 7, 5, 3, 2, 0, -2, 0, 0];
      const roots = [146.83, 146.83, 130.81, 130.81, 146.83, 174.61, 110, 146.83];
      for (let i = 0; i < melody.length; i++) {
        const at = i * EIGHTH, root = roots[Math.floor(i / 6)];
        note(at, EIGHTH * 1.7, 587.33 * 2 ** (melody[i] / 12), .11, "flute");
        if (i % 3 === 0) {
          note(at, .48, root / 2, .18);
          note(at, .14, 92, .075, "wood", 52);
        } else {
          note(at, .25, root * (i % 3 === 1 ? 2 : 3), .07);
          rustle(at, .08, .09);
        }
        if (i % 6 === 3) note(at, .095, 340, .065, "wood");
      }
      break;
    }
    case "engine": ocean(); break;
    case "idle": cluck(.01, .12, 520, .3); cluck(.18, .2, 440, .25); break;
    case "select": note(0, .11, 740, .27, "wood"); rustle(0, .065, .16); break;
    case "tick": note(0, .08, 988, .17, "wood"); break;
    case "bet":
      coins(0, 2, .15);
      cluck(.09, .14, 565, .42); cluck(.29, .25, 650, .38);
      note(.39, .28, 587.33, .13, "bell"); break;
    case "reveal":
    case "launch":
      note(0, .25, 390, .24, "flute", 850);
      rustle(.025, .16, .36); rustle(.17, .12, .22);
      cluck(.08, .14, 620, .21);
      // Land with the character's 550ms hop, not before the server accepts it.
      note(.48, .13, 165, .3, "wood"); rustle(.48, .12, .16); break;
    case "crash":
      note(0, .13, 120, .42, "wood", 65); rustle(.01, .13, .6);
      cluck(.08, .35, 830, .45);
      rustle(.25, .75, 1.15, true);
      note(.34, .3, 170, .27, "flute", 48);
      [0, 1, 2, 3].forEach(i => note(.6 + i * .09, .16, 320 + i * 115, .1, "flute", 600 + i * 180));
      break;
    case "win":
      cluck(.01, .12, 585, .26); cluck(.18, .2, 690, .27);
      coins(.12, 8, .16);
      [587.33, 698.46, 880, 1174.66].forEach((pitch, i) => note(.38 + i * .19, .58, pitch, .23, "bell"));
      break;
    case "clear": coins(.015, 3, .17); note(.13, .24, 293.66, .13); break;
    case "lose": note(0, .42, 440, .18, "flute", 293.66); note(.3, .5, 220, .16); break;
    case "roll": for (let i = 0; i < 6; i++) { note(i * .08, .12, 180 + i * 37, .22, "wood"); rustle(i * .08, .11, .23); } break;
    case "deal": rustle(0, .17, .5); note(.05, .1, 330, .12, "wood"); break;
    case "impact": note(0, .22, 160, .38, "wood", 80); rustle(0, .14, .28); break;
    case "settle": note(0, .12, 196, .22, "wood"); note(.1, .16, 294, .16, "wood"); break;
  }
  for (let i = 0; i < data.length; i++) data[i] = Math.tanh(data[i]) * .8;
  return data;
}
