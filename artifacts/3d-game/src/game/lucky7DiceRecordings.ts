const urls = import.meta.glob("../assets/audio/lucky7/roll-*.wav", {
  eager: true, query: "?url", import: "default",
}) as Record<string, string>;
const clips = ["roll-1", "roll-2", "roll-3"];

/** Complete two-dice rolls: retain the irregular clatter and natural settling tail. */
export class Lucky7DiceRecordings {
  private buffers = new Map<string, AudioBuffer>();
  private pending: Promise<void> | null = null;
  private next = 0;
  constructor(private context: AudioContext) {}

  preload(): Promise<void> {
    return this.pending ??= Promise.all(Object.entries(urls).map(async ([file, url]) => {
      const name = file.split("/").pop()!.replace(/\.wav$/, "");
      if (this.buffers.has(name)) return;
      try {
        const response = await fetch(url);
        if (!response.ok) return;
        this.buffers.set(name, await this.context.decodeAudioData(await response.arrayBuffer()));
      } catch { /* Skip unavailable foley; never replace dice with a synthesized drum. */ }
    })).then(() => { this.pending = null; });
  }

  take(cue: string): AudioBuffer | undefined {
    if (cue !== "roll") return;
    const index = this.next++ % clips.length;
    return this.buffers.get(clips[index]) ?? clips.map(name => this.buffers.get(name)).find(Boolean);
  }
}
