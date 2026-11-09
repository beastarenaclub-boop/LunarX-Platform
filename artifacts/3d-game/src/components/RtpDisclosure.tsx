import { useStore } from "@/game/store";
export function RtpDisclosure({ houseEdge, label = "New bets" }: { houseEdge?: number; label?: string }) {
  if (houseEdge === undefined) return null;
  return <p data-testid="rtp-disclosure" style={{ fontSize: 12, lineHeight: 1.5, padding: "8px 12px", margin: "4px 0", color: "#c7d5dd", background: "#13212c", borderRadius: 6 }}>
    {label}: theoretical RTP {((1 - houseEdge) * 100).toFixed(2)}% · House edge {(houseEdge * 100).toFixed(2)}%.
    {' '}Rounding and payout caps can reduce returns. Long-run estimate; no guaranteed return or profit.
  </p>;
}
export function CrashRtpDisclosure() {
  const houseEdge = useStore(s => s.roundHouseEdge);
  return <RtpDisclosure houseEdge={houseEdge} label="This round" />;
}
