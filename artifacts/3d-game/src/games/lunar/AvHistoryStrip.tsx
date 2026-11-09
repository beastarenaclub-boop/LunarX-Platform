import { useState } from "react";
import { useStore } from "@/game/store";
import { MoreHorizontal, X } from "lucide-react";
import { tierColor } from "./avUtils";

/**
 * Reference round-history strip (UI_SPEC_AVIATOR.md §2): bare tier-colored
 * text on the page background — no pills, no container, no border. Newest is
 * prepended on the left and the row clips instead of scrolling.
 *
 * The `•••` button expands it in place into the "Round History" panel (an
 * in-flow block that pushes the canvas down), not a popover.
 */
export default function AvHistoryStrip() {
  const history = useStore((s) => s.history);
  const [expanded, setExpanded] = useState(false);

  const chips = history.map((m, i) => (
    <span
      key={`${i}-${m}`}
      className="shrink-0 text-[12px] font-semibold tabular-nums"
      style={{ color: tierColor(m) }}
      title={`Round ${history.length - i}: ${m.toFixed(2)}x`}
    >
      {m.toFixed(2)}x
    </span>
  ));

  // The strip lives in a 32px slot, so the expanded panel has to escape it —
  // absolute + a z-index above the canvas, the way the reference's grows out of
  // its own 32px row and paints over the stage.
  if (expanded) {
    return (
      <div className="relative h-full">
        <div
          className="absolute inset-x-0 top-0 z-30 rounded-[16px] bg-[#1b1c1d] px-3 py-2"
          data-testid="round-history-expanded"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] text-[#9a9a9a]">Round History</span>
            <button
              onClick={() => setExpanded(false)}
              className="text-white/45 transition-colors hover:text-white"
              aria-label="Close round history"
              data-testid="btn-history-close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex max-h-[160px] flex-wrap gap-x-[10px] gap-y-1.5 overflow-y-auto scrollbar-thin">
            {chips.length ? chips : <span className="text-[11px] text-white/35">No rounds yet</span>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[32px] items-center gap-[8px] p-1" data-testid="round-history-strip">
      <div className="flex min-w-0 flex-1 items-center gap-[10px] overflow-hidden">
        {chips.length ? chips : <span className="text-[11px] text-white/35">No rounds yet</span>}
      </div>
      <button
        onClick={() => setExpanded(true)}
        className="flex h-[16px] shrink-0 items-center rounded-full bg-[#2c2d30] px-1 text-white/60 transition-colors hover:text-white"
        aria-label="Round history"
        data-testid="btn-round-history"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
    </div>
  );
}
