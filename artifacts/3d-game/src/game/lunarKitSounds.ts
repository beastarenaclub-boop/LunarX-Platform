import click from "../assets/audio/lunar-kit/click.mp3?url";
import takeoff from "../assets/audio/lunar-kit/takeoff.mp3?url";
import flyAway from "../assets/audio/lunar-kit/flyAway.mp3?url";
import cashout from "../assets/audio/lunar-kit/cashout.mp3?url";
import ambient from "../assets/audio/lunar-kit/ambient.mp3?url";

/** The supplied kit's recordings, used only by canonical game code `lunar`. */
export const LUNAR_KIT_SOUNDS: Record<string, string> = {
  select: click, bet: click, clear: click,
  launch: takeoff, crash: flyAway, win: cashout, music: ambient,
};

export class LunarKitSoundBank {
  private buffers = new Map<string, AudioBuffer>();
  private pending = new Map<string, Promise<void>>();
  private retryAfter = new Map<string, number>();
  constructor(private context: AudioContext) {}

  has(cue: string) { return Boolean(LUNAR_KIT_SOUNDS[cue]); }
  ready(cue: string) { return !this.has(cue) || this.buffers.has(LUNAR_KIT_SOUNDS[cue]); }
  async prepare(cue: string) {
    const url = LUNAR_KIT_SOUNDS[cue];
    if (!url || this.buffers.has(url)) return true;
    if (Date.now() < (this.retryAfter.get(url) ?? 0)) return false;
    let loading = this.pending.get(url);
    if (!loading) {
      loading = fetch(url).then(async response => {
        if (!response.ok) throw new Error("Lunar audio unavailable");
        const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
        this.buffers.set(url, buffer);
        this.retryAfter.delete(url);
      }).catch(() => {
        this.retryAfter.set(url, Date.now() + 10000);
      }).finally(() => { this.pending.delete(url); });
      this.pending.set(url, loading);
    }
    await loading;
    return this.ready(cue);
  }
  async preload() {
    // Background music is decoded only when the player's Music setting allows it.
    await Promise.all(["select", "launch", "crash", "win"].map(cue => this.prepare(cue)));
  }
  take(cue: string): { buffer: AudioBuffer; clip: { file: string; offset?: number; duration?: number } } | null {
    const file = LUNAR_KIT_SOUNDS[cue], buffer = this.buffers.get(file);
    return buffer ? { buffer, clip: { file } } : null;
  }
}
