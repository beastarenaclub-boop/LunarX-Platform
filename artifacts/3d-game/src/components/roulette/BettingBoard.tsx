import {
  pocketColor,
  betKey,
  WINNING_RESULT_CLASS,
  type BetType,
  type PlacedBet,
} from "./wheelData";
import { cn } from "@/lib/utils";
import { formatChip } from "@/components/table/chips";
import MobileBettingBoard from "./MobileBettingBoard";

export interface BettingBoardProps {
  payoutBase?: number;
  bets: Map<string, PlacedBet>;
  onPlace: (bet: Omit<PlacedBet, "amount">) => void;
  disabled?: boolean;
  /** Winning pocket to highlight after a spin. */
  highlight?: number | null;
}

function Chip({ amount, className }: { amount: number; className?: string }) {
  return (
    <div
      className={cn(
        "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none",
        "w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-amber-400 border-[1.5px] border-dashed border-amber-700",
        "flex items-center justify-center text-[7px] sm:text-[8px] font-black text-black shadow-lg",
        className
      )}
    >
      {formatChip(amount)}
    </div>
  );
}

function EdgeChip({ amount, className }: { amount: number; className?: string }) {
  return (
    <div
      className={cn(
        "absolute z-20 pointer-events-none",
        "w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-amber-400 border border-amber-700",
        "flex items-center justify-center text-[6.5px] sm:text-[7px] font-black text-black shadow-sm",
        className
      )}
    >
      {formatChip(amount)}
    </div>
  );
}

/** Invisible hotspot for split/street/corner/line placement on cell edges. */
function Hotspot({
  className,
  onClick,
  title,
}: {
  className: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "absolute z-10 rounded-sm bg-transparent hover:bg-amber-300/50 focus-visible:bg-amber-300/50 outline-none transition-colors",
        className,
      )}
    />
  );
}

export default function BettingBoard({ bets, onPlace, disabled, highlight, payoutBase = 36 }: BettingBoardProps) {
  const chipFor = (b: { type: BetType; numbers?: number[]; selection?: number }) =>
    bets.get(betKey(b))?.amount;

  const place = (b: { type: BetType; numbers?: number[]; selection?: number }) => {
    if (!disabled) onPlace(b);
  };

  // Landscape layout: rows top→bottom are 3,2,1 remainder columns 1..12.
  const rows = [3, 2, 1].map((rowStart) =>
    Array.from({ length: 12 }, (_, c) => c * 3 + rowStart),
  );

  const cellCls = (n: number) =>
    cn(
      "roulette-number-cell relative h-10 sm:h-12 border border-white/20 flex items-center justify-center",
      "text-xs sm:text-sm font-bold text-white cursor-pointer transition-colors touch-manipulation",
      pocketColor(n) === "red" ? "bg-red-700/90 hover:bg-red-600" : "bg-zinc-900 hover:bg-zinc-700",
      highlight === n && WINNING_RESULT_CLASS,
      disabled && "cursor-not-allowed opacity-80",
    );

  return (
    <div className="roulette-board-area min-w-0 w-full">
    <MobileBettingBoard bets={bets} onPlace={onPlace} disabled={disabled} highlight={highlight} payoutBase={payoutBase} />
    <p className="roulette-mobile-hint">Swipe the table to see all numbers</p>
    <div className="roulette-board-scroll w-full pb-1 overflow-x-auto overflow-y-hidden touch-manipulation" role="region" aria-label="Roulette betting table" tabIndex={0}>
      <div className="roulette-number-board min-w-[320px] max-w-[800px] w-full mx-auto select-none">
        <div className="flex">
          {/* Zero */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => place({ type: "straight", numbers: [0] })}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ")
                place({ type: "straight", numbers: [0] });
            }}
            className={cn(
              "roulette-zero-cell relative w-9 sm:w-12 border border-white/20 bg-emerald-700/90 hover:bg-emerald-600",
              "flex items-center justify-center text-sm font-black text-white rounded-l-lg cursor-pointer touch-manipulation",
              highlight === 0 && WINNING_RESULT_CLASS,
              disabled && "cursor-not-allowed opacity-80",
            )}
            style={{ height: "auto" }}
            data-testid="cell-0"
            data-winning={highlight === 0 ? "true" : undefined}
          >
            0
            {chipFor({ type: "straight", numbers: [0] }) !== undefined && (
              <Chip amount={chipFor({ type: "straight", numbers: [0] })!} />
            )}
            {/* Zero streets + first four on the 0/row boundary */}
            <Hotspot
              title="Street 0-1-2"
              className="-right-2 bottom-[8%] h-[22%] w-4"
              onClick={() => place({ type: "street", numbers: [0, 1, 2] })}
            />
            <Hotspot
              title="Street 0-2-3"
              className="-right-2 top-[39%] h-[22%] w-4"
              onClick={() => place({ type: "street", numbers: [0, 2, 3] })}
            />
            <Hotspot
              title="First four 0-1-2-3"
              className="-right-2 top-[8%] h-[22%] w-4"
              onClick={() => place({ type: "corner", numbers: [0, 1, 2, 3] })}
            />
            {chipFor({ type: "street", numbers: [0, 1, 2] }) !== undefined && (
              <EdgeChip amount={chipFor({ type: "street", numbers: [0, 1, 2] })!} className="-right-2 bottom-[12%]" />
            )}
            {chipFor({ type: "street", numbers: [0, 2, 3] }) !== undefined && (
              <EdgeChip amount={chipFor({ type: "street", numbers: [0, 2, 3] })!} className="-right-2 top-[43%]" />
            )}
            {chipFor({ type: "corner", numbers: [0, 1, 2, 3] }) !== undefined && (
              <EdgeChip amount={chipFor({ type: "corner", numbers: [0, 1, 2, 3] })!} className="-right-2 top-[12%]" />
            )}
          </div>

          {/* Number grid */}
          <div className="flex-1 min-w-0">
            {rows.map((row, ri) => (
              <div key={ri} className="grid grid-cols-12">
                {row.map((n) => {
                  const below = n - 1; // next row down (smaller remainder)
                  const left = n - 3;
                  const hasBelow = ri < 2; // rows 3 & 2 have a row beneath
                  const hasLeft = n > 3;
                  return (
                    <div
                      key={n}
                      className={cellCls(n)}
                      onClick={() => place({ type: "straight", numbers: [n] })}
                      data-testid={`cell-${n}`}
                      data-winning={highlight === n ? "true" : undefined}
                    >
                      {n}
                      {chipFor({ type: "straight", numbers: [n] }) !== undefined && (
                        <Chip amount={chipFor({ type: "straight", numbers: [n] })!} />
                      )}
                      {/* Split with the cell below (vertical pair n, n-1) */}
                      {hasBelow && (
                        <Hotspot
                          title={`Split ${below}/${n}`}
                          className="left-1 right-1 -bottom-2 h-4 z-10"
                          onClick={() => place({ type: "split", numbers: [below, n] })}
                        />
                      )}
                      {/* Split with the cell to the left (n-3, n) */}
                      {hasLeft && (
                        <Hotspot
                          title={`Split ${left}/${n}`}
                          className="top-1 bottom-1 -left-2 w-4 z-10"
                          onClick={() => place({ type: "split", numbers: [left, n] })}
                        />
                      )}
                      {/* Zero splits from column 1 */}
                      {n <= 3 && (
                        <Hotspot
                          title={`Split 0/${n}`}
                          className="top-1 bottom-1 -left-2 w-4 z-10"
                          onClick={() => place({ type: "split", numbers: [0, n] })}
                        />
                      )}
                      {/* Corner at bottom-left intersection: n-4, n-3, n-1, n */}
                      {hasBelow && hasLeft && (
                        <Hotspot
                          title={`Corner ${n - 4}/${n - 3}/${n - 1}/${n}`}
                          className="-left-2.5 -bottom-2.5 w-5 h-5 z-20"
                          onClick={() =>
                            place({ type: "corner", numbers: [n - 4, n - 3, n - 1, n] })
                          }
                        />
                      )}
                      {/* Chips sitting on edge bets render on the owning cell */}
                      {hasBelow && chipFor({ type: "split", numbers: [below, n] }) !== undefined && (
                        <EdgeChip amount={chipFor({ type: "split", numbers: [below, n] })!} className="left-1/2 -bottom-2 sm:-bottom-2.5 -translate-x-1/2" />
                      )}
                      {hasLeft && chipFor({ type: "split", numbers: [left, n] }) !== undefined && (
                        <EdgeChip amount={chipFor({ type: "split", numbers: [left, n] })!} className="-left-2 sm:-left-2.5 top-1/2 -translate-y-1/2" />
                      )}
                      {n <= 3 && chipFor({ type: "split", numbers: [0, n] }) !== undefined && (
                        <EdgeChip amount={chipFor({ type: "split", numbers: [0, n] })!} className="-left-2 sm:-left-2.5 top-1/2 -translate-y-1/2" />
                      )}
                      {hasBelow && hasLeft && chipFor({ type: "corner", numbers: [n - 4, n - 3, n - 1, n] }) !== undefined && (
                        <EdgeChip amount={chipFor({ type: "corner", numbers: [n - 4, n - 3, n - 1, n] })!} className="-left-2 sm:-left-2.5 -bottom-2 sm:-bottom-2.5" />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Street & line hotspots under the bottom row */}
            <div className="grid grid-cols-12">
              {Array.from({ length: 12 }, (_, c) => {
                const base = c * 3 + 1; // street c: [base, base+1, base+2]
                const street = [base, base + 1, base + 2];
                const line =
                  c < 11 ? [base, base + 1, base + 2, base + 3, base + 4, base + 5] : null;
                return (
                  <div key={c} className="roulette-street-cell relative h-6 sm:h-8 border border-white/10 bg-white/5">
                    <button
                      type="button"
                      title={`Street ${street.join("-")}`}
                      onClick={() => place({ type: "street", numbers: street })}
                      className="absolute inset-y-0 left-1 right-2 text-[8px] sm:text-[9px] text-white/50 hover:bg-amber-300/30 rounded-sm cursor-pointer touch-manipulation"
                      data-testid={`street-${base}`}
                    >
                      ST
                    </button>
                    {line && (
                      <button
                        type="button"
                        title={`Line ${line[0]}-${line[5]}`}
                        onClick={() => place({ type: "line", numbers: line })}
                        className="absolute inset-y-0 -right-2 w-4 hover:bg-amber-300/40 rounded-sm z-10 cursor-pointer touch-manipulation"
                        data-testid={`line-${base}`}
                      />
                    )}
                    {chipFor({ type: "street", numbers: street }) !== undefined && (
                      <Chip amount={chipFor({ type: "street", numbers: street })!} />
                    )}
                    {line && chipFor({ type: "line", numbers: line }) !== undefined && (
                      <EdgeChip amount={chipFor({ type: "line", numbers: line })!} className="-right-2 sm:-right-2.5 top-1/2 -translate-y-1/2" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Column bets (2 to 1) */}
          <div className="roulette-column-bets flex flex-col w-10 sm:w-12 shrink-0">
            {[3, 2, 1].map((col) => (
              <button
                key={col}
                type="button"
                onClick={() => place({ type: "column", selection: col })}
                className="roulette-number-cell relative h-10 sm:h-12 border border-white/20 bg-white/5 hover:bg-white/15 text-[9px] font-bold text-white/70 cursor-pointer touch-manipulation transition-colors"
                data-testid={`column-${col}`}
              >
                {(payoutBase / 12).toLocaleString("en-IN", { maximumFractionDigits: 4 })}×
                {chipFor({ type: "column", selection: col }) !== undefined && (
                  <Chip amount={chipFor({ type: "column", selection: col })!} />
                )}
              </button>
            ))}
            <div className="roulette-street-cell h-6 sm:h-8" />
          </div>
        </div>

        {/* Dozens */}
        <div className="roulette-outside-row grid grid-cols-3 ml-9 sm:ml-12 mr-10 sm:mr-12 mt-1">
          {[1, 2, 3].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => place({ type: "dozen", selection: d })}
              className="roulette-number-cell relative h-10 sm:h-12 border border-white/20 bg-white/5 hover:bg-white/15 text-[10px] sm:text-xs font-bold text-white/80 cursor-pointer touch-manipulation transition-colors"
              data-testid={`dozen-${d}`}
            >
              {["1st 12", "2nd 12", "3rd 12"][d - 1]}
              {chipFor({ type: "dozen", selection: d }) !== undefined && (
                <Chip amount={chipFor({ type: "dozen", selection: d })!} />
              )}
            </button>
          ))}
        </div>

        {/* Even-money row */}
        <div className="roulette-outside-row grid grid-cols-6 ml-9 sm:ml-12 mr-10 sm:mr-12">
          {(
            [
              ["low", "1–18"],
              ["even", "EVEN"],
              ["red", "RED"],
              ["black", "BLACK"],
              ["odd", "ODD"],
              ["high", "19–36"],
            ] as [BetType, string][]
          ).map(([type, label]) => (
            <button
              key={type}
              type="button"
              onClick={() => place({ type })}
              className={cn(
                "roulette-number-cell relative h-10 sm:h-12 border border-white/20 text-[10px] sm:text-xs font-bold cursor-pointer touch-manipulation transition-colors",
                type === "red"
                  ? "bg-red-700/80 hover:bg-red-600 text-white"
                  : type === "black"
                    ? "bg-zinc-950 hover:bg-zinc-800 text-white"
                    : "bg-white/5 hover:bg-white/15 text-white/80",
              )}
              data-testid={`outside-${type}`}
            >
              {label}
              {chipFor({ type }) !== undefined && <Chip amount={chipFor({ type })!} />}
            </button>
          ))}
        </div>
      </div>
    </div>
    </div>
  );
}
