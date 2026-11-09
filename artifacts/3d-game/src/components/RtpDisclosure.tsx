import { useStore } from "@/game/store";
import { GameInformationSection } from "./game/GameInformation";
export function RtpDisclosure({ houseEdge, label = "New bets", inRules = false }: { houseEdge?: number; label?: string; inRules?: boolean }) {
  if (houseEdge === undefined) return null;
  const terms = <p data-testid="rtp-disclosure" style={{ fontSize: 12, lineHeight: 1.5, padding: "8px 12px", margin: "4px 0", color: "#c7d5dd", background: "#13212c", borderRadius: 6 }}>
    {label}: theoretical RTP {((1 - houseEdge) * 100).toFixed(2)}% · House edge {(houseEdge * 100).toFixed(2)}%.
    {' '}Rounding and payout caps can reduce returns. Long-run estimate; no guaranteed return or profit.
  </p>;
  if (inRules) return terms;
  return <GameInformationSection fallback={<details><summary>Game information</summary>{terms}</details>}>{terms}</GameInformationSection>;
}
export function CrashRtpDisclosure() {
  const houseEdge = useStore(s => s.roundHouseEdge);
  return <RtpDisclosure houseEdge={houseEdge} label="This round" />;
}
