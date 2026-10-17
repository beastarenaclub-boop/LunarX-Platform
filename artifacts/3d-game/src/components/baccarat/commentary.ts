import { playDealerAudio, preloadDealerAudio, type DealerAudioHandle } from "@/game/audio";
import type { StudioDeal } from "./studioTimeline";

export const BACCARAT_AUDIO_ROOT = `${import.meta.env.BASE_URL}media/baccarat/audio/`;
export const commentaryLines: Record<string, string> = {
  open: "अपनी बेट लगाइए।",
  closing: "आख़िरी पाँच सेकंड।",
  closed: "बेटिंग बंद। अब कार्ड खुलेंगे।",
  "player-wins": "प्लेयर की जीत।",
  "banker-wins": "बैंकर की जीत।",
  tie: "यह राउंड टाई है।",
  "natural-8": "नेचुरल आठ।",
  "natural-9": "नेचुरल नौ।",
  "player-pair": "प्लेयर पेयर।",
  "banker-pair": "बैंकर पेयर।",
  "both-pairs": "प्लेयर और बैंकर, दोनों पेयर।",
};
for (const side of ["player", "banker"] as const)
  for (let value = 0; value <= 9; value++)
    commentaryLines[`${side}-${value}`] = `${side === "player" ? "प्लेयर" : "बैंकर"}, ${value}।`;

export function resultCommentary(deal: StudioDeal, short = false): string[] {
  const winner = deal.winner === "tie" ? "tie" : `${deal.winner}-wins`;
  if (short) return [winner];
  const clips = [`player-${deal.playerTotal}`, `banker-${deal.bankerTotal}`, winner];
  const high = Math.max(deal.playerTotal, deal.bankerTotal);
  if (deal.natural && high >= 8) clips.push(`natural-${high}`);
  if (deal.playerPair && deal.bankerPair) clips.push("both-pairs");
  else if (deal.playerPair) clips.push("player-pair");
  else if (deal.bankerPair) clips.push("banker-pair");
  return clips;
}

/** A single cancellable voice lane: delayed downloads cannot revive an old round. */
export class BaccaratNarrator {
  private generation = 0;
  private handle: DealerAudioHandle | null = null;
  private finish: (() => void) | null = null;
  private volume = 0;
  constructor(private readonly onLine: (line: string | null) => void) {}

  setVolume(volume: number) {
    this.volume = volume;
    this.handle?.setVolume(volume);
  }

  stop() {
    this.generation++;
    this.handle?.stop();
    this.handle = null;
    this.finish?.();
    this.finish = null;
    this.onLine(null);
  }

  async speak(clips: string[], deadline: number) {
    this.stop();
    const generation = this.generation;
    for (const clip of clips) {
      if (!commentaryLines[clip]) continue;
      const url = `${BACCARAT_AUDIO_ROOT}${clip}.mp3`;
      await preloadDealerAudio(url);
      if (generation !== this.generation) return;
      if (document.hidden || Date.now() >= deadline || this.volume <= 0) {
        this.onLine(null);
        return;
      }
      await new Promise<void>((resolve) => {
        this.finish = resolve;
        this.handle = playDealerAudio(url, 0, Infinity, 1, this.volume, resolve);
        if (this.handle) this.onLine(clip);
        else resolve();
      });
      if (generation !== this.generation) return;
      this.handle = null;
      this.finish = null;
    }
    if (generation === this.generation) this.onLine(null);
  }
}
