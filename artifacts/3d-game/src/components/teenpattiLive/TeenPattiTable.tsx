import { memo, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import FilmedTeenPattiTable from "./FilmedTeenPattiTable";
import TeenPattiResult from "./TeenPattiResult";
import type { Win } from "@/components/table/RoundWinDialog";
import type { DealAudio } from "./tableDealAudio";
import {
  categoryLabel,
  winnerLabel,
  type SpotAmounts,
  type TeenPattiDeal,
  type TeenPattiSpot,
} from "./types";

interface Props {
  deal: TeenPattiDeal | null;
  roundId: string | null;
  revealEndsAt: number | null;
  revealDurationMs?: number;
  bettingEndsAt?: number | null;
  bettingDurationMs?: number;
  chips: SpotAmounts;
  audio?: DealAudio;
  onSettled?: () => void;
  spotLabels: Record<TeenPattiSpot, string>;
  waitingLabel: string;
  className?: string;
  resultEnabled?: boolean;
  win?: Win | null;
  onDismissWin?: () => void;
}

/** The filmed studio also works without WebGL: every player gets the dealer.
 * Result announcements remain gated on all six cards finishing their turn. */
function TeenPattiTable({
  deal,
  roundId,
  revealEndsAt,
  revealDurationMs,
  bettingEndsAt,
  bettingDurationMs,
  chips,
  audio,
  onSettled,
  spotLabels,
  waitingLabel,
  className,
  resultEnabled = true,
  win = null,
  onDismissWin,
}: Props) {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const [landedRound, setLandedRound] = useState<string | null>(null);
  const [dismissedRound, setDismissedRound] = useState<string | null>(null);
  const personalWin = win?.roundId === roundId ? win : null;
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  const handleSettled = useCallback((round: string) => {
    setLandedRound(round);
    onSettledRef.current?.();
  }, []);
  useEffect(() => {
    if (!deal) setLandedRound(null);
  }, [deal, roundId]);
  const landed = !!deal && roundId != null && landedRound === roundId;
  const category = deal
    ? categoryLabel(
        deal.winner === "playerB" ? deal.handB.category : deal.handA.category,
      )
    : "";

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-2xl border border-amber-200/20 bg-[#081b14] aspect-[30/19] shadow-[0_15px_55px_rgba(0,0,0,.35)]",
        className,
      )}
      data-testid="teen-patti-table"
      data-mode="flat"
      data-presentation="filmed-dealer"
    >
      <FilmedTeenPattiTable
        deal={deal}
        roundKey={roundId ?? ""}
        revealEndsAt={revealEndsAt}
        revealDurationMs={revealDurationMs}
        bettingEndsAt={bettingEndsAt}
        bettingDurationMs={bettingDurationMs}
        chips={chips}
        animate={!reduced}
        audio={audio}
        onSettled={handleSettled}
        spotLabels={spotLabels}
        waitingLabel={waitingLabel}
      />
      <span className="sr-only" role="status" data-testid="text-deal-readout">
        {landed && deal
          ? `${winnerLabel(deal.winner)} with ${category}`
          : deal
            ? "Dealing"
            : "Waiting for the deal"}
      </span>
      {landed &&
        deal &&
        resultEnabled &&
        (dismissedRound !== roundId || personalWin) && (
          <TeenPattiResult
            key={roundId}
            deal={deal}
            win={personalWin}
            onClose={() => {
              setDismissedRound(roundId);
              if (personalWin) onDismissWin?.();
            }}
          />
        )}
    </div>
  );
}
export default memo(TeenPattiTable);
