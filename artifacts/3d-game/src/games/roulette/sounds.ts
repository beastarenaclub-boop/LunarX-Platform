/**
 * The nine game sounds.
 *
 * Volume is never set — the source never sets it either, so everything plays at
 * the library default and the mix is the recordings' own. Only one clip loops
 * (`tick_tick`, under the TAKE drain); `bet` overlaps freely, because
 * hold-to-repeat fires every 90 ms against a 104 ms clip.
 *
 * Nothing here throws. A browser that refuses to play before a gesture, a
 * decoder that does not want an ogg, a tab that was backgrounded — all of them
 * are ordinary, and a game screen that fell over because a 75 ms blip would not
 * play would be a much worse defect than silence.
 */
import chipSelectUrl from "@/assets/handoff/roulette/audio/amount_chip_select_button.ogg";
import betUrl from "@/assets/handoff/roulette/audio/bet.ogg";
import looseUrl from "@/assets/handoff/roulette/audio/loose.ogg";
import takeUrl from "@/assets/handoff/roulette/audio/take_button.ogg";
import tickTickUrl from "@/assets/handoff/roulette/audio/tick_tick.wav";
import timerTickUrl from "@/assets/handoff/roulette/audio/timer_tick_from_clock.wav";
import wheelEndUrl from "@/assets/handoff/roulette/audio/wheelEnd.ogg";
import wheelStartUrl from "@/assets/handoff/roulette/audio/wheelStart.ogg";
import winUrl from "@/assets/handoff/roulette/audio/win.ogg";

type Cue =
  | "chipSelect"
  | "bet"
  | "lose"
  | "take"
  | "tickTick"
  | "timerTick"
  | "wheelEnd"
  | "wheelStart"
  | "win";

const URLS: Record<Cue, string> = {
  chipSelect: chipSelectUrl,
  bet: betUrl,
  lose: looseUrl,
  take: takeUrl,
  tickTick: tickTickUrl,
  timerTick: timerTickUrl,
  wheelEnd: wheelEndUrl,
  wheelStart: wheelStartUrl,
  win: winUrl,
};

/**
 * WEB AUDIO on the shared context, not `HTMLAudioElement`s (2026-09-14).
 *
 * Inside a partner's iframe every cue that fires from round state — the clock
 * tick, the spin recording, win, lose, the drain rattle — was refused: an
 * `HTMLAudioElement.play()` outside a gesture is policy-checked per call and
 * per element in a cross-origin frame, so the partner's players heard the
 * chip taps (inside a pointer event) and nothing else. Locally the site's own
 * engagement let it through, which is why it read as a partner-only bug. A
 * buffer source on the ONE AudioContext — resumed once by the engine's
 * gesture unlock, which is armed on every page — starts whenever it is asked
 * to. Same nine files, same cues, no volume set: the mix is the recordings'.
 */
import { sharedAudioContext } from "@/game/audio";

const LOOPING: ReadonlySet<Cue> = new Set<Cue>(["tickTick"]);
/**
 * How late a clip may start after being asked for, while its buffer is still
 * decoding: a chip tap that lands late is worse than one that never lands;
 * the long recordings can afford more.
 */
const LATE_MS: Partial<Record<Cue, number>> = { wheelStart: 2000, tickTick: 2000 };
const DEFAULT_LATE_MS = 400;

const buffers = new Map<Cue, Promise<AudioBuffer | null>>();
const live = new Map<Cue, Set<AudioBufferSourceNode>>();
let muted = false;

function bufferFor(cue: Cue): Promise<AudioBuffer | null> {
  let p = buffers.get(cue);
  if (!p) {
    const c = sharedAudioContext();
    p = c
      ? fetch(URLS[cue])
          .then((r) => r.arrayBuffer())
          .then((data) => c.decodeAudioData(data))
          .catch(() => null)
      : Promise.resolve(null);
    buffers.set(cue, p);
  }
  return p;
}

/**
 * Warm the pool.
 *
 * Called on the first user gesture: that gesture is what resumes the context,
 * and decoding nine clips then means the first spin finds them ready.
 */
export function warmUpRouletteSounds(): void {
  const c = sharedAudioContext();
  if (c && c.state !== "running") void c.resume().catch(() => undefined);
  for (const cue of Object.keys(URLS) as Cue[]) void bufferFor(cue);
}

function shoot(cue: Cue): void {
  if (muted) return;
  const c = sharedAudioContext();
  if (!c) return;
  const asked = performance.now();
  void bufferFor(cue).then((buf) => {
    if (!buf || muted) return;
    if (performance.now() - asked > (LATE_MS[cue] ?? DEFAULT_LATE_MS)) return;
    try {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = LOOPING.has(cue);
      src.connect(c.destination);
      let set = live.get(cue);
      if (!set) live.set(cue, (set = new Set()));
      set.add(src);
      src.onended = () => {
        set!.delete(src);
        try {
          src.disconnect();
        } catch {
          /* already gone */
        }
      };
      src.start();
    } catch {
      // A context mid-interruption (iOS after a call) throws on start. A
      // skipped blip is the right answer; an exception on the render path is
      // not.
    }
  });
}

function stop(cue: Cue): void {
  for (const src of live.get(cue) ?? []) {
    try {
      src.stop();
    } catch {
      /* not started, or already stopped */
    }
  }
  live.get(cue)?.clear();
}

export const rouletteSounds = {
  chipSelect: () => shoot("chipSelect"),
  bet: () => shoot("bet"),
  /** Fired the moment the displayed second changes — not on a fixed schedule. */
  timerTick: () => shoot("timerTick"),
  /** The 7 s spin recording. Cut, not faded, when the ring stops. */
  spinStart: () => shoot("wheelStart"),
  spinStop: () => stop("wheelStart"),
  /** 75 ms, and ONLY for a player with no stake — a staked one hears win/lose instead. */
  wheelEnd: () => shoot("wheelEnd"),
  win: () => shoot("win"),
  lose: () => shoot("lose"),
  take: () => shoot("take"),
  /** Starts on the FIRST drain chunk, not on the press. One recording, not a tick per chunk. */
  drainStart: () => shoot("tickTick"),
  drainStop: () => stop("tickTick"),
  /** Backgrounding cuts everything and nothing resumes on return. */
  muteAll(): void {
    muted = true;
    for (const cue of live.keys()) stop(cue);
  },
  unmute(): void {
    muted = false;
  },
} as const;
