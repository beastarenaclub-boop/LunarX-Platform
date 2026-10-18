import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { CoinSide } from "@workspace/api-zod/instant-collection";

const media = `${import.meta.env.BASE_URL}media/coin-flip/`;
// Coordinates refer to the reviewed final frame of the physical palm reveal.
export const PALM_COIN = { x: 970, y: 644, width: 150, height: 148, angle: 0 };

export default function StadiumRoundVideo({
  roundId,
  phase,
  elapsed,
  side,
  motion,
}: {
  roundId?: string;
  phase: "betting" | "toss" | "result" | "offline";
  elapsed: number;
  side: CoinSide | null;
  motion: boolean;
}) {
  const box = useRef<HTMLDivElement>(null),
    video = useRef<HTMLVideoElement>(null);
  const [scale, setScale] = useState(1),
    [failed, setFailed] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const latest = useRef({ phase, elapsed, motion, hidden });
  latest.current = { phase, elapsed, motion, hidden };
  const sync = () => {
    const v = video.current,
      p = latest.current;
    if (!v || !Number.isFinite(v.duration)) return;
    const target =
      p.phase === "result"
        ? v.duration - 0.04
        : p.phase === "toss"
          ? Math.min(v.duration - 0.04, Math.max(0, p.elapsed / 1000))
          : 0;
    if (Math.abs(v.currentTime - target) > 0.65 || p.phase !== "toss")
      v.currentTime = target;
    if (p.phase === "toss" && p.motion && !p.hidden)
      void v.play().catch(() => setFailed(true));
    else v.pause();
  };
  useEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(([e]) =>
      setScale(
        Math.max(e.contentRect.width / 1920, e.contentRect.height / 1080),
      ),
    );
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const change = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", change);
    return () => {
      document.removeEventListener("visibilitychange", change);
      video.current?.pause();
    };
  }, []);
  useEffect(sync, [
    roundId,
    phase,
    Math.floor(elapsed / 1000),
    motion,
    hidden,
    failed,
  ]);
  const reveal = phase === "result" && side;
  const coinStyle = {
    left: `calc(50% + ${(PALM_COIN.x - 960) * scale}px)`,
    top: `calc(50% + ${(PALM_COIN.y - 540) * scale}px)`,
    width: PALM_COIN.width * scale,
    height: PALM_COIN.height * scale,
    transform: `translate(-50%, -50%) rotate(${PALM_COIN.angle}deg)`,
  } as CSSProperties;
  return (
    <div className="cfl-film" ref={box}>
      <img
        className="cfl-film-poster"
        src={`${media}${reveal ? "palm-reveal.jpg" : "stadium-ready.jpg"}`}
        alt="AI presenter on a cricket pitch"
      />
      {motion && !failed && !reveal && (
        <video
          ref={video}
          className="cfl-film-video"
          src={`${media}stadium-palm-toss.mp4`}
          poster={`${media}stadium-ready.jpg`}
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={sync}
          onError={() => setFailed(true)}
          aria-hidden="true"
          data-testid="coin-host-video"
        />
      )}
      {reveal && (
        <div
          className="cfl-palm-face"
          style={coinStyle}
          role="img"
          aria-label={`${side} on the presenter's palm`}
          data-testid="coin-palm-result"
          data-side={side}
        >
          <img
            src={`${import.meta.env.BASE_URL}media/instant/coin-${side}.svg`}
            alt=""
          />
          <span>{side.toUpperCase()}</span>
        </div>
      )}
    </div>
  );
}
