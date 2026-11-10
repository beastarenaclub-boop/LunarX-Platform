import { ICE_FISH_LABELS } from "@workspace/api-zod/ice-fish";
import "./ice-fish-cards.css";

export default function IceFishCard({ color }: { color: "blue" | "green" | "red" }) {
  return <div className={`if-card if-card-${color}`} aria-hidden="true">
    <div className="if-card-art" />
    <strong className="if-card-label">{ICE_FISH_LABELS[color]}</strong>
  </div>;
}
