import { useEffect, useRef } from "react";
import { JetXFlightRenderer } from "./jetxFlightRenderer";
import "./jetx-flight.css";

export default function JetXFlightCanvas() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const renderer = new JetXFlightRenderer(canvas.current);
    return () => renderer.dispose();
  }, []);
  return <canvas ref={canvas} className="jetx-flight-canvas" data-testid="jetx-flight-canvas" aria-hidden="true" />;
}
