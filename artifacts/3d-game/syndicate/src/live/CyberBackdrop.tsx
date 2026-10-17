"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import EarningsScene from "./EarningsScene";

const commands = [
  "> boot visual_shell.exe",
  "  loading depth layers [03]",
  "> render sacred_geometry",
  "  vertices aligned :: 0x0F",
  "> sync pulse / glyph stream",
  "  signal pattern :: stable",
  "> await symbol sequence [05]",
  "  inner_gate :: standing by_",
];
const script = commands.join("\n");
const glyphs = "01AF7C9E4B208D6F";

export default function CyberBackdrop({
  variant = "entrance",
  reducedMotion = false,
}: {
  variant?: "entrance" | "game" | "login";
  reducedMotion?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [systemReduced, setSystemReduced] = useState(false);
  const [characters, setCharacters] = useState(0);
  const reduced = reducedMotion || systemReduced;
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setSystemReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => {
      if (!document.hidden)
        setCharacters((value) => (value + 2) % (script.length + 70));
    }, 85);
    return () => clearInterval(timer);
  }, [reduced]);
  useEffect(() => {
    const element = ref.current;
    if (!element || reduced || !matchMedia("(pointer: fine)").matches) return;
    let frame = 0;
    const move = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        element.style.setProperty(
          "--cyber-x",
          `${(event.clientX / innerWidth - 0.5) * 20}px`,
        );
        element.style.setProperty(
          "--cyber-y",
          `${(event.clientY / innerHeight - 0.5) * 14}px`,
        );
      });
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      cancelAnimationFrame(frame);
      element.style.removeProperty("--cyber-x");
      element.style.removeProperty("--cyber-y");
    };
  }, [reduced]);
  return (
    <div
      ref={ref}
      className={`cyber-backdrop cyber-${variant}`}
      aria-hidden="true"
      data-reduced={reduced}
    >
      <div className="cyber-haze" />
      <div className="cyber-rain">
        {Array.from({ length: 18 }, (_, index) => (
          <div
            className="cyber-code-column"
            key={index}
            style={{ "--column": index } as CSSProperties}
          >
            {Array.from(
              { length: 38 },
              (_, row) => glyphs[(index * 7 + row * 11) % glyphs.length],
            ).join("\n")}
          </div>
        ))}
      </div>
      <div className="cyber-world">
        <div className="cyber-horizon" />
        <div className="cyber-grid" />
        <div className="cyber-orbit orbit-one" />
        <div className="cyber-orbit orbit-two" />
        <div className="cyber-orbit orbit-three" />
        {[0, 1, 2].map((index) => (
          <div className={`cyber-cube-anchor cube-${index}`} key={index}>
            <div className="cyber-cube">
              {["front", "back", "left", "right", "top", "bottom"].map(
                (face) => (
                  <i className={`cube-face face-${face}`} key={face} />
                ),
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="cyber-terminal terminal-left">
        <div className="cyber-terminal-bar">
          <i />
          <i />
          <i />
          <span>VISUAL SHELL / 0x01</span>
        </div>
        <pre>
          {reduced
            ? script
            : script.slice(0, Math.min(characters, script.length))}
          <b className="cyber-cursor">▍</b>
        </pre>
      </div>
      <div className="cyber-terminal terminal-right">
        <div className="cyber-terminal-bar">
          <i />
          <span>GLYPH ENGINE / LAYERS</span>
        </div>
        <div className="cyber-waveform">
          {Array.from({ length: 24 }, (_, index) => (
            <i
              key={index}
              style={
                {
                  "--bar": index,
                  "--bar-height": `${20 + ((index * 37) % 80)}%`,
                } as CSSProperties
              }
            />
          ))}
        </div>
        <div className="cyber-readouts">
          <span>
            DEPTH <b>03</b>
          </span>
          <span>
            GEOMETRY <b>Δ / 05</b>
          </span>
        </div>
        <div className="cyber-trace">
          ∴ 0x7F &nbsp; 0101 &nbsp; 0xA3 &nbsp; ∴
        </div>
      </div>
      <div className="cyber-scan" />
      <div className="cyber-vignette" />
      {variant !== "game" && <EarningsScene />}
    </div>
  );
}
