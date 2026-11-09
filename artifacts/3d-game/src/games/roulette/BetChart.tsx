import { useCallback, useEffect, useRef, useState } from "react";
import { IMG } from "./assets";
import {
  ROW_EDGES,
  cellPitch,
  chartZones,
  chipAnchor,
  numberCell,
  resolveChartTap,
  type ChartZone,
  type FRect,
} from "./chart";
import {
  BET_FLASH_MS,
  BET_HOLD_START_MS,
  BET_REPEAT_MS,
  COLORS,
  type Rect,
} from "./layout";
import { coveredPockets, stakeKey, type BetType, type Wheel } from "./wheelSpec";
import { clientToCanvas, currentViewport } from "./viewport";

/** One position on the layout with money on it. */
export interface Stake {
  type: BetType;
  selection: number[];
  /** Whole points, the unit the pill prints. */
  points: number;
}

export interface BetChartProps {
  wheel: Wheel;
  /** Where the chart is drawn on the design canvas, at the current panel state. */
  rect: Rect;
  stakes: Stake[];
  /** Blinking winner cell, or null. */
  flashPocket: number | null;
  /** True on the lit half of the shared blink. */
  flashOn: boolean;
  /** Taps place bets only when this is true; otherwise a tap opens the panel. */
  accepting: boolean;
  /** A tap opens the panel instead of placing, when the panel is shut. */
  onOpenPanel?: () => void;
  /** Returns false if the chip was refused — that ends a hold-to-repeat run. */
  onBet: (type: BetType, selection: number[]) => boolean;
  /** Removal mode: the next tap clears that position's whole staged amount. */
  removing: boolean;
  onRemove: (type: BetType, selection: number[]) => boolean;
}

export function BetChart(props: BetChartProps) {
  const { wheel, rect, stakes, flashPocket, flashOn, accepting, removing } = props;
  const [zones, setZones] = useState<ChartZone[]>(() => chartZones(wheel));
  useEffect(() => setZones(chartZones(wheel)), [wheel]);

  /** Pockets lit green because a chip just went down on something covering them. */
  const [litPockets, setLitPockets] = useState<number[]>([]);
  const litTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const holdTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  /** The long-press wait before the repeat starts. See `onPointerDown`. */
  const holdDelay = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const holdZone = useRef<string | null>(null);
  /** The ONE pointer allowed to hold. A second finger is ignored, not stacked. */
  const holdPointer = useRef<number | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const clearHold = useCallback(() => {
    if (holdTimer.current) clearInterval(holdTimer.current);
    // The long-press wait too, or a release inside it still starts a repeat
    // on a finger that is already gone.
    if (holdDelay.current) clearTimeout(holdDelay.current);
    holdTimer.current = undefined;
    holdDelay.current = undefined;
    holdZone.current = null;
    holdPointer.current = null;
  }, []);

  // A release that never reaches the surface — the finger slid off before
  // capture took, a capture the browser refused, a pointer the OS took over
  // for a gesture — must still end the hold. Without this the interval kept
  // staking a chip every 90 ms until the window shut, and every chip relit
  // its cells: the "green flashing" reported from phones.
  useEffect(() => {
    const end = () => clearHold();
    globalThis.addEventListener("pointerup", end, true);
    globalThis.addEventListener("pointercancel", end, true);
    globalThis.addEventListener("blur", end);
    return () => {
      globalThis.removeEventListener("pointerup", end, true);
      globalThis.removeEventListener("pointercancel", end, true);
      globalThis.removeEventListener("blur", end);
    };
  }, [clearHold]);

  useEffect(() => () => {
    if (litTimer.current) clearTimeout(litTimer.current);
    if (holdTimer.current) clearInterval(holdTimer.current);
    if (holdDelay.current) clearTimeout(holdDelay.current);
  }, []);

  // A hold that outlives the betting window has to end with it, not on release.
  useEffect(() => {
    if (!accepting) clearHold();
  }, [accepting, clearHold]);

  /** Light every pocket the bet covers, for 350 ms. A new chip restarts the timer. */
  const flashCoverage = useCallback(
    (type: BetType, selection: number[]) => {
      setLitPockets(coveredPockets(wheel, type, selection));
      if (litTimer.current) clearTimeout(litTimer.current);
      litTimer.current = setTimeout(() => setLitPockets([]), BET_FLASH_MS);
    },
    [wheel],
  );

  // Through the canvas's own inverse transform, NOT `getBoundingClientRect`:
  // on a phone held upright the whole canvas is turned a quarter turn, and the
  // rect a rotated element reports is its axis-aligned box — a tap resolved
  // against that lands a column over.
  const rectRef = useRef(rect);
  rectRef.current = rect;
  const fractionAt = useCallback((clientX: number, clientY: number) => {
    const r = rectRef.current;
    if (r.w <= 0 || r.h <= 0) return null;
    const p = clientToCanvas(currentViewport(), clientX, clientY);
    return { fx: (p.x - r.x) / r.w, fy: (p.y - r.y) / r.h };
  }, []);

  const place = useCallback(
    (fx: number, fy: number): boolean => {
      const p = propsRef.current;
      const hit = resolveChartTap(p.wheel, zones, fx, fy);
      if (!hit) return false;
      // Armed: a spot WITH a chip loses its whole stake; an EMPTY spot retires
      // the mode and takes the chip below — the tap is not swallowed.
      if (p.removing && p.onRemove(hit.type, hit.selection)) return false;
      const ok = p.onBet(hit.type, hit.selection);
      if (ok) flashCoverage(hit.type, hit.selection);
      return ok;
    },
    [zones, flashCoverage],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const p = propsRef.current;
      if (!p.accepting) {
        p.onOpenPanel?.();
        return;
      }
      // A second finger while one is already holding is IGNORED. Starting a
      // second interval here overwrote the ref and orphaned the first, which
      // then ran on its own — a chip every 90 ms, each relighting its cells,
      // until the betting window shut.
      if (holdTimer.current || holdDelay.current) return;
      const f = fractionAt(e.clientX, e.clientY);
      if (!f) return;
      const hit = resolveChartTap(p.wheel, zones, f.fx, f.fy);
      if (!hit) return;
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // Some WebKit builds throw for a pointer that is already gone; the
        // window-level release listener covers the miss.
      }

      const ok = place(f.fx, f.fy);
      if (!ok || p.removing) return;

      /**
       * Hold to repeat, and it only begins after a LONG PRESS.
       *
       * One chip goes down on the tap above. The repeat then waits
       * `BET_HOLD_START_MS` before its first extra chip and runs at 90 ms after
       * that, on the zone the hold STARTED over — drifting off ends the run
       * rather than walking chips across the board.
       *
       * The wait is the whole point and it was missing: the interval was armed
       * on pointerdown, so an ordinary tap that happened to dwell 200 ms put
       * THREE chips on the number and a deliberate half-second press put six.
       * Touch dwell is routinely over 90 ms, so the stake was doubling for no
       * reason a player could see. The cabinet gets this free from the
       * framework's long-press recogniser; here it is an explicit delay.
       */
      holdZone.current = stakeKey(hit.type, hit.selection);
      holdPointer.current = e.pointerId;
      holdDelay.current = setTimeout(() => {
        holdDelay.current = undefined;
        const start = propsRef.current;
        if (!start.accepting) {
          clearHold();
          return;
        }
        holdTimer.current = setInterval(() => {
          const cur = propsRef.current;
          if (!cur.accepting) {
            clearHold();
            return;
          }
          const again = cur.onBet(hit.type, hit.selection);
          if (!again) clearHold();
          else flashCoverage(hit.type, hit.selection);
        }, BET_REPEAT_MS);
      }, BET_HOLD_START_MS);
    },
    [zones, place, fractionAt, clearHold, flashCoverage],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!holdTimer.current) return;
      // Only the holding finger can end the hold by moving.
      if (holdPointer.current !== null && e.pointerId !== holdPointer.current) return;
      const f = fractionAt(e.clientX, e.clientY);
      if (!f) return clearHold();
      const hit = resolveChartTap(propsRef.current.wheel, zones, f.fx, f.fy);
      if (!hit || stakeKey(hit.type, hit.selection) !== holdZone.current) clearHold();
    },
    [zones, fractionAt, clearHold],
  );

  const toPx = (r: FRect) => ({
    left: rect.x + r.l * rect.w,
    top: rect.y + r.t * rect.h,
    width: r.w * rect.w,
    height: r.h * rect.h,
  });

  const winnerCell = flashPocket === null ? null : numberCell(wheel, flashPocket);

  return (
    <>
      {/*
        The flashes are painted UNDER the art, not over it: the chart image
        leaves every number cell transparent, so a fill behind it colours the
        cell while the printed number stays legible. Painted on top, they would
        wash the number out.
      */}
      {winnerCell && flashOn && (
        <div
          style={{
            position: "absolute",
            ...toPx(winnerCell),
            background: COLORS.winFlash,
            pointerEvents: "none",
          }}
        />
      )}
      {litPockets.map((p) => {
        const cell = numberCell(wheel, p);
        return cell ? (
          <div
            key={`lit-${p}`}
            style={{
              position: "absolute",
              ...toPx(cell),
              background: COLORS.betFlash,
              pointerEvents: "none",
            }}
          />
        ) : null;
      })}

      <div
        ref={surfaceRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={clearHold}
        onPointerCancel={clearHold}
        onPointerLeave={clearHold}
        // A long press IS the hold-to-repeat gesture; left alone, Android and
        // iOS answer it with the image callout and cancel the pointer under it.
        onContextMenu={(e) => e.preventDefault()}
        style={{
          position: "absolute",
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          touchAction: "none",
          WebkitTouchCallout: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          cursor: accepting || props.onOpenPanel ? "pointer" : "default",
        }}
      >
        <img
          src={IMG.chart[wheel.code]}
          alt=""
          draggable={false}
          style={{ width: "100%", height: "100%", display: "block" }}
        />
        {stakes.map((s) => {
          const anchor = chipAnchor(wheel, zones, s.type, s.selection);
          if (!anchor) return null;
          return (
            <StakeChip
              key={stakeKey(s.type, s.selection)}
              points={s.points}
              wheel={wheel}
              left={anchor.fx * rect.w}
              top={anchor.fy * rect.h}
              scaleX={rect.w / 2155}
              scaleY={rect.h / 406}
            />
          );
        })}
      </div>
    </>
  );
}

/**
 * The gold marker on a position.
 *
 * There is NO STACKING. A second chip on a position merges into the one pill
 * and the number changes; the pill widens to fit. A stack of coins would hide
 * the printed number underneath it, which is the one thing the player is
 * checking.
 */
function StakeChip({
  points,
  wheel,
  left,
  top,
  scaleX,
  scaleY,
}: {
  points: number;
  wheel: Wheel;
  left: number;
  top: number;
  scaleX: number;
  scaleY: number;
}) {
  /**
   * Sized off the CELL, as if twelve columns across.
   *
   * The mini art keeps the classic oval centred in a double-width cell, so its
   * raw pitch would draw a marker twice the oval's width. `columns / 12` is
   * what the cabinet corrects with, and it makes both wheels' markers the same
   * size — 74.4px classic, 74.5px mini, in the closed 2155-wide box.
   */
  const minW = cellPitch(wheel) * (wheel.columns / 12) * 0.49 * 2155;
  const h = (ROW_EDGES[1]! - ROW_EDGES[0]!) * 0.33 * 406;
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        // Centred on the anchor rather than hung from its corner: the anchor IS
        // the rule or the cell centre, and a corner-hung marker sits a chip's
        // width off it.
        // Authored in the chart's CLOSED 2155x406 space and stretched with the
        // chart, non-uniformly, exactly as the art is.
        transform: `translate(-50%, -50%) scale(${scaleX}, ${scaleY})`,
        transformOrigin: "50% 50%",
        minWidth: minW,
        height: h,
        padding: `0 ${0.3 * h}px`,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: COLORS.stakePillText,
        // 0.64 of the marker's height, black and bold, over the art.
        font: `700 ${0.64 * h}px/1 system-ui, sans-serif`,
        whiteSpace: "nowrap",
        pointerEvents: "none",
      }}
    >
      {/*
        The marker is ART now — `bet_chip.png` stretched to fill behind the
        amount. It was a painted gold pill with a border and a drop shadow, and
        that shadow was the ONLY one in game scope; the cabinet has none, and
        no gradients either. Stretched rather than tiled: a wide amount widens
        the marker and the art follows it, which is what the source does.
      */}
      <img
        src={IMG.betChip}
        alt=""
        draggable={false}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          // The app's reset caps every image at its parent's width, and this
          // one fills its parent exactly — one rounding from being clamped.
          maxWidth: "none",
        }}
      />
      <span style={{ position: "relative" }}>{points}</span>
    </div>
  );
}
