import type { ODPhase } from "@workspace/api-zod/dragon-tiger-one-day";

export type CommentaryKey =
  | "opening"
  | "ace"
  | "low"
  | "seven"
  | "high"
  | "king"
  | "dragon-wins"
  | "tiger-wins"
  | "tie";

export interface CommentaryClip {
  file: string;
  duration: number;
  transcript: string;
}
export type CommentaryClips = Partial<Record<CommentaryKey, CommentaryClip>>;

/** Only revealed information selects a line; the hidden Tiger is never an input. */
export function commentaryKey(
  phase?: ODPhase,
  dragon?: number,
  winner?: "dragon" | "tiger" | "tie",
): CommentaryKey | null {
  if (phase === "first") return "opening";
  if (phase === "result")
    return winner === "tie" ? "tie" : winner ? `${winner}-wins` : null;
  if (
    phase !== "second" ||
    dragon === undefined ||
    !Number.isInteger(dragon) ||
    dragon < 0 ||
    dragon >= 416
  )
    return null;
  const rank = (dragon % 13) + 1;
  return rank === 1
    ? "ace"
    : rank <= 6
      ? "low"
      : rank === 7
        ? "seven"
        : rank < 13
          ? "high"
          : "king";
}

export function readCommentaryClips(value: unknown): CommentaryClips {
  const result: CommentaryClips = {};
  if (
    !value ||
    typeof value !== "object" ||
    !("clips" in value) ||
    !value.clips ||
    typeof value.clips !== "object"
  )
    return result;
  for (const key of [
    "opening",
    "ace",
    "low",
    "seven",
    "high",
    "king",
    "dragon-wins",
    "tiger-wins",
    "tie",
  ] as const) {
    const clip = (value.clips as Record<string, unknown>)[key];
    if (!clip || typeof clip !== "object") continue;
    const { file, duration, transcript } = clip as CommentaryClip;
    if (
      typeof file === "string" &&
      /^[a-z0-9-]+\.mp4$/.test(file) &&
      Number.isFinite(duration) &&
      duration > 0 &&
      duration <= 14 &&
      typeof transcript === "string"
    )
      result[key] = { file, duration, transcript };
  }
  return result;
}
