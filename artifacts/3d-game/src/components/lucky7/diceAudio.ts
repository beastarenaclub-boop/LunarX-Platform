/**
 * Audio hooks fired from the dice scene's own motion loop, so the throw cues
 * follow what the dice are visibly doing instead of a parallel timeline.
 * Nothing here plays audio — the page decides what each moment sounds like.
 *
 * Kept out of `DiceScene` so importing the type never pulls in three.
 */
export interface DiceAudio {
  /** The dice have left the hand and the roll will actually animate. */
  onThrow?: () => void;
  /** A die hit the felt; `strength` is 1 for the first hit, less after. */
  onImpact?: (strength: number) => void;
  /** Tumble speed as a 0..1 fraction of the launch speed, every frame. */
  onTumble?: (speed01: number) => void;
  /** Both dice have come to rest on their faces. */
  onSettle?: () => void;
}
