import rotorUrl from "../assets/audio/fury/helicopter-rotor.wav?url";

/** Real CC0 Chinook field recording, trimmed and crossfaded locally. */
export class FuryHelicopterRecording {
  private buffer: AudioBuffer | null = null;
  private pending: Promise<void> | null = null;
  private retryAfter = 0;
  constructor(private context: AudioContext) {}

  ready() { return this.buffer !== null; }
  take() { return this.buffer; }
  preload(): Promise<void> {
    if (this.buffer || Date.now() < this.retryAfter) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = fetch(rotorUrl).then(async response => {
      if (!response.ok) throw new Error("Helicopter recording unavailable");
      this.buffer = await this.context.decodeAudioData(await response.arrayBuffer());
      this.retryAfter = 0;
    }).catch(() => {
      // Stay quiet on a failed download; never substitute a synthetic motor.
      this.retryAfter = Date.now() + 10000;
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
}
