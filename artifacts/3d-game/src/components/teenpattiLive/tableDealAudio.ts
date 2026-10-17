/**
 * Audio hooks fired from the table's own deal loop, so the card cues follow
 * what the player can actually see instead of a parallel timeline. Nothing
 * here plays audio — the page decides what each moment sounds like.
 *
 * Kept in its own module so importing the type never pulls in three.
 */
export interface DealAudio {
  /** Side shoe shuffles at the start of the current betting window. */
  onShuffle?: () => void;
  /** A face-down card has reached its table spot from the side shoe. */
  onCardDeal?: (index: number) => void;
  /** The first card is leaving the shoe and the deal will really animate. */
  onDealStart?: () => void;
  /** A card just landed on the felt; `index` is its deal order (0..5). */
  onCardLand?: (index: number) => void;
  /** A card just started turning over. */
  onCardFlip?: (index?: number) => void;
  /** Both hands are face up and at rest. */
  onReveal?: () => void;
}
