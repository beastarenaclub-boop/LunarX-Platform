import { useEffect, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import "./chips.css";
import { useButtonValues } from "@/lib/buttonValues";

/**
 * Shared coin/chip control used by EVERY game.
 *
 * The artwork catalog matches wallet coin packs. Betting presets use the
 * separate LIVE_TABLE_COIN_VALUES ladder, starting at ₹100 then ₹500.
 *
 * Chips are rendered as real casino chips: a colour-coded edge ring with eight
 * spots, an inset face with a top-light highlight, and a raised selected state.
 * A "custom amount" chip stays available for players who need a stake that is
 * not on the ladder.
 */
export interface CoinDenomination {
  value: number;
  /** Chip body colour. */
  base: string;
  /** Edge-spot colour (the classic dashes around the rim). */
  edge: string;
  /** Top highlight, gives the face its domed look. */
  light: string;
  /** Label colour. */
  text: string;
  /** Ring colour when selected. */
  ring: string;
}

export const COIN_DENOMINATIONS: CoinDenomination[] = [
  { value: 10, base: "#1d4ed8", edge: "#93c5fd", light: "#60a5fa", text: "#ffffff", ring: "#93c5fd" },
  { value: 20, base: "#15803d", edge: "#86efac", light: "#4ade80", text: "#ffffff", ring: "#86efac" },
  { value: 50, base: "#c2410c", edge: "#fdba74", light: "#fb923c", text: "#ffffff", ring: "#fdba74" },
  { value: 100, base: "#1f2937", edge: "#9ca3af", light: "#4b5563", text: "#ffffff", ring: "#d1d5db" },
  { value: 200, base: "#be185d", edge: "#f9a8d4", light: "#ec4899", text: "#ffffff", ring: "#f9a8d4" },
  { value: 500, base: "#6d28d9", edge: "#c4b5fd", light: "#8b5cf6", text: "#ffffff", ring: "#c4b5fd" },
  { value: 1000, base: "#b45309", edge: "#fde68a", light: "#f59e0b", text: "#1a1206", ring: "#fcd34d" },
  { value: 2000, base: "#0e7490", edge: "#a5f3fc", light: "#06b6d4", text: "#ffffff", ring: "#a5f3fc" },
  { value: 5000, base: "#b91c1c", edge: "#fca5a5", light: "#ef4444", text: "#ffffff", ring: "#fca5a5" },
  { value: 10000, base: "#94a3b8", edge: "#f8fafc", light: "#e2e8f0", text: "#0b1120", ring: "#f1f5f9" },
];

/** Just the numbers, cheapest first. Ten entries. */
export const COIN_VALUES: number[] = COIN_DENOMINATIONS.map((c) => c.value);

/** Shared betting presets, lowest first; each game applies its own stake cap. */
export const LIVE_TABLE_COIN_VALUES: readonly number[] = [100, 500, 1000, 2000, 5000, 10000];

/**
 * Short label: 1000 → "1k", 12500 → "12.5k", 250 → "250".
 *
 * Scales past "k" so a hand-typed stake (players can enter any amount) still
 * fits inside a coin instead of overflowing it.
 */
export function formatChip(v: number): string {
  const trim = (value: number) => {
    const formatted = value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2);
    return formatted.includes(".")
      ? formatted.replace(/0+$/, "").replace(/\.$/, "")
      : formatted;
  };
  if (v >= 1_000_000_000) return `${trim(v / 1_000_000_000)}b`;
  if (v >= 1_000_000) return `${trim(v / 1_000_000)}m`;
  if (v >= 1000) return `${trim(v / 1000)}k`;
  return v.toLocaleString("en-IN");
}

/** Nearest catalog denomination at or below `v` (used to colour custom amounts). */
function denominationFor(value: number): CoinDenomination {
  let match = COIN_DENOMINATIONS[0]!;
  for (const d of COIN_DENOMINATIONS) if (d.value <= value) match = d;
  return match;
}

/**
 * The chip artwork on its own — no interaction. Reused by the wallet's
 * coin-pack cards so packs and stakes share one visual language.
 */
export function CoinFace({
  value,
  label,
  sizeClass = "w-11 h-11",
  textClass,
  className,
  dim = false,
}: {
  value: number;
  label?: string;
  sizeClass?: string;
  textClass?: string;
  className?: string;
  dim?: boolean;
}) {
  const d = denominationFor(value);
  const text = label ?? formatChip(value);
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full",
        sizeClass,
        className,
      )}
      style={{
        // Eight edge spots around the rim — the classic chip silhouette.
        background: `repeating-conic-gradient(from 22.5deg, ${d.edge} 0deg 22.5deg, ${d.base} 22.5deg 45deg)`,
        boxShadow: dim
          ? "0 1px 3px rgba(0,0,0,0.45)"
          : "0 2px 6px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.25)",
      }}
      aria-hidden="true"
    >
      {/* Inset face with the domed top-light. */}
      <span
        className="absolute inset-[14%] rounded-full"
        style={{
          background: `radial-gradient(circle at 50% 28%, ${d.light} 0%, ${d.base} 72%)`,
          boxShadow:
            "inset 0 0 0 1.5px rgba(255,255,255,0.35), inset 0 -2px 4px rgba(0,0,0,0.45)",
        }}
      />
      <span
        className={cn(
          "relative font-black leading-none tracking-tight",
          textClass ?? (text.length > 3 ? "text-[9px]" : "text-[11px]"),
        )}
        style={{ color: d.text }}
      >
        {text}
      </span>
    </span>
  );
}

/** How the betting chips are arranged. */
export type ChipRackLayout =
  /** All live-table presets and Any remain visible without scrolling. */
  | "fit"
  /** Horizontal scrolling rack — table-game bottom bars. */
  | "row"
  /** Two-column stack — beside the roulette board on desktop. */
  | "column"
  /** Five-across wrapping grid — narrow bet panels (Lunar/Mines/Plinko/Dice). */
  | "grid";

interface ChipRackProps {
  chip: number;
  onSelect: (value: number) => void;
  /** Suffix for data-testids, e.g. "" (desktop) or "-mobile". */
  idSuffix?: string;
  className?: string;
  layout?: ChipRackLayout;
  /** Locked state (round in progress, bet already placed, …). */
  disabled?: boolean;
  /** Hide the free-form amount chip where a game has no custom stake. */
  showCustom?: boolean;
  values?: readonly number[];
  /** Practice tables share the same artwork without showing a cash currency. */
  unit?: "rupees" | "chips";
  minValue?: number;
  maxValue?: number;
  step?: number;
  allowAccountValues?: boolean;
}

/**
 * Coin denomination selector + custom-amount entry. Selecting a chip only
 * changes the active amount — it never places a bet by itself.
 */
export default function ChipRack({
  chip,
  onSelect,
  idSuffix = "",
  className,
  layout = "row",
  disabled = false,
  showCustom = true,
  values: suppliedValues = LIVE_TABLE_COIN_VALUES,
  unit = "rupees",
  minValue = 1,
  maxValue = Infinity,
  step = 1,
  allowAccountValues = true,
}: ChipRackProps) {
  const customValues = useButtonValues();
  const values = (allowAccountValues && showCustom && unit === "rupees" && customValues ? customValues : suppliedValues)
    .filter(value => value >= minValue && value <= maxValue && value % step === 0);
  const isPreset = values.includes(chip);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  useEffect(() => { if (disabled) setCustomOpen(false); }, [disabled]);

  const applyCustom = () => {
    const n = Number(customText);
    if (disabled || !Number.isSafeInteger(n) || n < minValue || n > maxValue || n % step !== 0) return;
    onSelect(n);
    setCustomOpen(false);
  };

  // The editable amount always gets its own line so it never eats the room
  // that belongs to the coins, the staged total, or the table action row.
  const containerCls = cn("flex flex-col gap-2 min-w-0", layout === "fit" && "coin-rack-fit", className);

  const rackCls =
    layout === "fit"
      ? "coin-rack-options"
      : layout === "column"
      ? // Ten chips do not fit in a single desktop column, so they stack two
        // across — still a vertical rack, just half as tall.
        "grid grid-cols-2 gap-1.5 justify-items-center"
      : layout === "grid"
        ? // Wrapping (not a fixed 5-column grid) so a narrow bet panel drops
          // to fewer coins per row instead of shrinking them below a usable
          // tap size.
          "flex flex-wrap gap-1.5"
        : // Keep every denomination visible beside the staged total, including
          // on narrow phones, without a horizontal swipe.
          "flex flex-wrap items-center gap-1.5 min-w-0 pb-0.5";

  // Chips scale with the viewport: 36px on tiny phones (<380px), 40px on
  // regular phones, 44px from ~640px up — so a full ten-chip rack still gives
  // a touch-friendly target without pushing actions off-screen.
  const chipSize =
    layout === "column"
      ? "w-9 h-9 xl:w-10 xl:h-10"
      : layout === "grid"
        ? "w-10 h-10 sm:w-11 sm:h-11"
        : "w-9 h-9 min-[380px]:w-10 min-[380px]:h-10 sm:w-11 sm:h-11";

  return (
    <div
      className={cn(containerCls, disabled && "opacity-50 pointer-events-none")}
      data-testid={`chip-rack${idSuffix}`}
      role="group"
      aria-label="Coin denomination"
      style={layout === "fit" ? {
        "--coin-columns": Math.min(4, values.length + Number(showCustom)),
        "--coin-desktop-columns": `repeat(${values.length}, minmax(52px, 1fr))${showCustom ? " minmax(80px, 1.5fr)" : ""}`,
      } as CSSProperties : undefined}
    >
      <div className={rackCls}>
        {values.map((value) => {
          const c = denominationFor(value);
          const selected = chip === value;
          return (
            <button
              key={value}
              data-game-coin
              type="button"
              disabled={disabled}
              onClick={() => onSelect(value)}
              aria-pressed={selected}
              aria-label={unit === "chips" ? `${value.toLocaleString("en-IN")} chip` : `₹${value.toLocaleString("en-IN")} coin`}
              // The selected coin keeps its footprint (inset ring, no scale)
              // so picking one never nudges its neighbours or clips a ring
              // against the edge of a scrolling rack.
              className={cn(
                "touch-target shrink-0 rounded-full transition-shadow",
                chipSize,
                layout === "fit" && "coin-rack-option",
                selected
                  ? "ring-2 ring-inset z-10"
                  : "opacity-85 hover:opacity-100",
              )}
              style={
                selected
                  ? ({
                      boxShadow: `0 0 12px ${c.ring}66`,
                      "--tw-ring-color": c.ring,
                    } as CSSProperties)
                  : undefined
              }
              data-testid={`chip${idSuffix}-${value}`}
            >
              <CoinFace value={value} sizeClass="w-full h-full" textClass={layout === "fit" ? "text-xs" : undefined} />
            </button>
          );
        })}
        {showCustom && (layout === "fit" || !customOpen) && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setCustomText(isPreset ? "" : String(chip));
              setCustomOpen(!customOpen);
            }}
            aria-pressed={!isPreset}
            aria-label="Custom amount"
            data-game-coin
            aria-expanded={customOpen}
            className={cn(
              "touch-target shrink-0 rounded-full border-2 border-dotted font-black text-[9px] transition-shadow",
              chipSize,
              layout === "fit" && "coin-rack-custom",
              !isPreset
                ? "bg-teal-500 border-teal-200 text-black ring-2 ring-inset ring-teal-200"
                : "bg-white/5 border-white/30 text-white/70 hover:bg-white/10",
            )}
            data-testid={`chip${idSuffix}-custom`}
          >
            {!isPreset ? formatChip(chip) : "ANY"}
          </button>
        )}
      </div>

      {layout === "fit" && showCustom && <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className="max-w-sm border-emerald-300/20 bg-[#0b2119] text-white" data-testid={`custom-coin-dialog${idSuffix}`}>
          <DialogTitle>Custom coin amount</DialogTitle>
          <DialogDescription className="text-white/60">Choose your coin amount. Selected bets follow the game's betting countdown.</DialogDescription>
          <label className="flex flex-col gap-2 text-sm">Amount in {unit}
            <input type="number" inputMode="numeric" min={minValue} max={Number.isFinite(maxValue) ? maxValue : undefined} step={step} autoFocus disabled={disabled} value={customText}
              onChange={event => setCustomText(event.target.value)}
              onKeyDown={event => { if (event.key === "Enter") applyCustom(); }}
              className="h-12 min-w-0 rounded-lg border border-white/20 bg-black/30 px-3 text-base"
              data-testid={`chip${idSuffix}-custom-input`} />
          </label>
          {Number.isFinite(maxValue) && <p className="text-xs text-white/60">Choose {minValue.toLocaleString("en-IN")}–{maxValue.toLocaleString("en-IN")} {unit}{step > 1 ? ` in multiples of ${step}` : ""}.</p>}
          <button type="button" disabled={disabled || !Number.isSafeInteger(Number(customText)) || Number(customText) < minValue || Number(customText) > maxValue || Number(customText) % step !== 0}
            onClick={applyCustom} data-testid={`chip${idSuffix}-custom-apply`}
            className="min-h-12 rounded-lg bg-amber-300 font-bold text-black disabled:opacity-40">Set amount</button>
        </DialogContent>
      </Dialog>}
      {layout !== "fit" && showCustom && customOpen ? (
        layout === "column" ? (
          /* The roulette side rail is only two coins wide: stack the field. */
          <div className="flex flex-col items-center gap-1.5 w-full">
            <input
              type="number"
              disabled={disabled}
              min={1}
              autoFocus
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyCustom();
                if (e.key === "Escape") setCustomOpen(false);
              }}
              placeholder="Amt"
              className="w-16 h-10 rounded-lg bg-black/40 border border-white/20 px-1.5 text-xs font-mono text-white text-center focus:outline-none focus:border-amber-400"
              data-testid={`chip${idSuffix}-custom-input`}
            />
            <button
              type="button"
              disabled={disabled}
              onClick={applyCustom}
              className="w-16 h-10 rounded-lg bg-amber-500 text-black text-[10px] font-black shrink-0"
              data-testid={`chip${idSuffix}-custom-apply`}
            >
              OK
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 w-full">
            <input
              type="number"
              disabled={disabled}
              min={1}
              autoFocus
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyCustom();
                if (e.key === "Escape") setCustomOpen(false);
              }}
              placeholder="Amount"
              className="min-w-0 flex-1 h-11 rounded-lg bg-black/40 border border-white/20 px-3 text-sm font-mono text-white focus:outline-none focus:border-amber-400"
              data-testid={`chip${idSuffix}-custom-input`}
            />
            <button
              type="button"
              disabled={disabled}
              onClick={applyCustom}
              className="h-11 min-w-12 px-3 rounded-lg bg-amber-500 text-black text-xs font-black shrink-0 touch-target"
              data-testid={`chip${idSuffix}-custom-apply`}
            >
              OK
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}
