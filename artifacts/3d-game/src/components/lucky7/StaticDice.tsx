import { cn } from "@/lib/utils";

/** Pip layout per face, on a 3×3 grid (col, row), 0-indexed. */
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ],
  5: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  6: [
    [0, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [2, 2],
  ],
};

interface FaceProps {
  value: number | null;
  className?: string;
  testId?: string;
}

/**
 * One flat die face. Used by the reduced-motion / no-WebGL fallback and by the
 * results strip, so a player who never sees the 3D table still reads the roll
 * at a glance.
 */
export function DieFace({ value, className, testId }: FaceProps) {
  const pips = value != null ? (PIPS[value] ?? []) : [];
  return (
    <div
      className={cn(
        "relative rounded-xl bg-gradient-to-br from-white to-zinc-200 shadow-[0_6px_18px_rgba(0,0,0,0.55)] border border-white/70",
        "w-14 h-14 sm:w-16 sm:h-16 shrink-0",
        className,
      )}
      data-testid={testId}
      data-value={value ?? ""}
      aria-hidden="true"
    >
      {value == null ? (
        <span className="absolute inset-0 flex items-center justify-center text-2xl font-black text-zinc-400">
          ?
        </span>
      ) : (
        <div className="absolute inset-[14%] grid grid-cols-3 grid-rows-3">
          {pips.map(([col, row], i) => (
            <span
              key={i}
              className={cn(
                "block rounded-full self-center justify-self-center w-[64%] aspect-square",
                value === 1 ? "bg-red-600" : "bg-zinc-900",
              )}
              style={{ gridColumn: col + 1, gridRow: row + 1 }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  dice: [number, number] | null;
  className?: string;
}

/**
 * Instant, always-correct dice result. Rendered instead of the 3D table when
 * the player prefers reduced motion or their device can't run WebGL, and as
 * the Suspense placeholder while the 3D chunk downloads.
 */
export default function StaticDice({ dice, className }: Props) {
  const total = dice ? dice[0] + dice[1] : null;
  return (
    <div
      className={cn(
        "w-full h-full flex flex-col items-center justify-center gap-3",
        className,
      )}
      data-testid="dice-static"
    >
      <div className="flex items-center gap-3">
        <DieFace value={dice?.[0] ?? null} testId="static-die-1" className="w-[76px] h-[76px] sm:w-[88px] sm:h-[88px]" />
        <DieFace value={dice?.[1] ?? null} testId="static-die-2" className="w-[76px] h-[76px] sm:w-[88px] sm:h-[88px]" />
      </div>
      <div className="text-[11px] uppercase tracking-[0.25em] font-bold text-white/45">
        {total != null ? `Total ${total}` : "Waiting for the roll"}
      </div>
    </div>
  );
}
