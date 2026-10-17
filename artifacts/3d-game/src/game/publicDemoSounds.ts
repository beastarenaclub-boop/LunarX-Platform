import manifest from "../assets/audio/public-demo/manifest.json";

export { manifest as PUBLIC_DEMO_AUDIO_MANIFEST };
export interface RecordedCue { file: string; offset?: number; duration?: number }
type CueMap = Record<string, RecordedCue | RecordedCue[]>;
const games: Record<string, CueMap> = { ...manifest.games, "7up7down": manifest.seven };
export function hasPublicDemoSound(game: string, cue?: string) { return Boolean(cue ? games[game]?.[cue] : games[game]); }
const urls = import.meta.glob("../assets/audio/public-demo/**/*.mp3", {
  eager: true, query: "?url", import: "default",
}) as Record<string, string>;
const CACHE_BYTES = 64 * 1024 * 1024;

/** Exact public-demo files. Sprite offsets come from each provider's own cue table. */
export class PublicDemoSoundBank {
  private buffers = new Map<string, AudioBuffer>();
  private pending = new Map<string, Promise<void>>();
  private retryAfter = new Map<string, number>();
  private variants = new Map<string, number>();
  private bytes = 0;
  constructor(private context: AudioContext) {}

  clips(game: string, cue: string): RecordedCue[] {
    const clip = games[game]?.[cue];
    return clip ? Array.isArray(clip) ? clip : [clip] : [];
  }
  has(game: string, cue: string) { return this.clips(game, cue).length > 0; }
  ready(game: string, cue: string) { return this.clips(game, cue).every(c => this.buffers.has(c.file)); }
  async prepare(game: string, cue: string) {
    await Promise.all(this.clips(game, cue).map(c => this.load(c.file)));
    return this.ready(game, cue);
  }
  async preload(game: string) {
    // Music stays lazy: visiting a game must not download or start its soundtrack.
    await Promise.all(Object.keys(games[game] ?? {}).filter(c => c !== "music").map(c => this.prepare(game, c)));
  }
  take(game: string, cue: string): { buffer: AudioBuffer; clip: RecordedCue } | null {
    const clips = this.clips(game, cue);
    if (!clips.length) return null;
    const key = `${game}:${cue}`, index = this.variants.get(key) ?? 0;
    const clip = clips[index % clips.length], buffer = this.buffers.get(clip.file);
    if (!buffer) return null;
    this.variants.set(key, index + 1);
    this.buffers.delete(clip.file); this.buffers.set(clip.file, buffer);
    return { buffer, clip };
  }
  private load(file: string): Promise<void> {
    if (this.buffers.has(file) || Date.now() < (this.retryAfter.get(file) ?? 0)) return Promise.resolve();
    const pending = this.pending.get(file);
    if (pending) return pending;
    const url = urls[`../assets/audio/public-demo/${file}`];
    if (!url) return Promise.resolve();
    const loading = fetch(url).then(async response => {
      if (!response.ok) throw new Error("Audio file unavailable");
      const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
      const bytes = buffer.length * buffer.numberOfChannels * 4;
      while (this.bytes + bytes > CACHE_BYTES && this.buffers.size) {
        const oldest = this.buffers.keys().next().value!;
        const old = this.buffers.get(oldest)!;
        this.bytes -= old.length * old.numberOfChannels * 4; this.buffers.delete(oldest);
      }
      this.buffers.set(file, buffer); this.bytes += bytes; this.retryAfter.delete(file);
    }).catch(() => {
      // Do not substitute a generated sound or play an old event after a failed load.
      this.retryAfter.set(file, Date.now() + 10000);
    }).finally(() => { this.pending.delete(file); });
    this.pending.set(file, loading);
    return loading;
  }
}
