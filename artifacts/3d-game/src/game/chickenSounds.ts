/** Original cartoon hen calls and soft hop effects, rendered locally without downloads. */
type ChickenCue = "idle" | "bet" | "reveal" | "win" | "crash";
const TAU = Math.PI * 2;

export function renderChickenSound(cue: ChickenCue, rate: number): Float32Array {
  const duration = { idle: .36, bet: .56, reveal: .48, win: 1.3, crash: .76 }[cue];
  const data = new Float32Array(Math.ceil(duration * rate));
  let seed = 347;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 2147483648 - 1;
  };
  // Short nasal, throaty syllables with a fast pitch bend and a breathy release.
  // Longer calls add the tremble of a hen's "b'gaawk", rather than a pure beep.
  const cluck = (start: number, length: number, pitch: number, volume: number, squawk = false) => {
    let phase = 0, breath = 0;
    for (let i = 0; i < Math.ceil(length * rate); i++) {
      const at = Math.floor(start * rate) + i;
      if (at >= data.length) break;
      const t = i / rate, x = t / length;
      const bend = .72 + .55 * Math.exp(-Math.pow((x - .15) / .18, 2)) - .23 * x;
      const tremble = 1 + (squawk ? .065 : .025) * Math.sin(TAU * 31 * t);
      phase += TAU * pitch * bend * tremble / rate;
      breath += (noise() - breath) * .42;
      const rasp = Math.sin(phase + .9 * Math.sin(phase * 2)) * .44
        + Math.sin(phase * 2) * .3 + Math.sin(phase * 3) * .16
        + Math.sin(phase * .5) * .1;
      const env = Math.min(1, t / .009) * Math.pow(Math.sin(Math.PI * x), .65)
        * Math.exp(-x * (squawk ? .45 : 1.6));
      const flutter = squawk ? .78 + .22 * Math.sin(TAU * 24 * t) : 1;
      data[at] += (rasp * flutter + breath * (squawk ? .2 : .09)) * env * volume;
    }
  };
  const flap = (start: number, length: number, volume: number) => {
    let low = 0, high = 0;
    for (let i = 0; i < Math.ceil(length * rate); i++) {
      const at = Math.floor(start * rate) + i;
      if (at >= data.length) break;
      const x = i / (length * rate);
      low += (noise() - low) * .3;
      high += (low - high) * .05;
      data[at] += (low - high) * Math.pow(Math.sin(Math.PI * x), 2) * volume;
    }
  };
  const note = (start: number, length: number, frequency: number, volume: number, bell = false) => {
    for (let i = 0; i < Math.ceil(length * rate); i++) {
      const at = Math.floor(start * rate) + i;
      if (at >= data.length) break;
      const t = i / rate, x = t / length;
      const phase = TAU * frequency * t;
      const body = Math.sin(phase) + (bell ? .25 * Math.sin(phase * 2.756) * Math.exp(-12 * t) : 0);
      data[at] += body * Math.min(1, t / .004) * Math.exp(-5 * x)
        * Math.min(1, (length - t) / .025) * volume;
    }
  };

  const hop = (start: number, length: number, volume: number) => {
    let phase = 0;
    for (let i = 0; i < Math.ceil(length * rate); i++) {
      const at = Math.floor(start * rate) + i;
      if (at >= data.length) break;
      const t = i / rate, x = t / length;
      // A rounded rising/falling "boing", with a small spring-like pitch wobble.
      const pitch = 320 + 650 * Math.sin(Math.PI * x) * Math.exp(-1.4 * x)
        + 45 * Math.sin(TAU * 16 * t) * Math.exp(-10 * t);
      phase += TAU * pitch / rate;
      const body = Math.sin(phase) * .88 + Math.sin(phase * 2) * .12 * Math.exp(-8 * t);
      const envelope = Math.min(1, t / .012) * Math.pow(Math.sin(Math.PI * x), 1.2) * Math.exp(-1.4 * x);
      data[at] += body * envelope * volume;
    }
  };

  if (cue === "idle") {
    hop(.01, .24, .3);
    flap(.035, .12, .12);
    flap(.17, .09, .09);
    note(.28, .065, 150, .07);
  } else if (cue === "bet") {
    cluck(0, .12, 570, .48);
    cluck(.16, .14, 650, .5);
    cluck(.34, .2, 490, .46);
  } else if (cue === "reveal") {
    hop(.005, .30, .43);
    flap(.04, .14, .18);
    flap(.19, .11, .14);
    note(.38, .08, 150, .1);
  } else if (cue === "win") {
    cluck(0, .12, 590, .45);
    cluck(.15, .13, 670, .48);
    cluck(.33, .36, 770, .46, true);
    [784, 988, 1175].forEach((pitch, i) => note(.59 + i * .13, .44, pitch, .14, true));
  } else {
    cluck(0, .53, 880, .56, true);
    flap(.035, .17, .34);
    flap(.21, .16, .27);
    flap(.4, .17, .18);
    note(.43, .2, 100, .18);
  }
  // Soft limiting and quiet tails avoid clipping/clicks on small phone speakers.
  for (let i = 0; i < data.length; i++) data[i] = Math.tanh(data[i]) * .8;
  return data;
}
