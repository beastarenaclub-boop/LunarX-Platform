import { memo, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import ReferenceTeenPattiTable from "./ReferenceTeenPattiTable";
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

/** Reference hand gestures with six sequential, server-authoritative cards.
 * The larger rail mirrors the small cards on the felt before announcements. */
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
        "tp20-table relative w-full overflow-hidden bg-[#17141b]",
        className,
      )}
      data-testid="teen-patti-table"
      data-mode="flat"
      data-presentation="reference-dealer-footage"
    >
      <ReferenceTeenPattiTable
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
            ? "Result arriving"
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
